// Test DiscountPort trên fetch giả. Bốn thứ phải chốt:
//   1. POST KHÔNG retry — bắn lại lệnh ghi là ghi hai lần (5xx vẫn ném ngay sau 1 lần gọi).
//   2. Đại lý + nhân viên đi lên HEADER, body chỉ có tier_id/reason.
//   3. Bậc thiếu id/tên/sort_order bị LOẠI — một `sortOrder` bịa là một lần hạ bậc lọt cửa kiểm.
//   4. Response nâng bậc thiếu bằng chứng (schedule_id / to_tier) → lỗi, không báo thành công.

import { describe, expect, test } from "bun:test";
import { AgentApiClient, AgentApiError, type FetchInit, type FetchLike } from "./agent-api.ts";
import { AgentApiDiscountPort } from "./discount-api.ts";

const BASE_URL = "https://api.example.test/api";
const TOKEN = "service-token-test";

interface StubCall {
  readonly url: string;
  readonly init: FetchInit;
}

function stubFetch(status: number, body: unknown): { fetchImpl: FetchLike; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const text = JSON.stringify(body);
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(text) });
  };
  return { fetchImpl, calls };
}

function portWith(fetchImpl: FetchLike): AgentApiDiscountPort {
  return new AgentApiDiscountPort(
    new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
  );
}

const TIER_ROW = {
  id: "12",
  tier_name: "F2",
  display_label: "Đại lý cấp 2",
  is_shareholder: false,
  sort_order: 3,
};

describe("tiers()", () => {
  test("đọc danh mục, id dạng số cũng nhận, display_label null → undefined", async () => {
    const { fetchImpl, calls } = stubFetch(200, {
      success: true,
      data: [{ id: 11, tier_name: "F1", display_label: null, is_shareholder: false, sort_order: 2 }],
    });

    const tiers = await portWith(fetchImpl).tiers({ dealerId: "42", staffId: "7" });

    expect(tiers).toEqual([
      { id: "11", tierName: "F1", displayLabel: undefined, isShareholder: false, sortOrder: 2 },
    ]);
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.headers["x-dealer-id"]).toBe("42");
    expect(calls[0]?.url).toContain("/agent/discount-tiers");
  });

  test("bậc thiếu sort_order bị LOẠI, không hạ cấp thành mặc định", async () => {
    const { fetchImpl } = stubFetch(200, {
      success: true,
      data: [TIER_ROW, { id: "13", tier_name: "F3" }, { tier_name: "F4", sort_order: 5 }],
    });

    const tiers = await portWith(fetchImpl).tiers({ dealerId: "42" });

    expect(tiers.map((tier) => tier.id)).toEqual(["12"]);
  });

  test("data không phải mảng → danh sách rỗng, không throw", async () => {
    const { fetchImpl } = stubFetch(200, { success: true, data: null });

    expect(await portWith(fetchImpl).tiers({ dealerId: "42" })).toEqual([]);
  });
});

describe("upgrade()", () => {
  const OK_BODY = {
    success: true,
    data: {
      schedule_id: "555",
      dealer_code: "DL001",
      from_tier: { id: "11", tier_name: "F1", sort_order: 2 },
      to_tier: TIER_ROW,
      effective_from: "2026-08-09",
      reason: "Đạt doanh số quý 3",
      changed_by: "7",
    },
  };

  test("POST đúng path, người đi header, body chỉ có tier_id + reason", async () => {
    const { fetchImpl, calls } = stubFetch(200, OK_BODY);

    const result = await portWith(fetchImpl).upgrade({
      dealerId: "42",
      staffId: "7",
      tierId: "12",
      reason: "Đạt doanh số quý 3",
    });

    const call = calls[0];
    expect(call?.init.method).toBe("POST");
    expect(call?.url).toContain("/agent/discount-tiers/upgrade");
    expect(call?.init.headers["x-dealer-id"]).toBe("42");
    expect(call?.init.headers["x-staff-id"]).toBe("7");
    expect(call?.init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(call?.init.body ?? "{}")).toEqual({
      tier_id: "12",
      reason: "Đạt doanh số quý 3",
    });
    expect(result.scheduleId).toBe("555");
    expect(result.toTier.tierName).toBe("F2");
    expect(result.fromTier?.sortOrder).toBe(2);
  });

  test("5xx KHÔNG retry — đúng MỘT lần gọi rồi ném", async () => {
    const { fetchImpl, calls } = stubFetch(500, { code: "INTERNAL", message: "toang" });

    await expect(
      portWith(fetchImpl).upgrade({ dealerId: "42", tierId: "12", reason: "Đạt doanh số" }),
    ).rejects.toBeInstanceOf(AgentApiError);
    expect(calls).toHaveLength(1);
  });

  test("response thiếu schedule_id → lỗi shape, KHÔNG dựng kết quả nửa vời", async () => {
    const { fetchImpl } = stubFetch(200, { success: true, data: { to_tier: TIER_ROW } });

    await expect(
      portWith(fetchImpl).upgrade({ dealerId: "42", tierId: "12", reason: "Đạt doanh số" }),
    ).rejects.toBeInstanceOf(AgentApiError);
  });

  test("from_tier null (chưa từng xếp bậc) vẫn là kết quả hợp lệ", async () => {
    const { fetchImpl } = stubFetch(200, {
      success: true,
      data: { schedule_id: "556", to_tier: TIER_ROW, from_tier: null },
    });

    const result = await portWith(fetchImpl).upgrade({
      dealerId: "42",
      tierId: "12",
      reason: "Xếp bậc lần đầu",
    });

    expect(result.fromTier).toBeUndefined();
    expect(result.scheduleId).toBe("556");
  });
});
