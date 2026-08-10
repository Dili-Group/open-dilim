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
  MemoryWriterRegistry,
  RedisDistillCursor,
  TurnoverMemoryWriter,
  toDistillTurns,
  type DistillCursor,
} from "./memory-writer.ts";
import { LlmCompactor, SUMMARY_MAX_CHARS, type SummaryStore } from "./compactor.ts";
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
  readonly seen: ChatRequest[] = [];
  constructor(private readonly reply: ChatResult | Error) {}
  chat(req: ChatRequest): Promise<ChatResult> {
    this.seen.push(req);
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
class FakeCursor implements DistillCursor {
  saved: string[] = [];
  constructor(private current?: string) {}
  get(): Promise<string | undefined> {
    return Promise.resolve(this.current);
  }
  set(_scope: MemoryScope, msgId: string): Promise<void> {
    this.current = msgId;
    this.saved.push(msgId);
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

/** n entry history liên tiếp: msgId m0..m(n-1), text t0..t(n-1). */
function entriesOf(n: number): HistoryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    conversationId: "room1",
    msgId: `m${i}`,
    senderId: "u1",
    text: `t${i}`,
    isGroup: true,
    role: "user" as const,
    ts: 1000 + i,
  }));
}

function writerOf(
  distiller: Distiller,
  exec: FakeExec,
  cursor: FakeCursor,
  minPending: number,
  windowTurns: number,
): TurnoverMemoryWriter {
  return new TurnoverMemoryWriter(
    new PgMemoryStore(exec, new FakeEmbedder()),
    distiller,
    cursor,
    minPending,
    windowTurns,
  );
}

describe("TurnoverMemoryWriter", () => {
  test("phần chưa chưng cất còn ngắn → không gọi distill/ghi", async () => {
    const distiller = new FakeDistiller([FACT]);
    const exec = new FakeExec(() => []);
    const writer = writerOf(distiller, exec, new FakeCursor("m1"), 3, 12);

    // 4 entry, cursor ở m1 → pending = m2,m3 = 2 < 3.
    expect(await writer.afterTurn(SCOPE, entriesOf(4))).toBe(0);
    expect(distiller.seen).toHaveLength(0);
    expect(exec.calls).toHaveLength(0);
  });

  test("đủ phần chưa chưng cất → distill + ghi, cursor tiến tới tin cuối", async () => {
    const distiller = new FakeDistiller([FACT]);
    const cursor = new FakeCursor("m1");
    const exec = new FakeExec(() => []); // không trùng nguồn, không near-dup
    const writer = writerOf(distiller, exec, cursor, 3, 12);

    expect(await writer.afterTurn(SCOPE, entriesOf(5))).toBe(1);
    expect(distiller.seen).toHaveLength(1);
    expect(cursor.saved).toEqual(["m4"]);
    // sourceMsgId = msgId tin cuối đã chưng cất (provenance + idempotency).
    const insert = exec.calls.find((c) => c.text.startsWith("INSERT"));
    expect(insert?.params).toContain("m4");
  });

  test("chưa từng chưng cất (không cursor) → cả cửa sổ là phần chưa chưng cất", async () => {
    const distiller = new FakeDistiller([FACT]);
    const writer = writerOf(distiller, new FakeExec(() => []), new FakeCursor(), 3, 12);
    expect(await writer.afterTurn(SCOPE, entriesOf(3))).toBe(1);
  });

  test("cursor đã bị LTRIM đẩy khỏi buffer → chưng cất cả buffer, không bỏ sót", async () => {
    const distiller = new FakeDistiller([FACT]);
    const writer = writerOf(distiller, new FakeExec(() => []), new FakeCursor("da-bi-xoa"), 3, 12);
    expect(await writer.afterTurn(SCOPE, entriesOf(3))).toBe(1);
  });

  test("gọi lại ngay sau khi đã chưng cất → không chạy lần hai", async () => {
    const distiller = new FakeDistiller([FACT]);
    const cursor = new FakeCursor();
    const writer = writerOf(distiller, new FakeExec(() => []), cursor, 3, 12);

    const entries = entriesOf(4);
    await writer.afterTurn(SCOPE, entries);
    expect(await writer.afterTurn(SCOPE, entries)).toBe(0);
    expect(distiller.seen).toHaveLength(1);
  });

  test("transcript rộng hơn phần pending: lấy windowTurns tin cuối để fact không cụt ngữ cảnh", async () => {
    const distiller = new FakeDistiller([]);
    const writer = writerOf(distiller, new FakeExec(() => []), new FakeCursor("m7"), 1, 3);

    await writer.afterTurn(SCOPE, entriesOf(10));
    expect(distiller.seen[0]?.map((t) => t.text)).toEqual(["t7", "t8", "t9"]);
  });

  test("distill không ra fact → không đụng DB", async () => {
    const exec = new FakeExec(() => []);
    const writer = writerOf(new FakeDistiller([]), exec, new FakeCursor(), 1, 12);
    expect(await writer.afterTurn(SCOPE, entriesOf(1))).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });
});

