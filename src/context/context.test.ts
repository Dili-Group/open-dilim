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
import type { ContextSources, TurnContext } from "./types.ts";

const SCOPE: MemoryScope = { ownerKind: "customer", ownerId: "cus1", channel: "zalo", conversationId: "room1" };
const BASE = "PROMPT NỀN";

/** Nội dung system gộp lại — phần lớn test soi NỘI DUNG, chia khối là chuyện của cache. */
function sys(ctx: TurnContext): string {
  return ctx.system.map((block) => block.text).join("\n\n");
}

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

describe("assembleTurnContext — chia khối cho prompt cache", () => {
  test("khối 1 = phần ổn định và MANG breakpoint; phần biến động ở khối sau, KHÔNG cache", async () => {
    const skills = new SkillRegistry();
    skills.register(skill("refund", "quy trình hoàn tiền"));
    const memory = new FakeMemory([fact("Khách tên An")]);

    const ctx = await assembleTurnContext(sources({ skills, memory }), {
      history: [entry()],
      summary: "khách đã chốt giao thứ 5",
      memoryScope: SCOPE,
    });

    expect(ctx.system).toHaveLength(2);
    const [stable, volatileBlock] = ctx.system;
    expect(stable?.cache).toBe(true);
    expect(stable?.text).toContain(BASE);
    expect(stable?.text).toContain("refund");
    // Chốt chặn hồi quy: thứ đổi theo lượt lọt vào khối cache là cache không bao giờ trúng nữa.
    expect(stable?.text).not.toContain("GHI NHỚ DÀI HẠN");
    expect(stable?.text).not.toContain("khách đã chốt giao thứ 5");

    expect(volatileBlock?.cache).toBeUndefined();
    expect(volatileBlock?.text).toContain("khách đã chốt giao thứ 5");
    expect(volatileBlock?.text).toContain("GHI NHỚ DÀI HẠN");
  });

  test("không có phần biến động → đúng 1 khối, vẫn cache được", async () => {
    const ctx = await assembleTurnContext(sources(), { history: [entry()] });
    expect(ctx.system).toEqual([{ text: BASE, cache: true }]);
  });

  test("không khối nào rỗng (API từ chối text block rỗng)", async () => {
    const ctx = await assembleTurnContext(sources({ skills: new SkillRegistry() }), {
      history: [entry()],
      summary: "",
    });
    for (const block of ctx.system) expect(block.text).not.toBe("");
  });
});

