// Test broker: narrow reply Redis (RESP2 lẫn RESP3), validate Envelope, và vòng đời
// publish → take → ack/retry → reclaim/DLQ chạy trên Redis GIẢ (mảng lệnh), không cần server.

import { describe, expect, test } from "bun:test";
import type { Envelope } from "../types/index.ts";
import type { RedisCommand } from "../redis/types.ts";
import { parseEntries, parseEnvelope, parsePending, parseReadReply } from "./resp.ts";
import { INGRESS_DLQ, INGRESS_STREAM, RedisStreamBroker } from "./queue.ts";

const FIELD = "data";

function makeEnvelope(over: Partial<Envelope> = {}): Envelope {
  return {
    source: "channel",
    channel: "zalo",
    msgId: "m1",
    conversationId: "c1",
    senderId: "u1",
    isGroup: false,
    addressedToAgent: true,
    text: "hi",
    mentions: [],
    ts: 1,
    ...over,
  };
}

describe("parseReadReply", () => {
  const entries = [["1-0", [FIELD, "{\"a\":1}"]]];

  test("RESP2: mảng [[stream, entries]]", () => {
    expect(parseReadReply([[INGRESS_STREAM, entries]], FIELD)).toEqual([
      { id: "1-0", data: '{"a":1}' },
    ]);
  });

  test("RESP3: map {stream: entries}", () => {
    expect(parseReadReply({ [INGRESS_STREAM]: entries }, FIELD)).toEqual([
      { id: "1-0", data: '{"a":1}' },
    ]);
  });

  test("field dạng map (RESP3) đọc được", () => {
    expect(parseReadReply({ s: [["2-0", { [FIELD]: "x" }]] }, FIELD)).toEqual([
      { id: "2-0", data: "x" },
    ]);
  });

  test("null (BLOCK timeout) → rỗng, không phải lỗi", () => {
    expect(parseReadReply(null, FIELD)).toEqual([]);
  });

  test("entry thiếu field data → bỏ qua", () => {
    expect(parseReadReply([[INGRESS_STREAM, [["3-0", ["khac", "x"]]]]], FIELD)).toEqual([]);
  });
});

describe("parsePending", () => {
  test("đọc id + số lần giao", () => {
    expect(parsePending([["1-0", "w1", 900000, 2]])).toEqual([{ id: "1-0", deliveries: 2 }]);
  });

  test("deliveries dạng string vẫn đọc được", () => {
    expect(parsePending([["1-0", "w1", "900000", "3"]])).toEqual([{ id: "1-0", deliveries: 3 }]);
  });

  test("dòng thiếu cột → bỏ qua", () => {
    expect(parsePending([["1-0", "w1"]])).toEqual([]);
  });
});

describe("parseEnvelope", () => {
  test("payload đủ field → Envelope", () => {
    const envelope = makeEnvelope({ mentions: [{ uid: "bot" }] });
    expect(parseEnvelope(JSON.stringify(envelope))).toEqual(envelope);
  });

  test("JSON hỏng → null", () => {
    expect(parseEnvelope("{khong-phai-json")).toBeNull();
  });

  test("thiếu field bắt buộc → null", () => {
    const { conversationId: _drop, ...rest } = makeEnvelope();
    expect(parseEnvelope(JSON.stringify(rest))).toBeNull();
  });

  test("sai kiểu (isGroup string) → null", () => {
    expect(parseEnvelope(JSON.stringify({ ...makeEnvelope(), isGroup: "true" }))).toBeNull();
  });

  test("source lạ → null (không đoán bừa)", () => {
    expect(parseEnvelope(JSON.stringify({ ...makeEnvelope(), source: "hack" }))).toBeNull();
  });

  test("mentions sai shape → null", () => {
    expect(parseEnvelope(JSON.stringify({ ...makeEnvelope(), mentions: ["bot"] }))).toBeNull();
  });
});

describe("parseEntries", () => {
  test("id không phải string → bỏ qua", () => {
    expect(parseEntries([[1, [FIELD, "x"]]], FIELD)).toEqual([]);
  });
});

/** Redis giả: ghi lại lệnh, trả reply theo kịch bản đặt sẵn cho từng lệnh. */
class FakeRedis {
  readonly calls: Array<{ name: string; args: string[] }> = [];
  private readonly replies = new Map<string, unknown[]>();

  /** Xếp reply cho lần gọi thứ n của lệnh `name`. Hết kịch bản → null. */
  queue(name: string, reply: unknown): void {
    const list = this.replies.get(name) ?? [];
    list.push(reply);
    this.replies.set(name, list);
  }

  send: RedisCommand = (name, args) => {
    this.calls.push({ name, args });
    const list = this.replies.get(name);
    const reply = list === undefined ? undefined : list.shift();
    return Promise.resolve(reply ?? null);
  };

