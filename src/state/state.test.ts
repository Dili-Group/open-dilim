// Test tầng state/memory: parse fact (untrusted output), transcript, vector literal, và
// PgMemoryStore (idempotency + near-dup + narrow rows) + distiller qua fake — KHÔNG network/DB.
// Import THẲNG từng module, KHÔNG qua index.ts (index → db/client → config.ts fail-fast env).

import { describe, expect, test } from "bun:test";
import type { ChatRequest, ChatResult, Embedder, EmbedRequest, LLMProvider } from "../llm/types.ts";
import type { HistoryEntry } from "../types/index.ts";
import type { RedisCommand } from "../redis/types.ts";
import { LlmDistiller, parseFacts, renderTranscript } from "./distiller.ts";
import { RedisHistoryStore, parseHistoryEntry } from "./session.ts";
import { RedisDedupe } from "./dedupe.ts";
import { PgMemoryStore } from "./memory.ts";
import {
  BatchedMemoryWriter,
  MemoryWriterRegistry,
  RedisDistillCounter,
  toDistillTurns,
  type DistillCounter,
} from "./memory-writer.ts";
import { toVectorLiteral } from "./vector.ts";
import { customerSupportSpec } from "./specs.ts";
import {
  MemoryType,
  type DistilledFact,
  type Distiller,
  type DistillSpec,
  type DistillTurn,
  type MemoryScope,
  type SqlExecutor,
} from "./types.ts";

const SCOPE: MemoryScope = { ownerKind: "customer", ownerId: "cus1", channel: "zalo", conversationId: "room1" };
// Spec khách-hàng: vocab = preference|context|episode, default context.
const SPEC = customerSupportSpec;

// ─── fakes ──────────────────────────────────────────────────────────────────

class FakeEmbedder implements Embedder {
  readonly name = "fake";
  readonly dim = 3;
  readonly requests: EmbedRequest[] = [];
  embed(req: EmbedRequest): Promise<number[][]> {
    this.requests.push(req);
    return Promise.resolve(req.texts.map((_, i) => [i + 1, 0, 0]));
  }
}

/** Exec giả: responder quyết định trả gì theo query. Ghi lại mọi call để assert. */
class FakeExec implements SqlExecutor {
  readonly calls: { text: string; params: readonly unknown[] }[] = [];
  constructor(private readonly responder: (text: string) => unknown = () => []) {}
  query(text: string, params: readonly unknown[]): Promise<unknown> {
    this.calls.push({ text, params });
    return Promise.resolve(this.responder(text));
  }
  inserts(): { text: string; params: readonly unknown[] }[] {
    return this.calls.filter((c) => c.text.startsWith("INSERT"));
  }
}

class ScriptedProvider implements LLMProvider {
  readonly name = "scripted";
  constructor(private readonly reply: ChatResult | Error) {}
  chat(_req: ChatRequest): Promise<ChatResult> {
    if (this.reply instanceof Error) return Promise.reject(this.reply);
    return Promise.resolve(this.reply);
  }
}

function textResult(text: string): ChatResult {
  return { content: [{ type: "text", text }], stopReason: "end_turn" };
}

// ─── parseFacts ─────────────────────────────────────────────────────────────

