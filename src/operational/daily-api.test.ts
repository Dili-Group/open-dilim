// Test DailyPort: envelope của cụm sổ ngày dùng `meta_data` (không phải `meta`), tổng phải lấy TỪ
// đó chứ không cộng các dòng; tiền giữ nguyên chuỗi; dòng thiếu mã vận đơn bị bỏ.
//
// Không import config.ts: client nhận baseUrl/token qua constructor nên test chạy không cần env.

import { describe, expect, test } from "bun:test";
import { AgentApiClient, type FetchInit, type FetchLike } from "./agent-api.ts";
import { AgentApiDailyPort } from "./daily-api.ts";

const BASE_URL = "https://api.example.test/api";
const TOKEN = "service-token-test";
const PRINCIPAL = { dealerId: "42", staffId: "7" } as const;

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

function portWith(status: number, body: unknown): { port: AgentApiDailyPort; calls: StubCall[] } {
  const { fetchImpl, calls } = stubFetch(status, body);
  return {
    port: new AgentApiDailyPort(new AgentApiClient({ baseUrl: BASE_URL, serviceToken: TOKEN, fetchImpl })),
    calls,
  };
}

const SHIPPED_BODY = {
  success: true,
  meta_data: {
    date: "2026-08-08",
    dealer_code: "DL001",
    page: 1,
    page_size: 20,
    total_items: 12,
    total_pages: 1,
    total_quantity: 30,
    total_amount: "9000000",
  },
  data: [
    {
      tracking_number: "VTP001",
      created_at: "2026-08-07T09:00:00Z",
      at: "2026-08-08T03:15:00Z",
      quantity: 3,
      goods_amount: "450000",
      items: [
        { sku: "SP1", product_name: "Sữa hạt", quantity: 2, is_gift: false, line_amount: "450000" },
        { sku: "SP2", product_name: "Ly sứ", quantity: 1, is_gift: true, line_amount: "0" },
      ],
    },
    // Không có mã vận đơn → không đối chiếu được với sổ, phải bị bỏ.
    { created_at: "2026-08-07T09:00:00Z", quantity: 1 },
  ],
};

describe("AgentApiDailyPort", () => {
  test("gọi đúng path + query ngày/trang, kèm header đại lý", async () => {
    const { port, calls } = portWith(200, SHIPPED_BODY);
    await port.shippedOrders({ ...PRINCIPAL, date: "2026-08-08", page: 2, pageSize: 50 });

    const call = calls[0];
    expect(call?.url).toBe(
      "https://api.example.test/api/agent/daily/shipped-orders?date=2026-08-08&page=2&page_size=50",
    );
    expect(call?.init.headers["x-dealer-id"]).toBe("42");
    expect(call?.init.headers["x-staff-id"]).toBe("7");
  });

  test("bốn mục đi đúng bốn endpoint", async () => {
    const empty = { success: true, meta_data: { total_items: 0 }, data: [] };
    const { port, calls } = portWith(200, empty);
    const q = { ...PRINCIPAL, date: "2026-08-08" };
    await port.shippedOrders(q);
    await port.returnedOrders(q);
    await port.charges(q);
    await port.refunds(q);

    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/api/agent/daily/shipped-orders",
      "/api/agent/daily/returned-orders",
      "/api/agent/daily/charges",
      "/api/agent/daily/refunds",
    ]);
  });

  test("tổng đọc từ meta_data, KHÔNG cộng từ data", async () => {
    const { port } = portWith(200, SHIPPED_BODY);
    const page = await port.shippedOrders({ ...PRINCIPAL, date: "2026-08-08" });

    expect(page.meta.totalItems).toBe(12);
    expect(page.meta.totalQuantity).toBe(30);
    // Chuỗi nguyên văn: không parse sang số, không làm tròn.
    expect(page.meta.totalAmount).toBe("9000000");
    expect(page.meta.dealerCode).toBe("DL001");
    // Trang chỉ có 1 dòng đọc được, tổng vẫn là 12 — hai con số này không được lẫn nhau.
    expect(page.lines).toHaveLength(1);
  });

  test("giữ hàng tặng (line_amount '0') để tool ghi rõ (Tặng)", async () => {
    const { port } = portWith(200, SHIPPED_BODY);
    const page = await port.shippedOrders({ ...PRINCIPAL, date: "2026-08-08" });

    const gift = page.lines[0]?.items[1];
    expect(gift?.isGift).toBe(true);
    expect(gift?.lineAmount).toBe("0");
  });

  test("charges tách tiền hàng và phí thùng", async () => {
    const { port } = portWith(200, {
      success: true,
      meta_data: { currency: "VND", goods_amount: "8940000", carton_fee: "60000", total_amount: "9000000", total_items: 12 },
      data: [
        {
          tracking_number: "VTP001",
          shipped_at: "2026-08-08T03:15:00Z",
          quantity: 3,
          goods_amount: "445000",
          carton_fee: "5000",
          amount: "450000",
        },
      ],
    });
    const page = await port.charges({ ...PRINCIPAL, date: "2026-08-08" });

    expect(page.meta.goodsAmount).toBe("8940000");
    expect(page.meta.cartonFee).toBe("60000");
    expect(page.lines[0]?.amount).toBe("450000");
    expect(page.lines[0]?.cartonFee).toBe("5000");
  });

  test("refunds đọc mốc returned_at", async () => {
    const { port } = portWith(200, {
      success: true,
      meta_data: { total_items: 2, total_amount: "300000" },
      data: [{ tracking_number: "VTP009", returned_at: "2026-08-08T10:00:00Z", quantity: 1, amount: "150000" }],
    });
    const page = await port.refunds({ ...PRINCIPAL, date: "2026-08-08" });

    expect(page.meta.totalAmount).toBe("300000");
    expect(page.lines[0]?.returnedAt).toBe("2026-08-08T10:00:00Z");
  });

  test("meta_data thiếu → field undefined, KHÔNG mặc định 0", async () => {
    const { port } = portWith(200, { success: true, data: [] });
    const page = await port.shippedOrders({ ...PRINCIPAL, date: "2026-08-08" });

    expect(page.meta.totalItems).toBeUndefined();
    expect(page.meta.totalAmount).toBeUndefined();
  });

  test("400 AGENT_INVALID_DATE bubble lên với code nguyên vẹn", async () => {
    const { port } = portWith(400, { code: "AGENT_INVALID_DATE", message: "ngày sai" });
    const call = port.charges({ ...PRINCIPAL, date: "2026-13-40" });

    await expect(call).rejects.toMatchObject({ status: 400, code: "AGENT_INVALID_DATE" });
  });

  test("data không phải mảng → lỗi shape, không trả trang rỗng giả", async () => {
    const { port } = portWith(200, { success: true, meta_data: {}, data: { total: 3 } });
    await expect(port.refunds({ ...PRINCIPAL, date: "2026-08-08" })).rejects.toMatchObject({
      code: "AGENT_API_INVALID_RESPONSE",
    });
  });
});
