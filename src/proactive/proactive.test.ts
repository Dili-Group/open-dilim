// Test phễu proactive: gate tầng 0 (mẫu tin THẬT từ message_log 25/08), hàng chờ Redis (mock
// command), poller tầng 1 + trần tần suất + seam classifier. Không I/O thật.

import { describe, expect, test } from "bun:test";
import type { ProactiveSpec } from "../agents/types.ts";
import type { Envelope, HistoryEntry } from "../types/index.ts";
import { passesProactiveGate } from "./gate.ts";
import { ProactiveIngest } from "./ingest.ts";
import {
  RedisProactivePending,
  parsePendingQuestion,
  type PendingQuestion,
  type ProactivePendingStore,
} from "./pending.ts";
import { proactiveTick, type ProactivePollerDeps } from "./poller.ts";
import { proactiveSpecFor } from "./spec.ts";
import { buildProactiveVerify } from "./verify.ts";

const AGENT_UID = "AGENT";
const SELF_UID = "SELF";
const SELF_IDS = [AGENT_UID, SELF_UID] as const;

function envelope(over: Partial<Envelope> = {}): Envelope {
  return {
    source: "channel",
    channel: "zalo",
    msgId: "m1",
    conversationId: "G1",
    senderId: "U1",
    isGroup: true,
    addressedToAgent: false,
    text: "hủy giúp c đơn này nhé",
    mentions: [],
    ts: 1_700_000_000_000,
    ...over,
  };
}

// Spec dealer qua đúng đường tra của production (router + profile). Có spec = phễu bật cho zalo.
const dealerSpec = proactiveSpecFor("zalo");
if (dealerSpec === undefined) throw new Error("dealerProfile phải khai proactive cho test này");

describe("passesProactiveGate (tầng 0)", () => {
  const gate = (over: Partial<Envelope>) =>
    passesProactiveGate({ envelope: envelope(over), spec: dealerSpec, selfIds: SELF_IDS });

  test("câu nhờ vả thật từ message_log → vào phễu", () => {
    expect(gate({ text: "PKE1496271976 hủy giúo c nhé" })).toBe(true);
    expect(gate({ text: "nhờ hỗ trợ in đơn này giúp c" })).toBe(true);
    expect(gate({ text: "em ơi, sao đơn này mình vẫn chưa gửi cho bên đơn vị giao hàng" })).toBe(true);
    expect(
      gate({ text: "chuyển chiết khấu cho đại lý 30% lên 50% thì số 20% còn lại khi nào hoàn" }),
    ).toBe(true);
    expect(gate({ text: "Dạ mình đã ký xong hợp đồng đại lý chưa ạ ?" })).toBe(true);
  });

  test("chatter/thông báo không phải câu cần giúp → bỏ", () => {
    expect(gate({ text: "Dạ" })).toBe(false);
    expect(gate({ text: "ok cảm ơn nhiều" })).toBe(false);
    expect(gate({ text: "Bàn giao ĐVVC sáng 24/08/2026 Lần 1" })).toBe(false);
  });

  test("tin chỉ có đính kèm / URL → bỏ, kể cả placeholder lẫn link dài", () => {
    expect(gate({ text: "[Ảnh đính kèm]" })).toBe(false);
    expect(gate({ text: "https://drive.google.com/drive/folders/abc?usp=link [Tệp đính kèm]" })).toBe(
      false,
    );
    // Đính kèm NHƯNG kèm câu hỏi thật → vẫn vào.
    expect(gate({ text: "đơn này khách đã CK, duyệt giúp em [Ảnh đính kèm]" })).toBe(true);
  });

  test("tin của chính agent (uid mention HAY uid tài khoản vọng lại) → bỏ", () => {
    expect(gate({ senderId: AGENT_UID })).toBe(false);
    expect(gate({ senderId: SELF_UID })).toBe(false);
  });

  test("direct / đã nhắm agent / envelope tổng hợp → không thuộc phễu", () => {
    expect(gate({ isGroup: false })).toBe(false);
    expect(gate({ addressedToAgent: true })).toBe(false);
    expect(gate({ source: "cron" })).toBe(false);
  });
});

