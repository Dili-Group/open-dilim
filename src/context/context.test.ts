// Test tầng context: thứ tự section, ngân sách §7 (history không bị cắt, memory có cap), ngưỡng
// + provenance, và luật "rỗng → nói không chắc". MemoryStore/SkillRegistry giả — không DB, không
// network. Import THẲNG module lá, KHÔNG qua index.ts của tầng khác (tránh config.ts fail-fast).

import { describe, expect, test } from "bun:test";
import { SkillRegistry } from "../skills/registry.ts";
import type { Skill } from "../skills/types.ts";
import { RECALL_MAX_COSINE_DISTANCE } from "../state/vector.ts";
import type { MemoryRecall, MemoryScope, RecallOptions, RecalledFact } from "../state/types.ts";
import type { HistoryEntry } from "../types/index.ts";
import { assembleTurnContext } from "./assembler.ts";
import type { ContextSources } from "./types.ts";

const SCOPE: MemoryScope = { ownerKind: "customer", ownerId: "cus1", channel: "zalo", conversationId: "room1" };
const BASE = "PROMPT NỀN";

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    conversationId: "c1",
    msgId: "m1",
    senderId: "u1",
    text: "khách hỏi gì đó",
    isGroup: false,
    role: "user",
    ts: 1,
    ...over,
  };
}

function skill(name: string, description: string): Skill {
  return { meta: { name, description }, dir: `/def/${name}` };
}

/**
 * Cổng đọc giả — ghi lại đối số recall để assert, trả kịch bản dựng sẵn.
 * Chỉ 1 method: context/ phụ thuộc `MemoryRecall`, không phải cả kho (ISP).
 */
class FakeMemory implements MemoryRecall {
  readonly recallCalls: { scope: MemoryScope; queryText: string; options: RecallOptions }[] = [];
  constructor(private readonly facts: RecalledFact[] | Error = []) {}

  recall(scope: MemoryScope, queryText: string, options: RecallOptions): Promise<RecalledFact[]> {
    this.recallCalls.push({ scope, queryText, options });
    if (this.facts instanceof Error) return Promise.reject(this.facts);
    return Promise.resolve(this.facts);
  }
}

function fact(text: string, daysAgo = 0): RecalledFact {
  const createdAt = new Date(Date.UTC(2026, 7, 4) - daysAgo * 86_400_000);
  return { type: "context", text, createdAt };
}

function sources(over: Partial<ContextSources> = {}): ContextSources {
  return { basePrompt: BASE, skills: new SkillRegistry(), ...over };
}

describe("assembleTurnContext — system", () => {
  test("thứ tự section: prompt nền → catalog skill → khối memory", async () => {
    const skills = new SkillRegistry();
    skills.register(skill("refund", "quy trình hoàn tiền"));
    const memory = new FakeMemory([fact("Khách tên An")]);

    const ctx = await assembleTurnContext(sources({ skills, memory }), {
      history: [entry()],
      memoryScope: SCOPE,
    });

    const iBase = ctx.system.indexOf(BASE);
    const iCatalog = ctx.system.indexOf("refund");
    const iMemory = ctx.system.indexOf("GHI NHỚ DÀI HẠN");
    expect(iBase).toBe(0);
    expect(iCatalog).toBeGreaterThan(iBase);
    expect(iMemory).toBeGreaterThan(iCatalog);
  });

  test("registry rỗng → không có section catalog, không header mồ côi", async () => {
    const ctx = await assembleTurnContext(sources(), { history: [entry()] });
    expect(ctx.system).toBe(BASE);
    expect(ctx.system).not.toContain("Skill có sẵn");
  });

  test("không có memoryScope → KHÔNG gọi recall, không section memory", async () => {
    const memory = new FakeMemory([fact("không được dùng")]);
    const ctx = await assembleTurnContext(sources({ memory }), { history: [entry()] });
    expect(memory.recallCalls).toHaveLength(0);
    expect(ctx.system).not.toContain("GHI NHỚ DÀI HẠN");
  });

  test("có scope nhưng chưa nối store → không section memory", async () => {
    const ctx = await assembleTurnContext(sources(), { history: [entry()], memoryScope: SCOPE });
    expect(ctx.system).not.toContain("GHI NHỚ DÀI HẠN");
  });
});