describe("parseFacts", () => {
  test("mảng JSON thuần", () => {
    const facts = parseFacts('[{"type":"preference","text":"Khách thích giao sáng","confidence":0.9}]', SPEC);
    expect(facts).toEqual([
      { type: "preference", text: "Khách thích giao sáng", confidence: 0.9 },
    ]);
  });

  test("model bọc văn xuôi quanh JSON vẫn rút được", () => {
    const facts = parseFacts('Đây là kết quả:\n[{"text":"Khách tên An"}]\nHết.', SPEC);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.text).toBe("Khách tên An");
    expect(facts[0]?.type).toBe(MemoryType.Context); // thiếu type → default của spec
    expect(facts[0]?.confidence).toBe(0.5); // thiếu confidence → mặc định
  });

  test("type ngoài vocab → defaultType; confidence ngoài [0,1] → clamp", () => {
    const facts = parseFacts('[{"type":"xyz","text":"a","confidence":5},{"type":"episode","text":"b","confidence":-1}]', SPEC);
    expect(facts[0]).toEqual({ type: MemoryType.Context, text: "a", confidence: 1 });
    expect(facts[1]).toEqual({ type: MemoryType.Episode, text: "b", confidence: 0 });
  });

  test("phần tử thiếu/empty text bị bỏ", () => {
    const facts = parseFacts('[{"text":""},{"foo":1},{"text":"giữ"}]', SPEC);
    expect(facts).toEqual([{ type: MemoryType.Context, text: "giữ", confidence: 0.5 }]);
  });

  test("không phải JSON array → []", () => {
    expect(parseFacts("xin lỗi tôi không rõ", SPEC)).toEqual([]);
    expect(parseFacts('{"text":"không phải array"}', SPEC)).toEqual([]);
  });

  test("spec khác → vocab/default khác (chưng cất tuỳ agent)", () => {
    const salesSpec: DistillSpec = { system: "s", allowedTypes: ["need", "budget"], defaultType: "need" };
    const facts = parseFacts('[{"type":"budget","text":"tối đa 5tr"},{"type":"context","text":"lạ"}]', salesSpec);
    expect(facts[0]).toEqual({ type: "budget", text: "tối đa 5tr", confidence: 0.5 });
    expect(facts[1]?.type).toBe("need"); // "context" không thuộc vocab sales → default "need"
  });

  test("allowedTypes rỗng → chấp nhận mọi type (chỉ trim)", () => {
    const anySpec: DistillSpec = { system: "s", allowedTypes: [], defaultType: "misc" };
    const facts = parseFacts('[{"type":"  whatever ","text":"x"},{"text":"y"}]', anySpec);
    expect(facts[0]?.type).toBe("whatever");
    expect(facts[1]?.type).toBe("misc"); // thiếu type → default
  });
});

describe("renderTranscript", () => {
  test("assistant → agent, user → senderId", () => {
    const out = renderTranscript([
      { senderId: "An", role: "user", text: "cho hỏi giá" },
      { senderId: "bot", role: "assistant", text: "dạ 10k" },
    ]);
    expect(out).toBe("[An] cho hỏi giá\n[agent] dạ 10k");
  });
});

describe("toVectorLiteral", () => {
  test("format literal pgvector", () => {
    expect(toVectorLiteral([1, 2.5, -3])).toBe("[1,2.5,-3]");
  });
  test("rỗng / không hữu hạn → throw", () => {
    expect(() => toVectorLiteral([])).toThrow();
    expect(() => toVectorLiteral([1, NaN])).toThrow();
    expect(() => toVectorLiteral([Infinity])).toThrow();
  });
});

// ─── PgMemoryStore.write ────────────────────────────────────────────────────

describe("PgMemoryStore.write", () => {
  const FACTS = [{ type: MemoryType.Context, text: "Khách tên An", confidence: 0.8 }];

  test("facts rỗng → 0, không đụng DB/embed", async () => {
    const exec = new FakeExec();
    const embedder = new FakeEmbedder();
    const store = new PgMemoryStore(exec, embedder);
    expect(await store.write(SCOPE, [])).toBe(0);
    expect(exec.calls).toHaveLength(0);
    expect(embedder.requests).toHaveLength(0);
  });

  test("sourceMsgId đã tồn tại → idempotent, không insert", async () => {
    const exec = new FakeExec((t) => (t.includes("source_msg_id") ? [{ "?column?": 1 }] : []));
    const store = new PgMemoryStore(exec, new FakeEmbedder());
    expect(await store.write(SCOPE, FACTS, "msg-1")).toBe(0);
    expect(exec.inserts()).toHaveLength(0);
  });

  test("near-dup → bỏ, không insert", async () => {
    // Dedup query chứa "<=>" và "< $6"; trả hit → coi là trùng.
    const exec = new FakeExec((t) => (t.includes("<=>") && t.includes("< $6") ? [{ "?column?": 1 }] : []));
    const store = new PgMemoryStore(exec, new FakeEmbedder());
    expect(await store.write(SCOPE, FACTS)).toBe(0);
    expect(exec.inserts()).toHaveLength(0);
  });

  test("fact mới → insert, count đúng, vector cast + params đúng", async () => {
    const exec = new FakeExec(() => []); // không trùng, không idempotent-hit
    const store = new PgMemoryStore(exec, new FakeEmbedder());
    const n = await store.write(SCOPE, FACTS, "msg-9");
    expect(n).toBe(1);
    const ins = exec.inserts();
    expect(ins).toHaveLength(1);
    expect(ins[0]?.text).toContain("$7::vector");
    // params: [ownerKind, ownerId, channel, conversationId, type, text, vecLiteral, sourceMsgId, confidence]
    expect(ins[0]?.params).toEqual([
      "customer",
      "cus1",
      "zalo",
      "room1",
      "context",
      "Khách tên An",
      "[1,0,0]",
      "msg-9",
      0.8,
    ]);
  });

  test("embed trả sai số vector → throw", async () => {
    const badEmbedder: Embedder = {
      name: "bad",
      dim: 3,
      embed: () => Promise.resolve([]), // 0 vector cho 1 fact
    };
    const store = new PgMemoryStore(new FakeExec(), badEmbedder);
    await expect(store.write(SCOPE, FACTS)).rejects.toThrow();
  });
});

