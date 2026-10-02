// Test OrderConfirmPort.findDealer trên `GET /agent/dealers/lookup?code=` (endpoint sẵn có của
// backend): 404 = không có mã → null; lỗi khác bubble; id bigint nhận cả chuỗi lẫn số; KHÔNG gắn
// `x-dealer-id` (việc của nó là tra RA đại lý).

import { describe, expect, test } from "bun:test";
import { AgentApiClient, type FetchInit, type FetchLike } from "./agent-api.ts";
import { AgentApiOrderConfirmPort, composeNote } from "./xac-nhan-api.ts";
import type { NewRegistration } from "./types.ts";

const BASE_URL = "https://api.example.test/api";

function portWith(status: number, body: unknown): {
  port: AgentApiOrderConfirmPort;
  calls: { url: string; init: FetchInit }[];
} {
  const calls: { url: string; init: FetchInit }[] = [];
  const text = JSON.stringify(body);
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(text) });
  };
  const api = new AgentApiClient({ baseUrl: BASE_URL, serviceToken: "t", fetchImpl });
  return { port: new AgentApiOrderConfirmPort(api), calls };
}

describe("findDealer", () => {
  test("có mã → trả mã HỆ THỐNG lưu + id, gọi đúng path, không gắn đại lý", async () => {
    const { port, calls } = portWith(200, {
      success: true,
      data: { id: 42, uuid: "u", code: "NVH", name: "Đại lý NVH", phone: null, zalo_group_id: null },
    });
    expect(await port.findDealer("nvh")).toEqual({ id: "42", code: "NVH", name: "Đại lý NVH" });
    expect(calls[0]?.url).toBe(`${BASE_URL}/agent/dealers/lookup?code=nvh`);
    expect(calls[0]?.init.headers["x-dealer-id"]).toBeUndefined();
  });

  test("404 → null (mã không có / đại lý đã ngưng)", async () => {
    const { port } = portWith(404, {
      success: false,
      error: { code: "ERR_DEALER_NOT_FOUND", message: "Không tìm thấy đại lý VĐĐ" },
    });
    expect(await port.findDealer("VĐĐ")).toBeNull();
  });

  test("lỗi khác (403 thiếu scope, 5xx) → ném, KHÔNG giả làm 'không có mã'", async () => {
    const { port } = portWith(403, { success: false });
    await expect(port.findDealer("NVH")).rejects.toThrow();
  });
});

const REGISTRATION: NewRegistration = {
  day: "2026-09-29",
  slot: "chieu",
  onTime: true,
  stt: 5,
  dealerCode: "VDD",
  dealerId: "42",
  threadId: "G-XN",
  saleName: "Linh",
  customerName: "Chị Hồng",
  phone: "94501",
  condition: "chóng mặt, rối loạn tiền đình",
  product: "Natto",
  closed: false,
  reason: "thấy nhiều bác Sơn trên mạng nên sợ giả mạo",
};

describe("register", () => {
  test("POST đúng path, body ĐÚNG 5 khoá (backend forbidNonWhitelisted)", async () => {
    const { port, calls } = portWith(200, {
      success: true,
      data: { uuid: "u-1", status: 0, customer_phone: "94501", customer_name: "Chị Hồng", dealer_code: "VDD", created: true },
    });
    const row = await port.register(REGISTRATION);

    expect(calls[0]?.url).toBe(`${BASE_URL}/agent/expert-verifications`);
    expect(calls[0]?.init.headers["x-dealer-id"]).toBeUndefined();
    const body: unknown = JSON.parse(calls[0]?.init.body ?? "{}");
    expect(Object.keys(body as object).sort()).toEqual(
      ["customer_name", "customer_phone", "dealer_id", "note", "zalo_thread_id"],
    );
    expect(body).toMatchObject({ customer_phone: "94501", dealer_id: "42", zalo_thread_id: "G-XN" });
    expect(row).toEqual({
      id: "u-1",
      created: true,
      status: "cho_duyet",
      phoneLast5: "94501",
      customerName: "Chị Hồng",
      dealerCode: "VDD",
    });
  });

  test("gửi trùng → created false được giữ nguyên", async () => {
    const { port } = portWith(200, { success: true, data: { uuid: "u-0", status: 0, created: false } });
    expect((await port.register(REGISTRATION)).created).toBe(false);
  });

  test("note gom đủ mục cho bác sĩ đọc, cắt trần 2000", () => {
    const note = composeNote(REGISTRATION);
    expect(note).toContain("STT: 5 · Đại lý: VDD · Sale: Linh");
    expect(note).toContain("Đã tư vấn: Natto");
    expect(note).toContain("Khung giờ: 16h–17h ngày 2026-09-29");
    expect(composeNote({ ...REGISTRATION, condition: "x".repeat(3000) }).length).toBe(2000);
  });
});

describe("purchaseCheck", () => {
  test("GET đúng path + query, đọc số đơn", async () => {
    const { port, calls } = portWith(200, {
      success: true,
      data: { purchased: true, order_count: 3, last_order_at: "2026-08-02 10:00:00+07", last_tracking_number: "VTP1" },
    });
    expect(await port.purchaseCheck({ dealerId: "42", phone: "86639" })).toEqual({
      purchased: true,
      orderCount: 3,
      lastOrderAt: "2026-08-02 10:00:00+07",
    });
    expect(calls[0]?.url).toBe(`${BASE_URL}/agent/expert-verifications/purchase-check?dealer_id=42&phone=86639`);
  });

  test("không có đơn → purchased false, không lỗi", async () => {
    const { port } = portWith(200, { success: true, data: { purchased: false, order_count: 0 } });
    expect((await port.purchaseCheck({ dealerId: "42", phone: "86639" })).purchased).toBe(false);
  });

  test("chỉ đang dùng (món trùng) → MỘT dòng, kèm bằng chứng đơn", () => {
    const note = composeNote({
      ...REGISTRATION,
      inUse: { products: "natto", verified: true, orderCount: 2, lastOrderAt: "2026-08-02T03:00:00Z" },
    });
    expect(note).toContain("Đang dùng: natto (đã có 2 đơn ở đại lý, gần nhất 2026-08-02)");
    expect(note).not.toContain("Đã tư vấn");
  });

  test("vừa tư vấn món mới vừa đang dùng món khác → HAI dòng, không lẫn", () => {
    const note = composeNote({
      ...REGISTRATION,
      product: "men + nghệ",
      inUse: { products: "Rich + DHA", verified: false },
    });
    expect(note).toContain("Đã tư vấn: men + nghệ");
    expect(note).toContain("Đang dùng: Rich + DHA (hệ thống CHƯA thấy đơn");
  });
});