describe("assembleTurnContext — khối memory (§7)", () => {
  test("đối số recall: scope, top-K, ngưỡng, queryText = lượt user cuối", async () => {
    const memory = new FakeMemory([]);
    await assembleTurnContext(sources({ memory }), {
      history: [entry({ text: "câu cũ" }), entry({ msgId: "m2", text: "câu mới nhất" })],
      memoryScope: SCOPE,
    });

    const call = memory.recallCalls[0];
    expect(call?.scope).toEqual(SCOPE);
    expect(call?.queryText).toBe("câu mới nhất");
    expect(call?.options.maxDistance).toBe(RECALL_MAX_COSINE_DISTANCE);
    expect(call?.options.k).toBeGreaterThanOrEqual(5);
    expect(call?.options.k).toBeLessThanOrEqual(8);
  });

  test("recall rỗng → nói KHÔNG suy đoán (chốt #4)", async () => {
    const memory = new FakeMemory([]);
    const ctx = await assembleTurnContext(sources({ memory }), {
      history: [entry()],
      memoryScope: SCOPE,
    });
    expect(ctx.system).toContain("không có ghi nhớ nào đủ liên quan");
    expect(ctx.system).toContain("KHÔNG suy đoán");
  });

  test("provenance: mỗi fact kèm ngày ghi (chốt #2)", async () => {
    const memory = new FakeMemory([fact("Khách thích giao sáng")]);
    const ctx = await assembleTurnContext(sources({ memory }), {
      history: [entry()],
      memoryScope: SCOPE,
    });
    expect(ctx.system).toContain("(ghi 2026-08-04)");
    expect(ctx.system).toContain("Khách thích giao sáng");
  });

  test("cap cắt NGUYÊN fact từ đuôi, không cắt giữa fact", async () => {
    const long = "x".repeat(200);
    const facts = Array.from({ length: 40 }, (_, i) => fact(`${i}-${long}`));
    const memory = new FakeMemory(facts);

    const ctx = await assembleTurnContext(sources({ memory }), {
      history: [entry()],
      memoryScope: SCOPE,
    });

    const lines = ctx.system.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.length).toBeLessThan(facts.length); // có cắt thật
    // Fact đầu (liên quan nhất) được giữ; mọi dòng giữ lại đều NGUYÊN VẸN.
    expect(lines[0]).toContain(`0-${long}`);
    for (const line of lines) expect(line.endsWith(long)).toBe(true);
  });

  test("recall lỗi → vẫn ra context, chỉ mất section memory", async () => {
    const memory = new FakeMemory(new Error("pgvector chết"));
    const ctx = await assembleTurnContext(sources({ memory }), {
      history: [entry()],
      memoryScope: SCOPE,
    });
    expect(ctx.system).toContain(BASE);
    expect(ctx.system).not.toContain("GHI NHỚ DÀI HẠN");
    expect(ctx.messages).toHaveLength(1);
  });

  test("memory to cỡ nào history cũng KHÔNG bị cắt (ngắn hạn thắng dài hạn)", async () => {
    const facts = Array.from({ length: 40 }, (_, i) => fact(`fact ${i} ${"y".repeat(200)}`));
    const memory = new FakeMemory(facts);
    const history = Array.from({ length: 20 }, (_, i) => entry({ msgId: `m${i}`, text: `t${i}` }));

    const ctx = await assembleTurnContext(sources({ memory }), { history, memoryScope: SCOPE });

    expect(ctx.messages).toHaveLength(20);
  });
});

// Dấu thời gian "[YYYY-MM-DD HH:mm] " đầu mỗi lượt user — regex thay vì so chuỗi cứng để không
// vỡ theo tz-data của máy chạy test.
const TIME_PREFIX = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] /;

describe("assembleTurnContext — messages", () => {
  test("direct: text kèm dấu thời gian, không prefix speaker", async () => {
    const ctx = await assembleTurnContext(sources(), { history: [entry({ text: "chào" })] });
    const part = ctx.messages[0]?.content[0];
    expect(part?.type).toBe("text");
    expect((part as { text: string }).text).toMatch(new RegExp(`${TIME_PREFIX.source}chào$`));
  });

  test("group: dấu thời gian + senderId để model trả đúng người", async () => {
    const ctx = await assembleTurnContext(sources(), {
      history: [entry({ isGroup: true, senderId: "An", text: "cho hỏi giá" })],
    });
    const part = ctx.messages[0]?.content[0];
    expect((part as { text: string }).text).toMatch(new RegExp(`${TIME_PREFIX.source}An: cho hỏi giá$`));
  });

  test("lượt agent → assistant, KHÔNG stamp thời gian (tránh nhại vào câu trả lời)", async () => {
    const ctx = await assembleTurnContext(sources(), {
      history: [entry({ role: "agent", text: "dạ em trả lời" })],
    });
    expect(ctx.messages[0]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "dạ em trả lời" }],
    });
  });

  test("giữ đúng thứ tự và số lượng turn (verbatim §7)", async () => {
    const history = [entry({ text: "a", ts: 1000 }), entry({ msgId: "m2", text: "b", ts: 2000 })];
    const ctx = await assembleTurnContext(sources(), { history });
    const texts = ctx.messages.map((m) => (m.content[0] as { text: string }).text);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatch(new RegExp(`${TIME_PREFIX.source}a$`));
    expect(texts[1]).toMatch(new RegExp(`${TIME_PREFIX.source}b$`));
  });
});
