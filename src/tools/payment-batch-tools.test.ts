// Test tool tạo PHIẾU THANH TOÁN GỘP trên OrderPort GIẢ (không mạng). Năm thứ phải chốt:
//   1. Phạm vi đại lý: dealerId vào port là đại lý của PHÒNG; nhân viên gõ thì kèm staffId.
//   2. Input model untrusted: thiếu mảng / phần tử rác / mã < 3 ký tự / quá 200 mã → isError,
//      port KHÔNG bị gọi (lệnh ghi không được lên mạng với input rác).
//   3. Mã trùng gộp TRƯỚC khi gửi — port thấy danh sách đã dedupe.
//   4. 404 (null) = "có mã không thuộc đại lý" → isError nói phiếu CHƯA tạo, không khẳng định
//      đơn không tồn tại.
//   5. Lỗi API khác → "CHƯA CHẮC đã tạo", không đưa QR/số tiền nào.

import { describe, expect, test } from "bun:test";
import type { Identity } from "../flash-command/types.ts";
import { AgentApiError, AgentApiErrorCode } from "../operational/agent-api.ts";
import type {
  OrderCameraLink,
  OrderDetail,
  OrderPayment,
  OrderPort,
  OrderPrincipal,
  OrderSearchPage,
  PaymentBatch,
} from "../operational/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import { buildPaymentBatchCreateTool } from "./impl/order/payment-batch.ts";
import type { ToolContext } from "./types.ts";

const DEALER: Identity = { role: "dai_ly", senderId: "u2", customerId: "dealer-9" };
const STAFF: Identity = { role: "nhan_vien", senderId: "u3", userId: "77" };

const skills: SkillRegistry = await buildSkillRegistry();

const BATCH: PaymentBatch = {
  code: "000123",
  transferContent: "DH000123",
  totalAmount: "5000000.00",
  paidAmount: "0.00",
  qrUrl: "https://qr.sepay.vn/img?acc=1&des=DH000123",
  uuid: "8f1c0c1e",
  status: 0,
  orderIds: ["10234", "10235"],
  orderCount: 2,
  createdAt: "2026-08-14T02:30:00.000Z",
  bank: { bankName: "Vietcombank", accountNumber: "0011000123456", accountName: "CONG TY DILI" },
};

class FakeOrders implements OrderPort {
  readonly created: (OrderPrincipal & { trackingNumbers: readonly string[] })[] = [];
  constructor(
    private readonly options: {
      readonly batch?: PaymentBatch | null;
      readonly error?: AgentApiError;
    } = {},
  ) {}

  createPaymentBatch(
    p: OrderPrincipal & { trackingNumbers: readonly string[]; signal?: AbortSignal },
  ): Promise<PaymentBatch | null> {
    this.created.push({
      dealerId: p.dealerId,
      staffId: p.staffId,
      trackingNumbers: p.trackingNumbers,
    });
    if (this.options.error !== undefined) return Promise.reject(this.options.error);
    return Promise.resolve(this.options.batch === undefined ? BATCH : this.options.batch);
  }

  search(): Promise<OrderSearchPage> {
    throw new Error("test không dùng search");
  }
  detail(): Promise<OrderDetail | null> {
    throw new Error("test không dùng detail");
  }
  payment(): Promise<OrderPayment | null> {
    throw new Error("test không dùng payment");
  }
  cameraLinks(): Promise<readonly OrderCameraLink[]> {
    throw new Error("test không dùng cameraLinks");
  }
}

/** `roomCustomerId: null` = phòng CHƯA /ketnoi-daily (khác với "dùng mặc định dealer-9"). */
function contextOf(p: {
  identity: Identity;
  orders?: OrderPort;
  roomCustomerId?: string | null;
}): ToolContext {
  return {
    skills,
    identity: p.identity,
    roomCustomerId: p.roomCustomerId === null ? undefined : (p.roomCustomerId ?? "dealer-9"),
    orders: p.orders,
  };
}