describe("assembleTurnContext — system", () => {
  test("thứ tự section: prompt nền → catalog skill → khối memory", async () => {
    const skills = new SkillRegistry();
    skills.register(skill("refund", "quy trình hoàn tiền"));
    const memory = new FakeMemory([fact("Khách tên An")]);

    const ctx = await assembleTurnContext(sources({ skills, memory }), {
      history: [entry()],
      memoryScope: SCOPE,
    });

    const iBase = sys(ctx).indexOf(BASE);
    const iCatalog = sys(ctx).indexOf("refund");
    const iMemory = sys(ctx).indexOf("GHI NHỚ DÀI HẠN");
    expect(iBase).toBe(0);
    expect(iCatalog).toBeGreaterThan(iBase);
    expect(iMemory).toBeGreaterThan(iCatalog);
  });

  test("registry rỗng → không có section catalog, không header mồ côi", async () => {
    const ctx = await assembleTurnContext(sources(), { history: [entry()] });
    expect(sys(ctx)).toBe(BASE);
    expect(sys(ctx)).not.toContain("Skill có sẵn");
  });

  test("không có memoryScope → KHÔNG gọi recall, không section memory", async () => {
    const memory = new FakeMemory([fact("không được dùng")]);
    const ctx = await assembleTurnContext(sources({ memory }), { history: [entry()] });
    expect(memory.recallCalls).toHaveLength(0);
    expect(sys(ctx)).not.toContain("GHI NHỚ DÀI HẠN");
  });

  test("có bản tóm → chèn section, nêu rõ là ngữ cảnh cũ chứ không phải tin mới", async () => {
    const ctx = await assembleTurnContext(sources(), {
      history: [entry()],
      summary: "khách đã chốt giao thứ 5",
    });
    expect(sys(ctx)).toContain("khách đã chốt giao thứ 5");
    expect(sys(ctx)).toContain("đã trôi khỏi lịch sử");
    // Đứng sau prompt nền: phần ổn định nhất vẫn dẫn đầu (prefix cache).
    expect(sys(ctx).indexOf(BASE)).toBeLessThan(sys(ctx).indexOf("khách đã chốt"));
  });

  test("bản tóm rỗng/thiếu → không có section thừa", async () => {
    const withEmpty = await assembleTurnContext(sources(), { history: [entry()], summary: "" });
    const without = await assembleTurnContext(sources(), { history: [entry()] });
    expect(sys(withEmpty)).toBe(BASE);
    expect(sys(without)).toBe(BASE);
  });

  test("có scope nhưng chưa nối store → không section memory", async () => {
    const ctx = await assembleTurnContext(sources(), { history: [entry()], memoryScope: SCOPE });
    expect(sys(ctx)).not.toContain("GHI NHỚ DÀI HẠN");
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
    expect(sys(ctx)).toContain("không có ghi nhớ nào đủ liên quan");
    expect(sys(ctx)).toContain("KHÔNG suy đoán");
  });

  test("provenance: mỗi fact kèm ngày ghi (chốt #2)", async () => {
    const memory = new FakeMemory([fact("Khách thích giao sáng")]);
    const ctx = await assembleTurnContext(sources({ memory }), {
      history: [entry()],
      memoryScope: SCOPE,
    });
    expect(sys(ctx)).toContain("(ghi 2026-08-04)");
    expect(sys(ctx)).toContain("Khách thích giao sáng");
  });

  test("cap cắt NGUYÊN fact từ đuôi, không cắt giữa fact", async () => {
    const long = "x".repeat(200);
    const facts = Array.from({ length: 40 }, (_, i) => fact(`${i}-${long}`));
    const memory = new FakeMemory(facts);

    const ctx = await assembleTurnContext(sources({ memory }), {
      history: [entry()],
      memoryScope: SCOPE,
    });

    const lines = sys(ctx).split("\n").filter((l) => l.startsWith("- "));
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
    expect(sys(ctx)).toContain(BASE);
    expect(sys(ctx)).not.toContain("GHI NHỚ DÀI HẠN");
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

// Prefix mỗi lượt user: "[HH:mm dd/mm/YYYY - senderId - Tên - vai]: " — regex thay vì so chuỗi
// cứng để không vỡ theo tz-data của máy chạy test.
const TIME = String.raw`\d{2}:\d{2} \d{2}/\d{2}/\d{4}`;

/** Bốn ô của prefix; ô nào hệ thống chưa biết thì gọi với "?". */
function prefix(senderId: string, name: string, role: string): string {
  const esc = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String.raw`^\[${TIME} - ${esc(senderId)} - ${esc(name)} - ${esc(role)}\]: `;
}

describe("assembleTurnContext — messages", () => {
  test("chat 1-1 vẫn in đủ 4 ô, ô chưa biết là `?`", async () => {
    const ctx = await assembleTurnContext(sources(), { history: [entry({ text: "chào" })] });
    const part = ctx.messages[0]?.content[0];
    expect(part?.type).toBe("text");
    expect((part as { text: string }).text).toMatch(new RegExp(`${prefix("u1", "?", "?")}chào$`));
  });

  test("có speakers → tin mang đúng tên + vai của CHÍNH người viết tin đó", async () => {
    const ctx = await assembleTurnContext(sources(), {
      history: [
        entry({ isGroup: true, senderId: "u1", text: "cho hỏi giá" }),
        entry({ msgId: "m2", isGroup: true, senderId: "u2", text: "để anh xem" }),
      ],
      speakers: new Map([
        ["u1", { role: "dai_ly" as const, id: "KH1", name: "Chị Lan" }],
        ["u2", { role: "nhan_vien" as const, id: "nv7", name: "Hà" }],
      ]),
    });
    const texts = ctx.messages.map((m) => (m.content[0] as { text: string }).text);
    expect(texts[0]).toMatch(new RegExp(`${prefix("u1", "Chị Lan", "dai_ly")}cho hỏi giá$`));
    expect(texts[1]).toMatch(new RegExp(`${prefix("u2", "Hà", "nhan_vien")}để anh xem$`));
  });

  test("không có tên hệ thống → lấy tên hiển thị channel; không có nữa → `?`", async () => {
    const ctx = await assembleTurnContext(sources(), {
      history: [entry({ isGroup: true, senderId: "u1", senderName: "Chú Bảy", text: "ê" })],
      speakers: new Map([["u1", { role: "dai_ly" as const, id: "KH1" }]]),
    });
    const text = (ctx.messages[0]?.content[0] as { text: string }).text;
    expect(text).toMatch(new RegExp(`${prefix("u1", "Chú Bảy", "dai_ly")}ê$`));
  });

  test("người lạ không có trong speakers → vai `?`, KHÔNG đoán", async () => {
    const ctx = await assembleTurnContext(sources(), {
      history: [entry({ isGroup: true, senderId: "la", text: "ai đó" })],
      speakers: new Map([["u1", { role: "dai_ly" as const, id: "KH1" }]]),
    });
    const text = (ctx.messages[0]?.content[0] as { text: string }).text;
    expect(text).toMatch(new RegExp(`${prefix("la", "?", "?")}ai đó$`));
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
    expect(texts[0]).toMatch(new RegExp(`${prefix("u1", "?", "?")}a$`));
    expect(texts[1]).toMatch(new RegExp(`${prefix("u1", "?", "?")}b$`));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Khối vai người gõ
// ─────────────────────────────────────────────────────────────────────────────

describe("khối NGƯỜI ĐANG NHẮN LƯỢT NÀY", () => {
  test("không biết vai → KHÔNG in khối nào", async () => {
    const ctx = await assembleTurnContext(sources(), { history: [entry()] });
    expect(sys(ctx)).not.toContain("NGƯỜI ĐANG NHẮN");
  });

  test("nhân viên → nói rõ là người nội bộ, kèm userId", async () => {
    const ctx = await assembleTurnContext(sources(), {
      history: [entry()],
      speaker: { role: "nhan_vien", id: "42" },
    });
    const text = sys(ctx);
    expect(text).toContain("Nhân viên nội bộ");
    expect(text).toContain("userId=42");
  });

  test("có tên → in tên kèm vai (model gọi đúng tên, không 'anh/chị' chung)", async () => {
    const ctx = await assembleTurnContext(sources(), {
      history: [entry()],
      speaker: { role: "nhan_vien", id: "42", name: "Nguyễn Công Giới" },
    });
    expect(sys(ctx)).toContain("Nhân viên nội bộ Dilim Nguyễn Công Giới (userId=42)");
  });

  test("đại lý → khách của công ty, kèm customerId", async () => {
    const ctx = await assembleTurnContext(sources(), {
      history: [entry()],
      speaker: { role: "dai_ly", id: "cus1" },
    });
    const text = sys(ctx);
    expect(text).toContain("Đại lý");
    expect(text).toContain("customerId=cus1");
  });

  test("guest → nói chưa rõ vai, KHÔNG in id nào", async () => {
    const ctx = await assembleTurnContext(sources(), {
      history: [entry()],
      speaker: { role: "guest" },
    });
    const text = sys(ctx);
    expect(text).toContain("Chưa định danh");
    expect(text).not.toContain("userId=");
    expect(text).not.toContain("customerId=");
  });

  // Vai đổi theo từng người gõ trong cùng phòng → lọt vào khối cache là cache không bao giờ trúng.
  test("khối vai nằm ở phần BIẾN ĐỘNG (sau breakpoint cache)", async () => {
    const ctx = await assembleTurnContext(sources(), {
      history: [entry()],
      speaker: { role: "nhan_vien", id: "42" },
    });
    const stable = ctx.system.find((block) => block.cache === true);
    expect(stable?.text).not.toContain("NGƯỜI ĐANG NHẮN");
    expect(ctx.system.at(-1)?.text).toContain("NGƯỜI ĐANG NHẮN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Khối việc đang treo (§6)
// ─────────────────────────────────────────────────────────────────────────────

describe("khối VIỆC PHÒNG NÀY ĐANG ĐƯỢC HỎI", () => {
  const NOTICE = {
    workflow: "hoi-don-goc",
    subject: "VTP0093412DH",
    subjectLabel: "mã đơn hoàn",
    answerLabel: "mã đơn gốc",
  };

  test("không có việc treo → KHÔNG in khối nào (đừng tốn context)", async () => {
    const ctx = await assembleTurnContext(sources(), { history: [entry()], pending: [] });
    expect(sys(ctx)).not.toContain("ĐANG ĐƯỢC HỎI");
  });

  test("có việc treo → in khoá NGUYÊN VĂN + đúng cú pháp gọi tool", async () => {
    const ctx = await assembleTurnContext(sources(), { history: [entry()], pending: [NOTICE] });
    const text = sys(ctx);
    expect(text).toContain("VTP0093412DH");
    expect(text).toContain('tra_loi_viec(ma_viec="hoi-don-goc", khoa="VTP0093412DH"');
  });

  test("khối việc treo nằm ở phần BIẾN ĐỘNG (sau breakpoint cache)", async () => {
    const ctx = await assembleTurnContext(sources(), { history: [entry()], pending: [NOTICE] });
    const stable = ctx.system.find((block) => block.cache === true);
    expect(stable?.text).not.toContain("ĐANG ĐƯỢC HỎI");
    expect(ctx.system.at(-1)?.text).toContain("ĐANG ĐƯỢC HỎI");
  });
});
