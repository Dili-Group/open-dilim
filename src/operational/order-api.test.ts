// Test createPaymentBatch() của OrderPort trên fetch giả. Bốn thứ phải chốt:
//   1. POST KHÔNG retry — bắn lại lệnh ghi là HAI phiếu (5xx vẫn ném ngay sau 1 lần gọi).
//   2. Đại lý + nhân viên đi lên HEADER, body chỉ có `tracking_numbers`.
//   3. 404 → null (có mã không tồn tại/không thuộc đại lý — backend cố ý không phân biệt).
//   4. Response thiếu bằng chứng (code / transfer_content / total_amount) → lỗi, không báo
//      thành công nửa vời.

import { describe, expect, test } from "bun:test";
import { AgentApiClient, AgentApiError, type FetchInit, type FetchLike } from "./agent-api.ts";
import { AgentApiOrderPort } from "./order-api.ts";

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

function portWith(fetchImpl: FetchLike): AgentApiOrderPort {
  return new AgentApiOrderPort(
    new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl }),
  );
}

const OK_BODY = {
  success: true,
  data: {
    uuid: "8f1c0c1e-6b2f-4a5e-9c3d-2f7b5a1d0e11",
    code: "000123",
    transfer_content: "DH000123",
    qr_url: "https://qr.sepay.vn/img?acc=1&des=DH000123&amount=5000000",
    total_amount: "5000000.00",
    paid_amount: "0.00",
    status: 0,
    order_ids: ["10234", 10235],
    order_count: 2,
    paid_at: null,
    created_at: "2026-08-14T02:30:00.000Z",
    bank: { bank_name: "Vietcombank", account_number: "0011000123456", account_name: "CONG TY DILI" },
  },
};