/** Redis giả tối thiểu cho pending store: ZSET (map member→score) + HASH (map field→json). */
function fakeRedis() {
  const zset = new Map<string, number>();
  const hash = new Map<string, string>();
  const send = async (name: string, args: string[]): Promise<unknown> => {
    switch (name) {
      case "ZADD": {
        const [, score, member] = args;
        if (score === undefined || member === undefined) throw new Error("ZADD thiếu args");
        zset.set(member, Number(score));
        return 1;
      }
      case "ZRANGEBYSCORE": {
        const [, , max] = args;
        if (max === undefined) throw new Error("ZRANGEBYSCORE thiếu args");
        return [...zset.entries()]
          .filter(([, score]) => score <= Number(max))
          .sort((a, b) => a[1] - b[1])
          .map(([member]) => member);
      }
      case "ZREM": {
        const [, member] = args;
        return member !== undefined && zset.delete(member) ? 1 : 0;
      }
      case "HSET": {
        const [, field, value] = args;
        if (field === undefined || value === undefined) throw new Error("HSET thiếu args");
        hash.set(field, value);
        return 1;
      }
      case "HGET": {
        const [, field] = args;
        return field === undefined ? null : (hash.get(field) ?? null);
      }
      case "HDEL": {
        const [, field] = args;
        return field !== undefined && hash.delete(field) ? 1 : 0;
      }
      default:
        throw new Error(`lệnh chưa mock: ${name}`);
    }
  };
  return { send, zset, hash };
}

function question(over: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    channel: "zalo",
    conversationId: "G1",
    senderId: "U1",
    msgId: "m1",
    text: "hủy giúp c đơn này nhé",
    ts: 1_700_000_000_000,
    ...over,
  };
}

describe("RedisProactivePending", () => {
  test("schedule rồi claimDue: chưa đến hạn không trả, đến hạn trả đúng payload và gỡ sạch", async () => {
    const redis = fakeRedis();
    const store = new RedisProactivePending(redis.send);
    await store.schedule(question(), 1_000);

    expect(await store.claimDue(999)).toEqual([]);
    const due = await store.claimDue(1_000);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ msgId: "m1", senderId: "U1", conversationId: "G1" });
    // Đã claim → không còn gì cho tick sau, kể cả payload.
    expect(await store.claimDue(2_000)).toEqual([]);
    expect(redis.hash.size).toBe(0);
  });

  test("cùng (phòng, người hỏi) đè lịch: câu MỚI NHẤT thắng, đồng hồ reset", async () => {
    const redis = fakeRedis();
    const store = new RedisProactivePending(redis.send);
    await store.schedule(question({ msgId: "m1", text: "câu cũ" }), 1_000);
    await store.schedule(question({ msgId: "m2", text: "câu mới hơn" }), 5_000);

    expect(await store.claimDue(1_000)).toEqual([]); // đồng hồ đã reset
    const due = await store.claimDue(5_000);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ msgId: "m2", text: "câu mới hơn" });
  });

  test("payload hỏng trong Redis → bỏ qua, không throw", () => {
    expect(parsePendingQuestion("không phải json")).toBeNull();
    expect(parsePendingQuestion(JSON.stringify({ channel: "zalo" }))).toBeNull();
  });
});

/** Pending giả cho poller: trả sẵn danh sách câu đến hạn. */
function fakePending(due: PendingQuestion[]): ProactivePendingStore {
  return {
    schedule: () => Promise.resolve(),
    claimDue: () => Promise.resolve(due),
  };
}

function historyEntry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    conversationId: "G1",
    msgId: "h1",
    senderId: "U1",
    text: "hủy giúp c đơn này nhé",
    isGroup: true,
    role: "user",
    ts: 1_700_000_000_000,
    ...over,
  };
}