describe("RedisDistillCursor", () => {
  test("get: đọc theo (channel, phòng); chuỗi rỗng = chưa có mốc", async () => {
    const redis = new FakeRedis("m9");
    expect(await new RedisDistillCursor(redis.send).get(SCOPE)).toBe("m9");
    expect(redis.argsOf("GET")[0]).toEqual(["dilim:distill-cursor:zalo:room1"]);
    expect(await new RedisDistillCursor(new FakeRedis("").send).get(SCOPE)).toBeUndefined();
  });

  test("set: SET kèm TTL 7 ngày", async () => {
    const redis = new FakeRedis();
    await new RedisDistillCursor(redis.send).set(SCOPE, "m9");
    expect(redis.argsOf("SET")[0]).toEqual([
      "dilim:distill-cursor:zalo:room1",
      "m9",
      "EX",
      "604800",
    ]);
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

describe("LlmCompactor", () => {
  class FakeSummaryStore implements SummaryStore {
    constructor(
      private value?: string,
      private cursor?: string,
    ) {}
    readonly writes: Array<{ summary: string; cursor: string }> = [];
    get(): Promise<string | undefined> {
      return Promise.resolve(this.value);
    }
    getCursor(): Promise<string | undefined> {
      return Promise.resolve(this.cursor);
    }
    set(_conversationId: string, summary: string, cursorMsgId: string): Promise<void> {
      this.writes.push({ summary, cursor: cursorMsgId });
      this.value = summary;
      this.cursor = cursorMsgId;
      return Promise.resolve();
    }
    get savedCursor(): string | undefined {
      return this.cursor;
    }
  }

  /** N entry đánh số, mỗi entry `chars` ký tự → điều khiển cả độ dài lẫn nhận diện từng tin. */
  function buffer(count: number, chars: number): HistoryEntry[] {
    return Array.from({ length: count }, (_, i) => ({
      ...ENTRY,
      msgId: `m${i}`,
      text: `m${i}:${"x".repeat(chars)}`,
    }));
  }

  const POLICY = { triggerChars: 1000, minEntries: 3, keepRecent: 4 };

  function promptOf(provider: ScriptedProvider): string {
    const block = provider.seen[0]?.messages[0]?.content[0];
    return block?.type === "text" ? block.text : "";
  }

  test("chưa tin nào trôi khỏi cửa sổ đọc → không gọi LLM, không ghi", async () => {
    const provider = new ScriptedProvider(textResult("không nên chạy"));
    const store = new FakeSummaryStore();
    const compactor = new LlmCompactor(provider, store, POLICY);

    // 4 entry = đúng bằng keepRecent → agent vẫn thấy nguyên văn cả 4.
    await compactor.afterTurn("c1", buffer(4, 400));
    expect(store.writes).toHaveLength(0);
  });

  test("tin NGẮN nhưng đã trôi đủ số entry → vẫn nén (buffer rộng, không phải cửa sổ agent)", async () => {
    const provider = new ScriptedProvider(textResult("khách chốt giao thứ 5"));
    const store = new FakeSummaryStore();
    const compactor = new LlmCompactor(provider, store, POLICY);

    // 10 tin × 20 ký tự = 200 ký tự, xa ngưỡng ký tự — nhưng 6 tin đã trôi khỏi cửa sổ đọc.
    await compactor.afterTurn("c1", buffer(10, 20));
    expect(store.writes).toEqual([{ summary: "khách chốt giao thứ 5", cursor: "m5" }]);
  });

  test("ít entry nhưng quá dài → nén sớm theo ngưỡng ký tự", async () => {
    const provider = new ScriptedProvider(textResult("bản tóm"));
    const store = new FakeSummaryStore();
    const compactor = new LlmCompactor(provider, store, { ...POLICY, minEntries: 100 });

    await compactor.afterTurn("c1", buffer(10, 200)); // 6 entry trôi ra, ~1200 ký tự
    expect(store.writes).toHaveLength(1);
  });

  test("trôi ra ít VÀ ngắn → chờ gom thêm, không tốn call LLM", async () => {
    const provider = new ScriptedProvider(textResult("không nên chạy"));
    const store = new FakeSummaryStore();
    const compactor = new LlmCompactor(provider, store, POLICY);

    await compactor.afterTurn("c1", buffer(6, 50)); // 2 entry trôi ra < minEntries
    expect(store.writes).toHaveLength(0);
  });

  test("có mốc cũ → chỉ nén phần MỚI, không nén lại đoạn đã nằm trong bản tóm", async () => {
    const provider = new ScriptedProvider(textResult("bản gộp"));
    const store = new FakeSummaryStore("tóm tắt cũ", "m5");
    const compactor = new LlmCompactor(provider, store, POLICY);

    await compactor.afterTurn("c1", buffer(14, 20));
    const prompt = promptOf(provider);
    expect(prompt).not.toContain("m5:");
    expect(prompt).toContain("m6:");
    expect(prompt).toContain("m9:");
    expect(prompt).not.toContain("m10:"); // 4 tin cuối vẫn nguyên văn trong cửa sổ agent
    expect(store.writes[0]?.cursor).toBe("m9");
  });

  test("mốc đã bị LTRIM đẩy khỏi buffer → nén cả buffer, không bỏ sót", async () => {
    const provider = new ScriptedProvider(textResult("bản tóm"));
    const store = new FakeSummaryStore(undefined, "da-bi-xoa");
    const compactor = new LlmCompactor(provider, store, POLICY);

    await compactor.afterTurn("c1", buffer(10, 20));
    expect(promptOf(provider)).toContain("m0:");
    expect(store.writes[0]?.cursor).toBe("m5");
  });

  test("có bản tóm cũ → đưa vào prompt để GỘP, không viết nối rời", async () => {
    const provider = new ScriptedProvider(textResult("bản gộp"));
    const store = new FakeSummaryStore("tóm tắt cũ");
    const compactor = new LlmCompactor(provider, store, POLICY);

    await compactor.afterTurn("c1", buffer(10, 20));
    const prompt = promptOf(provider);
    expect(prompt).toContain("tóm tắt cũ");
    expect(prompt).toContain("HỘI THOẠI CŨ");
  });

  test("bản tóm quá dài → cắt về trần", async () => {
    const provider = new ScriptedProvider(textResult("y".repeat(SUMMARY_MAX_CHARS + 500)));
    const store = new FakeSummaryStore();
    const compactor = new LlmCompactor(provider, store, POLICY);

    await compactor.afterTurn("c1", buffer(10, 20));
    expect(store.writes[0]?.summary).toHaveLength(SUMMARY_MAX_CHARS);
  });

  test("provider lỗi → không ghi, mốc KHÔNG tiến (lượt sau nén lại), KHÔNG throw", async () => {
    const provider = new ScriptedProvider(new Error("model chết"));
    const store = new FakeSummaryStore(undefined, "m2");
    const compactor = new LlmCompactor(provider, store, POLICY);

    await compactor.afterTurn("c1", buffer(10, 20));
    expect(store.writes).toHaveLength(0);
    expect(store.savedCursor).toBe("m2");
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
