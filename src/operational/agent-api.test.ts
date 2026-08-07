// Test client `/agent/*`: header dựng ĐÚNG (đây là thứ ép phạm vi đại lý — sai header là rò dữ
// liệu đại lý khác), và 404 map thành "không tìm thấy đơn" chứ không thành sự cố hệ thống.
//
// Không import config.ts: client nhận baseUrl/token qua constructor nên test chạy không cần env.

import { describe, expect, test } from "bun:test";
import {
  AgentApiClient,
  AgentApiError,
  buildAgentHeaders,
  type FetchInit,
  type FetchLike,
} from "./agent-api.ts";
import { AgentApiOrderPort } from "./order-api.ts";
import { AgentApiDealerPort } from "./profile-api.ts";

const BASE_URL = "https://api.example.test/api";
const TOKEN = "service-token-test";

/** fetch giả: ghi lại request cuối + trả response dựng sẵn. */
interface StubCall {
  readonly url: string;
  readonly init: FetchInit;
}

function stubFetch(
  status: number,
  body: unknown,
): { fetchImpl: FetchLike; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const text = JSON.stringify(body);
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: status < 400,
      status,
      text: () => Promise.resolve(text),
    });
  };
  return { fetchImpl, calls };
}

describe("buildAgentHeaders", () => {
  test("đủ service-token + dealer, kèm staff khi là id số", () => {
    expect(buildAgentHeaders(TOKEN, { dealerId: "42", staffId: "7" })).toEqual({
      "x-service-token": TOKEN,
      "x-dealer-id": "42",
      "x-staff-id": "7",
    });
  });

  test("không có staff → BỎ HẲN header (không gửi chuỗi rỗng)", () => {
    const headers = buildAgentHeaders(TOKEN, { dealerId: "42" });
    expect(headers["x-dealer-id"]).toBe("42");
    expect("x-staff-id" in headers).toBe(false);
  });

  test("staffId không phải bigint (uuid) → bỏ, request vẫn đi bằng dealer", () => {
    const headers = buildAgentHeaders(TOKEN, {
      dealerId: "42",
      staffId: "0f9c1a2e-1111-2222-3333-444455556666",
    });
    expect("x-staff-id" in headers).toBe(false);
  });
});

describe("AgentApiClient.get", () => {
  test("gắn header + query, ghép URL dưới baseUrl", async () => {
    const { fetchImpl, calls } = stubFetch(200, { success: true, data: [] });
    const client = new AgentApiClient({
      baseUrl: BASE_URL,
      serviceToken: TOKEN,
      fetchImpl,
    });

    await client.get("/agent/orders", {
      principal: { dealerId: "42", staffId: "7" },
      query: { search: "VTP01", status: 6, page_size: 10 },
    });

    const call = calls[0];
    expect(call).toBeDefined();
    expect(call?.url).toBe(
      "https://api.example.test/api/agent/orders?search=VTP01&status=6&page_size=10",
    );
    expect(call?.init.headers).toEqual({
      "x-service-token": TOKEN,
      "x-dealer-id": "42",
      "x-staff-id": "7",
    });
  });

  test("query undefined bị bỏ khỏi URL", async () => {
    const { fetchImpl, calls } = stubFetch(200, { success: true, data: [] });
    const client = new AgentApiClient({
      baseUrl: BASE_URL,
      serviceToken: TOKEN,
      fetchImpl,
    });

    await client.get("/agent/orders", {
      principal: { dealerId: "42" },
      query: { search: undefined, status: undefined },
    });

    expect(calls[0]?.url).toBe("https://api.example.test/api/agent/orders");
  });

  test("4xx → AgentApiError mang code backend, KHÔNG retry", async () => {
    const { fetchImpl, calls } = stubFetch(404, {
      code: "ORDER_NOT_FOUND",
      message: "không có đơn",
    });
    const client = new AgentApiClient({
      baseUrl: BASE_URL,
      serviceToken: TOKEN,
      fetchImpl,
    });

    const error = await client
      .get("/agent/orders/VTP01", { principal: { dealerId: "42" } })
      .then(() => undefined)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AgentApiError);
    expect((error as AgentApiError).status).toBe(404);
    expect((error as AgentApiError).code).toBe("ORDER_NOT_FOUND");
    expect(calls.length).toBe(1);
  });

  test("lỗi KHÔNG chứa service token", async () => {
    const { fetchImpl } = stubFetch(403, {
      code: "AUTH_INSUFFICIENT_PERMISSIONS",
      message: "sai scope",
    });
    const client = new AgentApiClient({
      baseUrl: BASE_URL,
      serviceToken: TOKEN,
      fetchImpl,
    });

    const error = await client
      .get("/agent/orders", { principal: { dealerId: "42" } })
      .then(() => undefined)
      .catch((err: unknown) => err);

    expect(String(error)).not.toContain(TOKEN);
  });
});