function pollerDeps(over: {
  due?: PendingQuestion[];
  history?: HistoryEntry[];
  rateCount?: number;
  classify?: ProactivePollerDeps["classify"];
  spec?: ProactiveSpec;
}) {
  const published: Envelope[] = [];
  const deps: ProactivePollerDeps = {
    pending: fakePending(over.due ?? [question()]),
    history: { recent: () => Promise.resolve(over.history ?? [historyEntry()]) },
    broker: {
      publish: (e) => {
        published.push(e);
        return Promise.resolve();
      },
    },
    send: async (name) => {
      if (name === "INCR") return over.rateCount ?? 1;
      if (name === "EXPIRE") return 1;
      throw new Error(`lệnh chưa mock: ${name}`);
    },
    specFor: () => over.spec ?? dealerSpec,
    ...(over.classify === undefined ? {} : { classify: over.classify }),
  };
  return { deps, published };
}

describe("proactiveTick (tầng 1-3)", () => {
  test("không ai đáp sau câu hỏi → publish envelope proactive đánh thức agent", async () => {
    const { deps, published } = pollerDeps({});
    await proactiveTick(deps, Date.now());

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      source: "proactive",
      msgId: "proactive:m1",
      conversationId: "G1",
      senderId: "U1",
      addressedToAgent: true,
      isGroup: true,
      text: "hủy giúp c đơn này nhé",
    });
  });

  test("NGƯỜI KHÁC đã lên tiếng sau câu hỏi → agent đứng ngoài", async () => {
    const { deps, published } = pollerDeps({
      history: [
        historyEntry(),
        historyEntry({ msgId: "h2", senderId: "U2", text: "để chị lo", ts: 1_700_000_000_500 }),
      ],
    });
    await proactiveTick(deps, Date.now());
    expect(published).toEqual([]);
  });

  test("chính người hỏi gõ thêm → KHÔNG tính là đã được trả lời", async () => {
    const { deps, published } = pollerDeps({
      history: [
        historyEntry(),
        historyEntry({ msgId: "h2", senderId: "U1", text: "mọi người ơi", ts: 1_700_000_000_500 }),
      ],
    });
    await proactiveTick(deps, Date.now());
    expect(published).toHaveLength(1);
  });

  test("vượt trần mỗi phòng mỗi giờ → im lặng", async () => {
    const { deps, published } = pollerDeps({ rateCount: dealerSpec.maxPerRoomPerHour + 1 });
    await proactiveTick(deps, Date.now());
    expect(published).toEqual([]);
  });

  test("classifier (tầng 2) từ chối → không publish; chấp nhận → publish", async () => {
    const rejected = pollerDeps({ classify: () => Promise.resolve(false) });
    await proactiveTick(rejected.deps, Date.now());
    expect(rejected.published).toEqual([]);

    const accepted = pollerDeps({ classify: () => Promise.resolve(true) });
    await proactiveTick(accepted.deps, Date.now());
    expect(accepted.published).toHaveLength(1);
  });

  test("channel không còn spec (agent tắt phễu) → câu đang chờ rơi theo", async () => {
    const { published } = pollerDeps({});
    const deps: ProactivePollerDeps = {
      ...pollerDeps({}).deps,
      specFor: () => undefined,
      broker: {
        publish: (e) => {
          published.push(e);
          return Promise.resolve();
        },
      },
    };
    await proactiveTick(deps, Date.now());
    expect(published).toEqual([]);
  });
});