// ─── PgMemoryStore.recall ───────────────────────────────────────────────────

describe("PgMemoryStore.recall", () => {
  const OPTS = { k: 8, maxDistance: 0.3 };

  test("query rỗng → [], không embed", async () => {
    const embedder = new FakeEmbedder();
    const store = new PgMemoryStore(new FakeExec(), embedder);
    expect(await store.recall(SCOPE, "  ", OPTS)).toEqual([]);
    expect(embedder.requests).toHaveLength(0);
  });

  test("trả fact đã narrow, bỏ row hỏng", async () => {
    const created = new Date("2026-08-04T00:00:00Z");
    const exec = new FakeExec(() => [
      { text: "Khách tên An", type: "context", created_at: created },
      { text: 123, type: "context", created_at: created }, // hỏng → bỏ
    ]);
    const store = new PgMemoryStore(exec, new FakeEmbedder());
    const facts = await store.recall(SCOPE, "khách tên gì", OPTS);
    expect(facts).toEqual([{ text: "Khách tên An", type: "context", createdAt: created }]);
  });

  test("recall embed dùng taskType query", async () => {
    const embedder = new FakeEmbedder();
    const store = new PgMemoryStore(new FakeExec(() => []), embedder);
    await store.recall(SCOPE, "hỏi gì đó", { k: 5, maxDistance: 0.3 });
    expect(embedder.requests[0]?.taskType).toBe("query");
  });

  test("ngưỡng liên quan lọc TRONG SQL, k và maxDistance xuống đúng params", async () => {
    const exec = new FakeExec(() => []);
    const store = new PgMemoryStore(exec, new FakeEmbedder());
    await store.recall(SCOPE, "hỏi", { k: 6, maxDistance: 0.3 });
    const call = exec.calls[0];
    expect(call?.text).toContain("<=> $5::vector < $6");
    // [ownerKind, ownerId, channel, conversationId, vecLiteral, maxDistance, k]
    expect(call?.params).toEqual(["customer", "cus1", "zalo", "room1", "[1,0,0]", 0.3, 6]);
  });
});

// ─── LlmDistiller ───────────────────────────────────────────────────────────

describe("LlmDistiller", () => {
  test("provider trả JSON → facts", async () => {
    const provider = new ScriptedProvider(textResult('[{"type":"context","text":"Khách ở HN","confidence":0.7}]'));
    const distiller = new LlmDistiller(provider, SPEC);
    const facts = await distiller.distill([{ senderId: "An", role: "user", text: "tôi ở Hà Nội" }]);
    expect(facts).toEqual([{ type: "context", text: "Khách ở HN", confidence: 0.7 }]);
  });

  test("turns rỗng → [], không gọi model", async () => {
    const provider = new ScriptedProvider(new Error("không được gọi"));
    const distiller = new LlmDistiller(provider, SPEC);
    expect(await distiller.distill([])).toEqual([]);
  });

  test("provider lỗi → [] (cô lập, không throw)", async () => {
    const provider = new ScriptedProvider(new Error("model chết"));
    const distiller = new LlmDistiller(provider, SPEC);
    expect(await distiller.distill([{ senderId: "An", role: "user", text: "x" }])).toEqual([]);
  });
});

// ─── short-term (Redis) ─────────────────────────────────────────────────────

/** Redis giả: ghi lại lệnh + trả reply đặt sẵn. Không server, không network. */
class FakeRedis {
  readonly calls: Array<{ name: string; args: string[] }> = [];
  constructor(private readonly reply: unknown = null) {}
  readonly send: RedisCommand = (name, args) => {
    this.calls.push({ name, args });
    return Promise.resolve(this.reply);
  };
  argsOf(name: string): string[][] {
    return this.calls.filter((c) => c.name === name).map((c) => c.args);
  }
}

const ENTRY: HistoryEntry = {
  conversationId: "c1",
  msgId: "m1",
  senderId: "u1",
  text: "chào",
  isGroup: false,
  role: "user",
  ts: 1,
};