describe("AgentApiOrderPort", () => {
  test("404 → detail trả null (không có đơn đó của đại lý), KHÔNG throw", async () => {
    const { fetchImpl } = stubFetch(404, {
      code: "ORDER_NOT_FOUND",
      message: "không có đơn",
    });
    const port = new AgentApiOrderPort(
      new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
    );

    expect(
      await port.detail({ dealerId: "42", trackingNumber: "VTP01" }),
    ).toBeNull();
  });

  test("404 → cameraLinks trả rỗng", async () => {
    const { fetchImpl } = stubFetch(404, {
      code: "ORDER_NOT_FOUND",
      message: "không có đơn",
    });
    const port = new AgentApiOrderPort(
      new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
    );

    expect(
      await port.cameraLinks({ dealerId: "42", trackingNumber: "VTP01" }),
    ).toEqual([]);
  });

  test("403 (sai scope) KHÔNG bị nuốt thành null — đó là sự cố cấu hình, không phải 'không có đơn'", async () => {
    const { fetchImpl } = stubFetch(403, {
      code: "AUTH_INSUFFICIENT_PERMISSIONS",
      message: "sai scope",
    });
    const port = new AgentApiOrderPort(
      new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
    );

    expect(
      port.detail({ dealerId: "42", trackingNumber: "VTP01" }),
    ).rejects.toThrow(AgentApiError);
  });

  test("mã vận đơn có ký tự lạ được encode vào path", async () => {
    const { fetchImpl, calls } = stubFetch(200, { success: true, data: [] });
    const port = new AgentApiOrderPort(
      new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
    );

    await port.cameraLinks({ dealerId: "42", trackingNumber: "VTP 01/A" });

    expect(calls[0]?.url).toBe(
      "https://api.example.test/api/agent/orders/VTP%2001%2FA/camera-links",
    );
  });

  test("parse đơn: tiền giữ nguyên CHUỖI, mã trạng thái giữ nguyên số", async () => {
    const { fetchImpl } = stubFetch(200, {
      success: true,
      data: [
        {
          tracking_number: "VTP01",
          status: 6,
          carrier: 1,
          total_amount: "1234567.00",
          customer_name: "Nguyễn A",
          created_at: "2026-08-01T03:00:00Z",
          items: [
            {
              item_name: "Sữa",
              sku: "SKU1",
              quantity: 2,
              unit_price: "100.00",
              line_total: "200.00",
            },
          ],
        },
        { status: 6 }, // thiếu tracking_number → bỏ, không đưa mã rỗng cho model
      ],
      meta: { total: 9 },
    });
    const port = new AgentApiOrderPort(
      new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
    );

    const page = await port.search({ dealerId: "42" });
    expect(page.total).toBe(9);
    expect(page.orders.length).toBe(1);
    expect(page.orders[0]?.totalAmount).toBe("1234567.00");
    expect(page.orders[0]?.status).toBe(6);
    expect(page.orders[0]?.items?.[0]?.quantity).toBe(2);
  });

  test("payment: 404 → null (không tìm thấy đơn của đại lý này), KHÔNG throw", async () => {
    const { fetchImpl, calls } = stubFetch(404, {
      code: "ORDER_NOT_FOUND",
      message: "không có đơn",
    });
    const port = new AgentApiOrderPort(
      new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
    );

    expect(await port.payment({ dealerId: "42", trackingNumber: "VTP01" })).toBeNull();
    expect(calls[0]?.url).toBe("https://api.example.test/api/agent/orders/VTP01/payment");
    expect(calls[0]?.init.headers).toEqual({
      "x-service-token": TOKEN,
      "x-dealer-id": "42",
    });
  });

  test("payment: tiền giữ nguyên CHUỖI, nội dung CK giữ nguyên văn", async () => {
    const { fetchImpl } = stubFetch(200, {
      success: true,
      data: {
        order_id: "123",
        tracking_number: "GHTK123456",
        dealer_code: "DL001",
        dealer_name: "Đại lý A",
        carrier: 0,
        base_amount: "1000000.00",
        packaging_fee: "5000.00",
        amount: "1005000.00",
        items: [
          { order_item_id: "9", dealer_unit_price: "500000", dealer_line_total: "1000000" },
          { dealer_line_total: "1" }, // thiếu order_item_id → bỏ
        ],
        bank: {
          bank_code: "VCB",
          bank_name: "Vietcombank",
          account_number: "0011000123456",
          account_name: "CONG TY DILI",
        },
        transfer_content: "NAP DL001",
        qr_url: "https://qr.example/abc",
      },
    });
    const port = new AgentApiOrderPort(
      new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
    );

    const payment = await port.payment({ dealerId: "42", trackingNumber: "GHTK123456" });
    expect(payment?.amount).toBe("1005000.00");
    expect(payment?.baseAmount).toBe("1000000.00");
    expect(payment?.packagingFee).toBe("5000.00");
    expect(payment?.transferContent).toBe("NAP DL001");
    expect(payment?.bank?.accountNumber).toBe("0011000123456");
    expect(payment?.items.map((item) => item.orderItemId)).toEqual(["9"]);
  });

  test("payment: thiếu amount → lỗi shape, KHÔNG trả khối chuyển khoản thiếu số tiền", async () => {
    const { fetchImpl } = stubFetch(200, {
      success: true,
      data: { tracking_number: "VTP01", transfer_content: "NAP DL001" },
    });
    const port = new AgentApiOrderPort(
      new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
    );

    expect(port.payment({ dealerId: "42", trackingNumber: "VTP01" })).rejects.toThrow(AgentApiError);
  });
});