  argsOf(name: string): string[][] {
    return this.calls.filter((c) => c.name === name).map((c) => c.args);
  }
}

describe("RedisStreamBroker", () => {
  test("publish XADD envelope vào ingress stream", async () => {
    const redis = new FakeRedis();
    const broker = new RedisStreamBroker(redis.send, redis.send, "w1");
    await broker.publish(makeEnvelope({ msgId: "mx" }));

    const xadd = redis.argsOf("XADD")[0];
    expect(xadd?.[0]).toBe(INGRESS_STREAM);
    expect(xadd?.at(-1)).toContain('"msgId":"mx"');
  });

  test("ensureGroup nuốt BUSYGROUP, ném lỗi khác", async () => {
    const busy = new FakeRedis();
    busy.send = () => Promise.reject(new Error("BUSYGROUP Consumer Group name already exists"));
    await expect(new RedisStreamBroker(busy.send, busy.send, "w1").ensureGroup()).resolves.toBeUndefined();

    const dead = new FakeRedis();
    dead.send = () => Promise.reject(new Error("NOAUTH"));
    await expect(new RedisStreamBroker(dead.send, dead.send, "w1").ensureGroup()).rejects.toThrow("NOAUTH");
  });

  test("take trả envelope đọc từ XREADGROUP; ack → XACK+XDEL", async () => {
    const redis = new FakeRedis();
    redis.queue("XREADGROUP", { [INGRESS_STREAM]: [["5-0", [FIELD, JSON.stringify(makeEnvelope({ msgId: "m9" }))]]] });
    const broker = new RedisStreamBroker(redis.send, redis.send, "w1");

    const delivery = await broker.take();
    expect(delivery?.envelope.msgId).toBe("m9");

    await delivery?.ack();
    expect(redis.argsOf("XACK")[0]?.[2]).toBe("5-0");
    expect(redis.argsOf("XDEL")[0]?.[1]).toBe("5-0");
  });

  test("retryLater KHÔNG ack (để lại PEL cho lượt reclaim)", async () => {
    const redis = new FakeRedis();
    redis.queue("XREADGROUP", { [INGRESS_STREAM]: [["6-0", [FIELD, JSON.stringify(makeEnvelope())]]] });
    const broker = new RedisStreamBroker(redis.send, redis.send, "w1");

    const delivery = await broker.take();
    await delivery?.retryLater();
    expect(redis.argsOf("XACK")).toHaveLength(0);
  });

  test("payload hỏng → DLQ, không giao cho worker", async () => {
    const redis = new FakeRedis();
    redis.queue("XREADGROUP", { [INGRESS_STREAM]: [["7-0", [FIELD, "{hong"]]] });
    redis.queue("XREADGROUP", { [INGRESS_STREAM]: [["7-1", [FIELD, JSON.stringify(makeEnvelope({ msgId: "ok" }))]]] });
    const broker = new RedisStreamBroker(redis.send, redis.send, "w1");

    const delivery = await broker.take();
    expect(delivery?.envelope.msgId).toBe("ok");
    expect(redis.argsOf("XADD")[0]?.[0]).toBe(INGRESS_DLQ);
    expect(redis.argsOf("XACK")[0]?.[2]).toBe("7-0");
  });

  test("abort → take trả null", async () => {
    const redis = new FakeRedis();
    const broker = new RedisStreamBroker(redis.send, redis.send, "w1");
    const ac = new AbortController();
    const pending = broker.take(ac.signal);
    ac.abort();
    expect(await pending).toBeNull();
  });

  test("PEL: quá hạn idle → XCLAIM lấy lại; quá số lần giao → DLQ", async () => {
    const redis = new FakeRedis();
    redis.queue("XPENDING", [
      ["8-0", "w-chet", 400000, 1],
      ["8-1", "w-chet", 400000, 3],
    ]);
    redis.queue("XRANGE", [["8-1", [FIELD, "{hong"]]]);
    redis.queue("XCLAIM", [["8-0", [FIELD, JSON.stringify(makeEnvelope({ msgId: "cuu" }))]]]);
    const broker = new RedisStreamBroker(redis.send, redis.send, "w1");

    const delivery = await broker.take();
    expect(delivery?.envelope.msgId).toBe("cuu");
    // 8-1 (giao 3 lần) đi DLQ; 8-0 (giao 1 lần) được claim lại.
    expect(redis.argsOf("XADD")[0]?.[0]).toBe(INGRESS_DLQ);
    expect(redis.argsOf("XACK")[0]?.[2]).toBe("8-1");
    expect(redis.argsOf("XCLAIM")[0]?.at(-1)).toBe("8-0");
  });
});