describe("tao_phieu_thanh_toan", () => {
  test("tạo phiếu → in mã phiếu, tổng tiền VN, khối chuyển khoản nguyên văn + hai câu nhắc", async () => {
    const orders = new FakeOrders();
    const tool = buildPaymentBatchCreateTool(contextOf({ identity: DEALER, orders }));

    const result = await tool.run({ ma_van_don: ["S12345678", "S12345679"] });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("000123");
    expect(result.content).toContain("5.000.000 ₫");
    expect(result.content).toContain("DH000123");
    expect(result.content).toContain("https://qr.sepay.vn");
    expect(result.content).toContain("Vietcombank");
    expect(result.content).toContain("chờ thanh toán");
    // QR preset số CÒN THIẾU (total − paid) — phải nói rõ, model rất dễ chú thích nhầm thành tổng.
    expect(result.content).toContain("CÒN THIẾU");
    expect(result.content).toContain("NGUYÊN VĂN");
    expect(result.content).toContain("KHÔNG xác nhận");
    // order_ids là id nội bộ — không in ra cho model diễn dịch bừa.
    expect(result.content).not.toContain("10234");
  });

  test("phạm vi đại lý: dealerId là đại lý PHÒNG; nhân viên gõ thì kèm staffId", async () => {
    const orders = new FakeOrders();
    const tool = buildPaymentBatchCreateTool(
      contextOf({ identity: STAFF, orders, roomCustomerId: "dealer-5" }),
    );

    await tool.run({ ma_van_don: ["S12345678"] });

    expect(orders.created).toEqual([
      { dealerId: "dealer-5", staffId: "77", trackingNumbers: ["S12345678"] },
    ]);
  });

  test("mã trùng gộp còn một TRƯỚC khi gửi lên port", async () => {
    const orders = new FakeOrders();
    const tool = buildPaymentBatchCreateTool(contextOf({ identity: DEALER, orders }));

    await tool.run({ ma_van_don: ["S12345678", "S12345678", "S12345679"] });

    expect(orders.created[0]?.trackingNumbers).toEqual(["S12345678", "S12345679"]);
  });

  test("input rác → isError, port KHÔNG bị gọi", async () => {
    const orders = new FakeOrders();
    const tool = buildPaymentBatchCreateTool(contextOf({ identity: DEALER, orders }));

    for (const input of [
      {},
      { ma_van_don: [] },
      { ma_van_don: "S12345678" },
      { ma_van_don: ["S12345678", 42] },
      { ma_van_don: ["S1"] },
    ]) {
      const result = await tool.run(input);
      expect(result.isError).toBe(true);
    }
    expect(orders.created).toEqual([]);
  });

  test("quá 20 mã (sau dedupe) → isError nói chia phiếu, port KHÔNG bị gọi", async () => {
    const orders = new FakeOrders();
    const tool = buildPaymentBatchCreateTool(contextOf({ identity: DEALER, orders }));
    const codes = Array.from({ length: 21 }, (_, i) => `S${String(i).padStart(8, "0")}`);

    const result = await tool.run({ ma_van_don: codes });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("trần 20");
    expect(orders.created).toEqual([]);
  });

  test("có mã không thuộc đại lý (404 → null) → phiếu CHƯA tạo, không khẳng định đơn không tồn tại", async () => {
    const orders = new FakeOrders({ batch: null });
    const tool = buildPaymentBatchCreateTool(contextOf({ identity: DEALER, orders }));

    const result = await tool.run({ ma_van_don: ["S00000000"] });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("CHƯA được tạo");
    expect(result.content).toContain("30 ngày");
  });

  test("API lỗi 5xx → 'CHƯA CHẮC phiếu đã tạo', không đưa QR", async () => {
    const orders = new FakeOrders({
      error: new AgentApiError(
        "POST /agent/payment-batches trả 500",
        500,
        AgentApiErrorCode.Transport,
        "/agent/payment-batches",
      ),
    });
    const tool = buildPaymentBatchCreateTool(contextOf({ identity: DEALER, orders }));

    const result = await tool.run({ ma_van_don: ["S12345678"] });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("CHƯA CHẮC");
    expect(result.content).not.toContain("qr.sepay.vn");
  });

  test("phòng chưa /ketnoi-daily → không tạo, port KHÔNG bị gọi", async () => {
    const orders = new FakeOrders();
    const guest: Identity = { role: "guest", senderId: "u1" };
    const tool = buildPaymentBatchCreateTool(
      contextOf({ identity: guest, orders, roomCustomerId: null }),
    );

    const result = await tool.run({ ma_van_don: ["S12345678"] });

    expect(result.isError).toBe(true);
    expect(orders.created).toEqual([]);
  });
});