describe("AgentApiDealerPort", () => {
  test("profile: bóc envelope, đại lý đi bằng header (không phải query)", async () => {
    const { fetchImpl, calls } = stubFetch(200, {
      success: true,
      data: {
        code: "DL0123",
        name: "Nguyễn Văn A",
        joined_at: "2025-03-11",
        referral_level: 2,
        is_shareholder: false,
        uses_brand: true,
        referrer_code: "DL0007",
        staff_name: "Trần C",
        discount_tier_id: 12,
        discount_tier_name: "F2",
        discount_tier_label: "Đại lý cấp 2",
        discount_effective_from: "2025-06-01",
      },
    });
    const port = new AgentApiDealerPort(
      new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
    );

    const profile = await port.profile({ dealerId: "42", staffId: "77" });
    expect(profile?.code).toBe("DL0123");
    expect(profile?.discountTierName).toBe("F2");
    expect(profile?.discountTierLabel).toBe("Đại lý cấp 2");
    // id bigint trả dạng số vẫn về chuỗi, không tính toán gì lên nó.
    expect(profile?.discountTierId).toBe("12");
    expect(profile?.referralLevel).toBe(2);
    expect(profile?.isShareholder).toBe(false);
    expect(calls[0]?.url).toBe(`${BASE_URL}/agent/profile`);
    expect(calls[0]?.init.headers["x-dealer-id"]).toBe("42");
    expect(calls[0]?.init.headers["x-staff-id"]).toBe("77");
  });

  test("profile: discount_* null → undefined (chưa xếp bậc), KHÔNG bịa bậc mặc định", async () => {
    const { fetchImpl } = stubFetch(200, {
      success: true,
      data: {
        code: "DL0999",
        name: "Đại lý mới",
        discount_tier_id: null,
        discount_tier_name: null,
        discount_tier_label: null,
        discount_effective_from: null,
      },
    });
    const port = new AgentApiDealerPort(
      new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
    );

    const profile = await port.profile({ dealerId: "42" });
    expect(profile?.code).toBe("DL0999");
    expect(profile?.discountTierName).toBeUndefined();
    expect(profile?.discountEffectiveFrom).toBeUndefined();
  });

  test("profile: 404 → null (không có hồ sơ), không phải sự cố", async () => {
    const { fetchImpl } = stubFetch(404, { code: "NOT_FOUND", message: "no dealer" });
    const port = new AgentApiDealerPort(
      new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
    );

    expect(await port.profile({ dealerId: "42" })).toBeNull();
  });

  test("profile: 500 → throw (tool phải báo trục trặc, không báo 'chưa có bậc')", async () => {
    const { fetchImpl } = stubFetch(500, { code: "INTERNAL", message: "boom" });
    const port = new AgentApiDealerPort(
      new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
    );

    expect(port.profile({ dealerId: "42" })).rejects.toThrow(AgentApiError);
  });
});