describe("buildProactiveVerify (xác minh trước khi vào hàng chờ)", () => {
  const boundSpec: ProactiveSpec = { ...dealerSpec, requireBoundGroup: true };
  const usageOf = (spentPicoUsd: number, enforce = true) => ({
    port: {
      spentTodayPicoUsd: () => Promise.resolve(spentPicoUsd),
      record: () => Promise.resolve(),
    },
    usdVndRate: 25_000,
    enforce,
  });

  test("spec đòi phòng xác thực: chưa bind → chặn, đã bind → qua", async () => {
    const unbound = buildProactiveVerify({ groups: { customerIdOf: () => Promise.resolve(undefined) } });
    expect(await unbound(envelope(), boundSpec)).toBe(false);

    const bound = buildProactiveVerify({ groups: { customerIdOf: () => Promise.resolve("DL01") } });
    expect(await bound(envelope(), boundSpec)).toBe(true);
  });

  test("spec KHÔNG đòi bind → phòng chưa bind vẫn qua", async () => {
    const spec: ProactiveSpec = { ...dealerSpec, requireBoundGroup: false };
    const verify = buildProactiveVerify({ groups: { customerIdOf: () => Promise.resolve(undefined) } });
    expect(await verify(envelope(), spec)).toBe(true);
  });

  test("phòng vượt trần ngân sách ngày → chặn; còn ngân sách → qua", async () => {
    const groups = { customerIdOf: () => Promise.resolve("DL01") };
    // Trần dealer hữu hạn → tiêu cực lớn là vượt chắc chắn.
    const over = buildProactiveVerify({ groups, usage: usageOf(Number.MAX_SAFE_INTEGER) });
    expect(await over(envelope(), boundSpec)).toBe(false);

    const under = buildProactiveVerify({ groups, usage: usageOf(0) });
    expect(await under(envelope(), boundSpec)).toBe(true);
  });

  test("shadow mode (enforce=false) → chỉ đo, không chặn", async () => {
    const verify = buildProactiveVerify({
      groups: { customerIdOf: () => Promise.resolve("DL01") },
      usage: usageOf(Number.MAX_SAFE_INTEGER, false),
    });
    expect(await verify(envelope(), boundSpec)).toBe(true);
  });
});

describe("ProactiveIngest (đầu vào phễu)", () => {
  test("tin qua gate → đặt lịch chờ đúng waitMs với payload đủ để dựng envelope", async () => {
    const scheduled: Array<{ q: PendingQuestion; fireAt: number }> = [];
    const ingest = new ProactiveIngest({
      pending: {
        schedule: (q, fireAt) => {
          scheduled.push({ q, fireAt });
          return Promise.resolve();
        },
        claimDue: () => Promise.resolve([]),
      },
      specFor: () => dealerSpec,
      selfIdsFor: () => SELF_IDS,
    });

    const before = Date.now();
    await ingest.consider(envelope({ senderName: "Chị Phượng" }));
    const first = scheduled[0];
    expect(first).toBeDefined();
    if (first === undefined) throw new Error("unreachable");
    expect(first.q).toMatchObject({ msgId: "m1", senderName: "Chị Phượng", text: envelope().text });
    expect(first.fireAt).toBeGreaterThanOrEqual(before + dealerSpec.waitMs);
  });

  test("verify chặn (phòng chưa xác thực / hết ngân sách) → không đặt lịch", async () => {
    const scheduled: PendingQuestion[] = [];
    const ingest = new ProactiveIngest({
      pending: {
        schedule: (q) => {
          scheduled.push(q);
          return Promise.resolve();
        },
        claimDue: () => Promise.resolve([]),
      },
      specFor: () => dealerSpec,
      selfIdsFor: () => SELF_IDS,
      verify: () => Promise.resolve(false),
    });
    await ingest.consider(envelope());
    expect(scheduled).toEqual([]);
  });

  test("channel không bật phễu / tin không qua gate → không đặt lịch", async () => {
    const scheduled: PendingQuestion[] = [];
    const pending: ProactivePendingStore = {
      schedule: (q) => {
        scheduled.push(q);
        return Promise.resolve();
      },
      claimDue: () => Promise.resolve([]),
    };
    const off = new ProactiveIngest({ pending, specFor: () => undefined, selfIdsFor: () => [] });
    await off.consider(envelope());

    const on = new ProactiveIngest({ pending, specFor: () => dealerSpec, selfIdsFor: () => SELF_IDS });
    await on.consider(envelope({ text: "Dạ" }));
    expect(scheduled).toEqual([]);
  });
});
