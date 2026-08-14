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
