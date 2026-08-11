// Test tầng đo chi phí LLM: quy giá, cộng dồn theo lượt, mốc ngày giờ VN, gate ngân sách, và
// sổ cái (Postgres fake + Redis fake). KHÔNG network/DB, KHÔNG import config.ts (fail-fast env).

import { describe, expect, test } from "bun:test";
import { AgentType } from "../agents/types.ts";
import type { LlmUsage } from "../llm/types.ts";
import type { RedisCommand } from "../redis/types.ts";
import { costPicoUsd, picoUsdToVnd, vndToPicoUsd, PICO_PER_USD } from "./pricing.ts";
import { UsageMeter, sumUsage } from "./meter.ts";
import { dailyBudgetVnd, secondsUntilNextDay, usageDay } from "./budget.ts";
import { checkDailyBudget } from "./gate.ts";
import { SqlUsageStore, type SqlRunner } from "./store.ts";
import type { UsagePort } from "./types.ts";

const RATE = 26_000;

function usage(partial: Partial<LlmUsage>): LlmUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...partial };
}

// ─── pricing ────────────────────────────────────────────────────────────────

describe("costPicoUsd", () => {
  test("mỗi loại token tính theo đơn giá riêng", () => {
    expect(costPicoUsd(usage({ input: 1 }))).toBe(280_000);
    expect(costPicoUsd(usage({ output: 1 }))).toBe(480_000);
    expect(costPicoUsd(usage({ cacheRead: 1 }))).toBe(4_800);
  });

  test("token output đắt gấp 100 lần token cache hit — LÝ DO không đếm token trần", () => {
    expect(costPicoUsd(usage({ output: 1 }))).toBe(costPicoUsd(usage({ cacheRead: 100 })));
  });

  test("cộng đủ bốn loại", () => {
    const cost = costPicoUsd(usage({ input: 3_000, output: 2_000, cacheRead: 40_000 }));
    expect(cost).toBe(3_000 * 280_000 + 2_000 * 480_000 + 40_000 * 4_800);
  });

  test("luôn ra số nguyên (INCRBY của Redis chỉ nhận số nguyên)", () => {
    const cost = costPicoUsd(usage({ input: 7, output: 13, cacheRead: 999, cacheWrite: 5 }));
    expect(Number.isInteger(cost)).toBe(true);
  });

  test("một ngày của một phòng vẫn nằm trong khoảng an toàn của Number", () => {
    // 10.000đ ở tỉ giá 26k ≈ 3,8e11 pico — cách MAX_SAFE_INTEGER (9e15) bốn bậc.
    expect(vndToPicoUsd(10_000, RATE)).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe("vndToPicoUsd", () => {
  test("quy đổi theo tỉ giá", () => {
    expect(vndToPicoUsd(26_000, RATE)).toBe(PICO_PER_USD);
  });

  test("đi rồi về gần như không lệch", () => {
    expect(picoUsdToVnd(vndToPicoUsd(10_000, RATE), RATE)).toBeCloseTo(10_000, 3);
  });

  test("tỉ giá <= 0 → throw, không âm thầm cho trần vô hạn", () => {
    expect(() => vndToPicoUsd(10_000, 0)).toThrow();
  });
});

// ─── meter ──────────────────────────────────────────────────────────────────

describe("UsageMeter", () => {
  test("cộng dồn MỌI vòng, không chỉ vòng cuối", () => {
    const meter = new UsageMeter();
    meter.add(usage({ input: 100, output: 50, cacheRead: 1_000 }));
    meter.add(usage({ input: 20, output: 30, cacheRead: 2_000 }));
    expect(meter.total()).toEqual(usage({ input: 120, output: 80, cacheRead: 3_000 }));
    expect(meter.callCount()).toBe(2);
  });

  test("chưa gọi model lần nào → rỗng (flash command, lượt bị chặn)", () => {
    expect(new UsageMeter().isEmpty()).toBe(true);
  });

  test("gọi model trả usage toàn 0 vẫn KHÔNG rỗng — có gọi là có tính tiền", () => {
    const meter = new UsageMeter();
    meter.add(usage({}));
    expect(meter.isEmpty()).toBe(false);
  });

  test("sumUsage gộp danh sách", () => {
    expect(sumUsage([usage({ input: 1 }), usage({ output: 2 })])).toEqual(
      usage({ input: 1, output: 2 }),
    );
  });
});

// ─── mốc ngày ───────────────────────────────────────────────────────────────

describe("usageDay", () => {
  test("theo giờ VN, KHÔNG theo UTC", () => {
    // 2026-08-11T18:00Z = 01:00 ngày 12/08 giờ VN → phải là ngày 12, không phải 11.
    expect(usageDay(new Date("2026-08-11T18:00:00Z"))).toBe("2026-08-12");
  });

  test("luôn ra dạng YYYY-MM-DD, không phụ thuộc locale data của máy chạy", () => {
    // Máy thiếu locale data mà lấy nguyên chuỗi format() sẽ ra "08/11/2026" → khoá ngày sai,
    // sổ cái gom nhầm ngày mà không có gì báo lỗi.
    expect(usageDay(new Date("2026-08-11T18:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("ngay trước nửa đêm VN vẫn là ngày cũ", () => {
    // 2026-08-11T16:59Z = 23:59 ngày 11/08 giờ VN.
    expect(usageDay(new Date("2026-08-11T16:59:00Z"))).toBe("2026-08-11");
  });
});

describe("secondsUntilNextDay", () => {
  test("đúng nửa đêm VN → trọn một ngày", () => {
    // 2026-08-11T17:00Z = 00:00 ngày 12/08 giờ VN.
    expect(secondsUntilNextDay(new Date("2026-08-11T17:00:00Z"))).toBe(86_400);
  });

  test("còn 1 phút tới nửa đêm VN", () => {
    expect(secondsUntilNextDay(new Date("2026-08-11T16:59:00Z"))).toBe(60);
  });

  test("không bao giờ trả 0 (SET key hết hạn ngay thì mất bộ đếm)", () => {
    expect(secondsUntilNextDay(new Date("2026-08-11T16:59:59Z"))).toBeGreaterThan(0);
  });
});

// ─── trần theo agent ────────────────────────────────────────────────────────

describe("dailyBudgetVnd", () => {
  test("nhóm ngoài (đại lý) có trần", () => {
    expect(dailyBudgetVnd(AgentType.Dealer)).toBe(10_000);
  });

  test("nhóm nội bộ khai null = không chặn", () => {
    expect(dailyBudgetVnd(AgentType.Boss)).toBeNull();
  });

  test("agent chưa khai (kể cả default) rơi về mức thủ, KHÔNG mở toang", () => {
    expect(dailyBudgetVnd("default")).toBe(10_000);
    expect(dailyBudgetVnd("agent-moi-tinh")).toBe(10_000);
  });
});

// ─── gate ───────────────────────────────────────────────────────────────────

function fakeUsagePort(spentPico: number): UsagePort {
  return {
    spentTodayPicoUsd: () => Promise.resolve(spentPico),
    record: () => Promise.resolve(),
  };
}

describe("checkDailyBudget", () => {
  const base = {
    conversationId: "g1",
    agentType: AgentType.Dealer,
    usdVndRate: RATE,
    enforce: true,
  };

  test("dưới trần → cho chạy", async () => {
    const decision = await checkDailyBudget({ ...base, usage: fakeUsagePort(vndToPicoUsd(3_000, RATE)) });
    expect(decision.allowed).toBe(true);
    expect(decision.spentVnd).toBeCloseTo(3_000, 0);
    expect(decision.limitVnd).toBe(10_000);
  });

  test("chạm trần → chặn", async () => {
    const decision = await checkDailyBudget({ ...base, usage: fakeUsagePort(vndToPicoUsd(10_000, RATE)) });
    expect(decision.allowed).toBe(false);
  });

  test("vượt trần nhưng enforce=false (shadow mode) → VẪN cho chạy, chỉ báo số", async () => {
    const decision = await checkDailyBudget({
      ...base,
      enforce: false,
      usage: fakeUsagePort(vndToPicoUsd(50_000, RATE)),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.spentVnd).toBeCloseTo(50_000, 0);
  });

  test("agent khai null → cho chạy, KHÔNG cần hỏi sổ", async () => {
    let asked = false;
    const port: UsagePort = {
      spentTodayPicoUsd: () => {
        asked = true;
        return Promise.resolve(0);
      },
      record: () => Promise.resolve(),
    };
    const decision = await checkDailyBudget({ ...base, agentType: AgentType.Boss, usage: port });
    expect(decision.allowed).toBe(true);
    expect(decision.limitVnd).toBeNull();
    expect(asked).toBe(false);
  });
});

// ─── sổ cái ─────────────────────────────────────────────────────────────────

/** Redis giả: Map + ghi lại lệnh, đủ cho GET/SET/INCRBY/EXPIRE. */
class FakeRedis {
  readonly store = new Map<string, number>();
  readonly calls: string[] = [];

  readonly send: RedisCommand = (name, args) => {
    this.calls.push(name);
    const key = args[0] ?? "";
    switch (name) {
      case "GET": {
        const value = this.store.get(key);
        return Promise.resolve(value === undefined ? null : String(value));
      }
      case "SET":
        this.store.set(key, Number(args[1]));
        return Promise.resolve("OK");
      case "INCRBY": {
        const next = (this.store.get(key) ?? 0) + Number(args[1]);
        this.store.set(key, next);
        return Promise.resolve(next);
      }
      case "EXPIRE":
        return Promise.resolve(1);
      default:
        return Promise.resolve(null);
    }
  };
}

/**
 * Postgres giả. `insertedIds` mô phỏng ON CONFLICT DO NOTHING ... RETURNING: mảng rỗng = msgId
 * đã có. `sumRows` là kết quả của query SUM (driver trả numeric dạng STRING — mô phỏng đúng vậy).
 */
function fakeSql(options: {
  seenMsgIds?: Set<string>;
  sumPico?: number;
}): { runner: SqlRunner; inserts: unknown[][] } {
  const seen = options.seenMsgIds ?? new Set<string>();
  const inserts: unknown[][] = [];
  const runner: SqlRunner = (strings, ...values) => {
    const text = strings.join("?");
    if (text.includes("INSERT INTO llm_usage_log")) {
      const msgId = String(values[2]);
      if (seen.has(msgId)) return Promise.resolve([]);
      seen.add(msgId);
      inserts.push(values);
      return Promise.resolve([{ id: inserts.length }]);
    }
    // SUM trả numeric → driver đưa về string. Cố tình trả string để test phần narrow.
    return Promise.resolve([{ total: String(options.sumPico ?? 0) }]);
  };
  return { runner, inserts };
}

describe("SqlUsageStore", () => {
  const entry = {
    conversationId: "g1",
    agentType: AgentType.Dealer,
    msgId: "m1",
    usage: usage({ input: 1_000, output: 500 }),
  };
  const cost = costPicoUsd(entry.usage);

  test("record: ghi sổ rồi cộng bộ đếm", async () => {
    const redis = new FakeRedis();
    const { runner, inserts } = fakeSql({});
    await new SqlUsageStore(runner, redis.send).record(entry);

    expect(inserts).toHaveLength(1);
    expect([...redis.store.values()]).toEqual([cost]);
  });

  test("record: key vừa tạo thì đặt TTL (không có TTL là bộ đếm không bao giờ reset)", async () => {
    const redis = new FakeRedis();
    const { runner } = fakeSql({});
    await new SqlUsageStore(runner, redis.send).record(entry);
    expect(redis.calls).toContain("EXPIRE");
  });

  test("record: lượt thứ hai KHÔNG đặt lại TTL (đặt lại là đẩy mốc trôi qua nửa đêm)", async () => {
    const redis = new FakeRedis();
    const { runner } = fakeSql({});
    const store = new SqlUsageStore(runner, redis.send);
    await store.record(entry);
    redis.calls.length = 0;
    await store.record({ ...entry, msgId: "m2" });
    expect(redis.calls).not.toContain("EXPIRE");
  });

  test("record: msgId trùng (broker giao lại) → KHÔNG cộng đôi", async () => {
    const redis = new FakeRedis();
    const { runner, inserts } = fakeSql({});
    const store = new SqlUsageStore(runner, redis.send);
    await store.record(entry);
    await store.record(entry);

    expect(inserts).toHaveLength(1);
    expect([...redis.store.values()]).toEqual([cost]);
  });

  test("spentToday: bộ đếm còn → đọc thẳng, không đụng Postgres", async () => {
    const redis = new FakeRedis();
    const { runner } = fakeSql({ sumPico: 999 });
    const store = new SqlUsageStore(runner, redis.send);
    await store.record(entry);

    expect(await store.spentTodayPicoUsd("g1")).toBe(cost);
  });

  test("MẤT REDIS: bộ đếm rỗng → dựng lại từ sổ cái, không reset về 0", async () => {
    const redis = new FakeRedis();
    const { runner } = fakeSql({ sumPico: 7_777_777 });
    const store = new SqlUsageStore(runner, redis.send);

    expect(await store.spentTodayPicoUsd("g1")).toBe(7_777_777);
  });

  test("MẤT REDIS: dựng lại xong thì nạp luôn vào bộ đếm (lượt sau khỏi hỏi Postgres)", async () => {
    const redis = new FakeRedis();
    const { runner } = fakeSql({ sumPico: 4_242 });
    const store = new SqlUsageStore(runner, redis.send);
    await store.spentTodayPicoUsd("g1");

    expect([...redis.store.values()]).toEqual([4_242]);
  });

  test("phòng chưa tiêu gì → 0", async () => {
    const redis = new FakeRedis();
    const { runner } = fakeSql({});
    expect(await new SqlUsageStore(runner, redis.send).spentTodayPicoUsd("g-moi")).toBe(0);
  });

  test("bộ đếm tách theo phòng", async () => {
    const redis = new FakeRedis();
    const { runner } = fakeSql({});
    const store = new SqlUsageStore(runner, redis.send);
    await store.record(entry);
    await store.record({ ...entry, conversationId: "g2", msgId: "m9" });

    expect(await store.spentTodayPicoUsd("g1")).toBe(cost);
    expect(await store.spentTodayPicoUsd("g2")).toBe(cost);
  });
});