describe("RedisHistoryStore", () => {
  test("append: RPUSH + LTRIM + EXPIRE trên key theo phòng", async () => {
    const redis = new FakeRedis();
    await new RedisHistoryStore(redis.send).append(ENTRY);
    expect(redis.calls.map((c) => c.name)).toEqual(["RPUSH", "LTRIM", "EXPIRE"]);
    expect(redis.argsOf("RPUSH")[0]?.[0]).toBe("dilim:hist:c1");
    // LTRIM giữ ĐUÔI (N turn gần nhất), không phải đầu.
    expect(redis.argsOf("LTRIM")[0]?.[2]).toBe("-1");
  });

  test("recent: LRANGE N phần tử cuối, giữ thứ tự", async () => {
    const redis = new FakeRedis([JSON.stringify(ENTRY), JSON.stringify({ ...ENTRY, msgId: "m2" })]);
    const entries = await new RedisHistoryStore(redis.send).recent("c1", 20);
    expect(entries.map((e) => e.msgId)).toEqual(["m1", "m2"]);
    expect(redis.argsOf("LRANGE")[0]).toEqual(["dilim:hist:c1", "-20", "-1"]);
  });

  test("recent: entry hỏng bị bỏ qua, entry lành vẫn về", async () => {
    const redis = new FakeRedis(["{hong", JSON.stringify(ENTRY)]);
    const entries = await new RedisHistoryStore(redis.send).recent("c1", 20);
    expect(entries.map((e) => e.msgId)).toEqual(["m1"]);
  });

  test("recent: limit <= 0 → không gọi Redis", async () => {
    const redis = new FakeRedis([]);
    expect(await new RedisHistoryStore(redis.send).recent("c1", 0)).toEqual([]);
    expect(redis.calls).toHaveLength(0);
  });
});

describe("parseHistoryEntry", () => {
  test("thiếu field → null", () => {
    const { senderId: _drop, ...rest } = ENTRY;
    expect(parseHistoryEntry(JSON.stringify(rest))).toBeNull();
  });

  test("sai kiểu ts → null", () => {
    expect(parseHistoryEntry(JSON.stringify({ ...ENTRY, ts: "1" }))).toBeNull();
  });
});

describe("RedisDedupe", () => {
  test("SET NX trả OK → lần đầu thấy", async () => {
    const redis = new FakeRedis("OK");
    expect(await new RedisDedupe(redis.send).firstSee("zalo", "m1")).toBe(true);
    expect(redis.argsOf("SET")[0]).toEqual(["dilim:seen:zalo:m1", "1", "NX", "EX", "86400"]);
  });

  test("SET NX trả null → trùng", async () => {
    const redis = new FakeRedis(null);
    expect(await new RedisDedupe(redis.send).firstSee("zalo", "m1")).toBe(false);
  });

  test("release DEL đúng key", async () => {
    const redis = new FakeRedis();
    await new RedisDedupe(redis.send).release("zalo", "m1");
    expect(redis.argsOf("DEL")[0]).toEqual(["dilim:seen:zalo:m1"]);
  });
});

// ─── đường ghi dài hạn (batch distill) ──────────────────────────────────────

/** Đếm in-mem thay Redis — chỉ để lái nhịp lô trong test. */
class FakeCounter implements DistillCounter {
  private n = 0;
  resets = 0;
  bump(): Promise<number> {
    this.n++;
    return Promise.resolve(this.n);
  }
  reset(): Promise<void> {
    this.n = 0;
    this.resets++;
    return Promise.resolve();
  }
}

/** Distiller giả: trả sẵn fact, ghi lại transcript nhận được. */
class FakeDistiller implements Distiller {
  readonly seen: DistillTurn[][] = [];
  constructor(private readonly facts: DistilledFact[]) {}
  distill(turns: readonly DistillTurn[]): Promise<DistilledFact[]> {
    this.seen.push([...turns]);
    return Promise.resolve(this.facts);
  }
}

const FACT: DistilledFact = { type: MemoryType.Context, text: "Khách ở HN", confidence: 0.8 };

function turnsOf(n: number): DistillTurn[] {
  return Array.from({ length: n }, (_, i) => ({ senderId: "u1", role: "user" as const, text: `t${i}` }));
}