describe("createPaymentBatch()", () => {
  test("POST đúng path; đại lý + nhân viên lên header, body chỉ có tracking_numbers", async () => {
    const { fetchImpl, calls } = stubFetch(201, OK_BODY);

    const batch = await portWith(fetchImpl).createPaymentBatch({
      dealerId: "42",
      staffId: "7",
      trackingNumbers: ["S12345678", "S12345679"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/agent/payment-batches");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers["x-dealer-id"]).toBe("42");
    expect(calls[0]?.init.headers["x-staff-id"]).toBe("7");
    expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({
      tracking_numbers: ["S12345678", "S12345679"],
    });

    expect(batch).toEqual({
      code: "000123",
      transferContent: "DH000123",
      totalAmount: "5000000.00",
      paidAmount: "0.00",
      qrUrl: "https://qr.sepay.vn/img?acc=1&des=DH000123&amount=5000000",
      uuid: "8f1c0c1e-6b2f-4a5e-9c3d-2f7b5a1d0e11",
      status: 0,
      // order_ids bigint có thể về dạng số — giữ nguyên chữ số dạng chuỗi.
      orderIds: ["10234", "10235"],
      orderCount: 2,
      createdAt: "2026-08-14T02:30:00.000Z",
      bank: {
        bankCode: undefined,
        bankName: "Vietcombank",
        accountNumber: "0011000123456",
        accountName: "CONG TY DILI",
      },
    });
  });

  test("404 → null (phiếu chưa tạo), không throw", async () => {
    const { fetchImpl } = stubFetch(404, { code: "ORDER_NOT_FOUND", message: "not found" });

    const batch = await portWith(fetchImpl).createPaymentBatch({
      dealerId: "42",
      trackingNumbers: ["S00000000"],
    });

    expect(batch).toBeNull();
  });

  test("5xx KHÔNG retry — ném ngay sau đúng 1 lần gọi", async () => {
    const { fetchImpl, calls } = stubFetch(500, { message: "boom" });

    await expect(
      portWith(fetchImpl).createPaymentBatch({ dealerId: "42", trackingNumbers: ["S12345678"] }),
    ).rejects.toBeInstanceOf(AgentApiError);
    expect(calls).toHaveLength(1);
  });

  test("response thiếu total_amount → lỗi shape, không dựng phiếu nửa vời", async () => {
    const { fetchImpl } = stubFetch(201, {
      success: true,
      data: { code: "000123", transfer_content: "DH000123" },
    });

    await expect(
      portWith(fetchImpl).createPaymentBatch({ dealerId: "42", trackingNumbers: ["S12345678"] }),
    ).rejects.toBeInstanceOf(AgentApiError);
  });
});

// codCheck(): parse response engine kiểm giá. Ba thứ phải chốt:
//   1. Có tracking_number thì body CHỈ có tracking_number (items/cod không đi kèm cho đỡ nhiễu);
//      giỏ tự nhập thì body có items + cod.
//   2. Response map đúng field lồng nhau (verdict/via/retailRemainder, order.cod_amount).
//   3. 404 → null; thiếu cod/verdict.status → lỗi shape.
describe("codCheck()", () => {
  const ENGINE_BODY = {
    success: true,
    data: {
      input: "tracking_number",
      cod: 6450000,
      order: { tracking_number: "VTP01", cod_amount: "6500000.00", shipping_fee: "50000.00" },
      verdict: {
        status: "VALID_COMBO",
        optimal: 6400000,
        overpay: 50000,
        validCount: 3,
        via: {
          group: "TH1",
          parts: [{ id: 12, campaign: "TH1_MXNBH", label: "Mix x6", price: 6450000, items: { MXNBH: 6 }, gifts: { MXNBH: 1 } }],
          retailRemainder: { items: {}, amount: 0 },
        },
        optimalVia: { group: "TH1", parts: [{ label: "Mix x6 ưu đãi", price: 6400000 }] },
      },
      risk: "YELLOW",
      cart: { MXNBH: 6 },
      gift_items: { MXNBH: 1 },
      paid_items: { MXNBH: 5 },
      pricing_epoch: 2,
      hypotheses: [],
    },
  };

  test("theo mã vận đơn: body chỉ có tracking_number, response map đủ field lồng nhau", async () => {
    const { fetchImpl, calls } = stubFetch(200, ENGINE_BODY);

    const result = await portWith(fetchImpl).codCheck({ dealerId: "42", trackingNumber: "VTP01" });

    expect(calls[0]?.url).toContain("/agent/orders/cod-check");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({ tracking_number: "VTP01" });

    expect(result).toEqual({
      input: "tracking_number",
      cod: 6450000,
      risk: "YELLOW",
      verdict: {
        status: "VALID_COMBO",
        optimal: 6400000,
        overpay: 50000,
        nearest: [],
        validCount: 3,
        via: {
          group: "TH1",
          parts: [{ label: "Mix x6", price: 6450000, items: { MXNBH: 6 }, gifts: { MXNBH: 1 } }],
          retailRemainderAmount: 0,
        },
        optimalVia: {
          group: "TH1",
          parts: [{ label: "Mix x6 ưu đãi", price: 6400000, items: undefined, gifts: undefined }],
          retailRemainderAmount: undefined,
        },
      },
      cart: { MXNBH: 6 },
      giftItems: { MXNBH: 1 },
      paidItems: { MXNBH: 5 },
      pricingEpoch: 2,
      orderCodAmount: "6500000.00",
      hypotheses: [],
    });
  });

  test("giỏ tự nhập: body có items + cod, không có tracking_number", async () => {
    const { fetchImpl, calls } = stubFetch(200, {
      success: true,
      data: { input: "cart", cod: 6450000, order: null, verdict: { status: "OPTIMAL" } },
    });

    const result = await portWith(fetchImpl).codCheck({
      dealerId: "42",
      items: { MXNBH: 6 },
      cod: 6450000,
    });

    expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({ items: { MXNBH: 6 }, cod: 6450000 });
    expect(result?.verdict.status).toBe("OPTIMAL");
    expect(result?.orderCodAmount).toBeUndefined();
  });

  test("404 ORDER_NOT_FOUND → null", async () => {
    const { fetchImpl } = stubFetch(404, { code: "ORDER_NOT_FOUND", message: "not found" });
    const result = await portWith(fetchImpl).codCheck({ dealerId: "42", trackingNumber: "X" });
    expect(result).toBeNull();
  });

  test("thiếu verdict.status → lỗi shape, không dựng kết luận nửa vời", async () => {
    const { fetchImpl } = stubFetch(200, { success: true, data: { cod: 100, verdict: {} } });
    await expect(
      portWith(fetchImpl).codCheck({ dealerId: "42", trackingNumber: "VTP01" }),
    ).rejects.toBeInstanceOf(AgentApiError);
  });
});
