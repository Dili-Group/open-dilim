// order-stub.ts — OrderPort giả, dùng tới khi hệ vận hành có endpoint đơn hàng thật.
//
// Có mặt để luồng tra đơn (tool → skill → agent) chạy được đầu-cuối ngay: dev thấy đúng hội
// thoại thật, test không cần network. Dữ liệu cứng, KHÔNG ghi. Thay bằng impl HTTP = sửa 1 dòng
// bootstrap (xem operational/types.ts).
//
// Mốc thời gian tính lệch theo `now` lúc gọi (không phải hằng epoch) để đơn "đang giao" luôn có
// ngày giao dự kiến ở tương lai dù chạy dev lúc nào.

import { OrderStatus, type OrderInfo, type OrderPort } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Đơn mẫu, mô tả theo LỆCH ngày so với hiện tại thay vì mốc tuyệt đối. */
interface StubOrder {
  readonly code: string;
  readonly customerId: string;
  readonly status: OrderStatus;
  readonly placedDaysAgo: number;
  readonly deliveryInDays?: number;
  readonly totalAmount: number;
  readonly carrier?: string;
  readonly trackingCode?: string;
  readonly note?: string;
}

const STUB_ORDERS: readonly StubOrder[] = [
  {
    code: "DH-1042",
    customerId: "dealer-1",
    status: OrderStatus.DangGiao,
    placedDaysAgo: 2,
    deliveryInDays: 1,
    totalAmount: 12_400_000,
    carrier: "Viettel Post",
    trackingCode: "VTP0093412",
  },
  {
    code: "DH-1031",
    customerId: "dealer-1",
    status: OrderStatus.DaGiao,
    placedDaysAgo: 9,
    deliveryInDays: -6,
    totalAmount: 5_800_000,
    carrier: "Viettel Post",
    trackingCode: "VTP0091188",
  },
  {
    code: "DH-1055",
    customerId: "dealer-1",
    status: OrderStatus.ChoXacNhan,
    placedDaysAgo: 0,
    totalAmount: 3_150_000,
  },
  {
    code: "DH-0998",
    customerId: "dealer-2",
    status: OrderStatus.DaHuy,
    placedDaysAgo: 14,
    totalAmount: 2_000_000,
    note: "Đại lý báo huỷ, đã hoàn cọc",
  },
];

function toOrderInfo(stub: StubOrder, now: number): OrderInfo {
  return {
    code: stub.code,
    customerId: stub.customerId,
    status: stub.status,
    placedAt: now - stub.placedDaysAgo * DAY_MS,
    expectedDeliveryAt:
      stub.deliveryInDays === undefined ? undefined : now + stub.deliveryInDays * DAY_MS,
    totalAmount: stub.totalAmount,
    carrier: stub.carrier,
    trackingCode: stub.trackingCode,
    note: stub.note,
  };
}

export class StubOrderPort implements OrderPort {
  /** So mã KHÔNG phân biệt hoa thường (khách gõ "dh-1042"), nhưng customerId thì khớp tuyệt đối. */
  findByCode(p: { customerId: string; code: string }): Promise<OrderInfo | null> {
    const wanted = p.code.trim().toLowerCase();
    const now = Date.now();
    const found = STUB_ORDERS.find(
      (o) => o.customerId === p.customerId && o.code.toLowerCase() === wanted,
    );
    return Promise.resolve(found === undefined ? null : toOrderInfo(found, now));
  }

  recent(p: { customerId: string; limit: number }): Promise<readonly OrderInfo[]> {
    const now = Date.now();
    const orders = STUB_ORDERS.filter((o) => o.customerId === p.customerId)
      .map((o) => toOrderInfo(o, now))
      .sort((a, b) => b.placedAt - a.placedAt)
      .slice(0, Math.max(0, p.limit));
    return Promise.resolve(orders);
  }
}