describe("BatchedMemoryWriter", () => {
  test("chưa đủ lô → chỉ đếm, không gọi distill/ghi", async () => {
    const distiller = new FakeDistiller([FACT]);
    const exec = new FakeExec(() => []);
    const writer = new BatchedMemoryWriter(
      new PgMemoryStore(exec, new FakeEmbedder()),
      distiller,
      new FakeCounter(),
      3,
      12,
    );
    expect(await writer.afterTurn(SCOPE, turnsOf(2), "m1")).toBe(0);
    expect(await writer.afterTurn(SCOPE, turnsOf(2), "m2")).toBe(0);
    expect(distiller.seen).toHaveLength(0);
    expect(exec.calls).toHaveLength(0);
  });

  test("đủ lô → distill + ghi, và reset bộ đếm", async () => {
    const distiller = new FakeDistiller([FACT]);
    const counter = new FakeCounter();
    const exec = new FakeExec(() => []); // không trùng nguồn, không near-dup
    const writer = new BatchedMemoryWriter(
      new PgMemoryStore(exec, new FakeEmbedder()),
      distiller,
      counter,
      3,
      12,
    );
    await writer.afterTurn(SCOPE, turnsOf(2), "m1");
    await writer.afterTurn(SCOPE, turnsOf(2), "m2");
    expect(await writer.afterTurn(SCOPE, turnsOf(2), "m3")).toBe(1);
    expect(distiller.seen).toHaveLength(1);
    expect(counter.resets).toBe(1);
    // sourceMsgId của lô = msgId lượt kích hoạt (provenance + idempotency).
    const insert = exec.calls.find((c) => c.text.startsWith("INSERT"));
    expect(insert?.params).toContain("m3");
  });

  test("cửa sổ cắt về windowTurns turn cuối", async () => {
    const distiller = new FakeDistiller([]);
    const writer = new BatchedMemoryWriter(
      new PgMemoryStore(new FakeExec(() => []), new FakeEmbedder()),
      distiller,
      new FakeCounter(),
      1,
      3,
    );
    await writer.afterTurn(SCOPE, turnsOf(10), "m1");
    expect(distiller.seen[0]?.map((t) => t.text)).toEqual(["t7", "t8", "t9"]);
  });

  test("distill không ra fact → không đụng DB", async () => {
    const exec = new FakeExec(() => []);
    const writer = new BatchedMemoryWriter(
      new PgMemoryStore(exec, new FakeEmbedder()),
      new FakeDistiller([]),
      new FakeCounter(),
      1,
      12,
    );
    expect(await writer.afterTurn(SCOPE, turnsOf(1), "m1")).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });
});

describe("RedisDistillCounter", () => {
  test("bump: INCR + EXPIRE theo (channel, phòng)", async () => {
    const redis = new FakeRedis(2);
    expect(await new RedisDistillCounter(redis.send).bump(SCOPE)).toBe(2);
    expect(redis.argsOf("INCR")[0]).toEqual(["dilim:distill:zalo:room1"]);
    expect(redis.argsOf("EXPIRE")[0]?.[1]).toBe("86400");
  });

  test("reset: DEL đúng key", async () => {
    const redis = new FakeRedis();
    await new RedisDistillCounter(redis.send).reset(SCOPE);
    expect(redis.argsOf("DEL")[0]).toEqual(["dilim:distill:zalo:room1"]);
  });
});

describe("toDistillTurns", () => {
  test("map role agent → assistant, bỏ text rỗng", () => {
    expect(
      toDistillTurns([
        ENTRY,
        { ...ENTRY, msgId: "m2", senderId: "agent", role: "agent", text: "chào anh" },
        { ...ENTRY, msgId: "m3", text: "   " },
      ]),
    ).toEqual([
      { senderId: "u1", role: "user", text: "chào" },
      { senderId: "agent", role: "assistant", text: "chào anh" },
    ]);
  });
});

describe("MemoryWriterRegistry", () => {
  const otherSpec: DistillSpec = { ...customerSupportSpec, system: "nhớ việc nội bộ" };

  function build(): { registry: MemoryWriterRegistry; built: DistillSpec[] } {
    const built: DistillSpec[] = [];
    const specs = new Map<string, DistillSpec>([
      ["dealer", customerSupportSpec],
      ["operations", otherSpec],
      ["boss", otherSpec], // cùng spec với operations
    ]);
    const registry = new MemoryWriterRegistry(specs, (spec) => {
      built.push(spec);
      return { afterTurn: () => Promise.resolve(0) };
    });
    return { registry, built };
  }

  test("spec trùng → dùng chung 1 writer, không dựng distiller thừa", () => {
    const { registry, built } = build();
    expect(built).toHaveLength(2);
    expect(registry.for("operations")).toBe(registry.for("boss"));
  });

  test("spec khác → writer khác (agent nhớ khác nhau)", () => {
    const { registry } = build();
    expect(registry.for("dealer")).not.toBe(registry.for("boss"));
  });

  test("agent lạ → undefined (không mượn writer agent khác)", () => {
    expect(build().registry.for("khong_ton_tai")).toBeUndefined();
  });
});
