// order-stub.ts — OrderPort giả, dùng tới khi hệ vận hành có endpoint đơn hàng thật.
//
// Có mặt để luồng tra đơn (tool → skill → agent) chạy được đầu-cuối ngay: dev thấy đúng hội
// thoại thật, test không cần network. Dữ liệu cứng, KHÔNG ghi. Thay bằng impl HTTP = sửa 1 dòng
// bootstrap (xem operational/types.ts).
//
// Mốc thời gian tính lệch theo `now` lúc gọi (không phải hằng epoch) để đơn "đang giao" luôn có
// ngày giao dự kiến ở tương lai dù chạy dev lúc nào.

import {
  OrderStatus,
  OrderVideoKind,
  PaymentStatus,
  type OrderInfo,
  type OrderPayment,
  type OrderPort,
  type OrderVideo,
} from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Hạn link video mẫu. Impl thật lấy hạn do dịch vụ media cấp, không tự đặt. */
const VIDEO_LINK_TTL_MS = 24 * HOUR_MS;

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

/** Tiền của từng đơn mẫu, tra theo mã. Đơn không có mặt ở đây = chưa phát sinh công nợ. */
const STUB_PAYMENTS: Readonly<Record<string, Omit<OrderPayment, "code" | "customerId" | "dueAt">>> = {
  "DH-1042": {
    status: PaymentStatus.TraMotPhan,
    totalAmount: 12_400_000,
    paidAmount: 4_000_000,
    remainingAmount: 8_400_000,
    method: "chuyển khoản",
  },
  "DH-1031": {
    status: PaymentStatus.DaThanhToan,
    totalAmount: 5_800_000,
    paidAmount: 5_800_000,
    remainingAmount: 0,
    method: "chuyển khoản",
  },
  "DH-1055": {
    status: PaymentStatus.ChuaThanhToan,
    totalAmount: 3_150_000,
    paidAmount: 0,
    remainingAmount: 3_150_000,
    method: "COD",
  },
};

/** Hạn thanh toán tính theo lệch ngày so với hiện tại (undefined = không có hạn). */
const STUB_DUE_IN_DAYS: Readonly<Record<string, number>> = { "DH-1042": 5 };

/** Video từng đơn: loại + quay cách đây bao nhiêu ngày. */
const STUB_VIDEOS: Readonly<Record<string, ReadonlyArray<{ kind: OrderVideoKind; daysAgo: number }>>> = {
  "DH-1042": [{ kind: OrderVideoKind.DongGoi, daysAgo: 2 }],
  "DH-1031": [
    { kind: OrderVideoKind.DongGoi, daysAgo: 9 },
    { kind: OrderVideoKind.KhuiHoan, daysAgo: 3 },
  ],
};

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
  findByCode(p: { customerId: string; code: string }): Promise<OrderInfo | null> {
    const found = owns(p.customerId, p.code);
    return Promise.resolve(found === undefined ? null : toOrderInfo(found, Date.now()));
  }

  recent(p: { customerId: string; limit: number }): Promise<readonly OrderInfo[]> {
    const now = Date.now();
    const orders = STUB_ORDERS.filter((o) => o.customerId === p.customerId)
      .map((o) => toOrderInfo(o, now))
      .sort((a, b) => b.placedAt - a.placedAt)
      .slice(0, Math.max(0, p.limit));
    return Promise.resolve(orders);
  }

  /** Chốt quyền sở hữu TRƯỚC (owns), rồi mới tra tiền — đơn của đại lý khác phải ra null. */
  payment(p: { customerId: string; code: string }): Promise<OrderPayment | null> {
    const order = owns(p.customerId, p.code);
    if (order === undefined) return Promise.resolve(null);
    const amounts = STUB_PAYMENTS[order.code];
    if (amounts === undefined) return Promise.resolve(null);
    const dueInDays = STUB_DUE_IN_DAYS[order.code];
    return Promise.resolve({
      code: order.code,
      customerId: order.customerId,
      ...amounts,
      dueAt: dueInDays === undefined ? undefined : Date.now() + dueInDays * DAY_MS,
    });
  }

  videos(p: {
    customerId: string;
    code: string;
    kind?: OrderVideoKind;
  }): Promise<readonly OrderVideo[]> {
    const order = owns(p.customerId, p.code);
    if (order === undefined) return Promise.resolve([]);
    const now = Date.now();
    const clips = (STUB_VIDEOS[order.code] ?? []).filter(
      (v) => p.kind === undefined || v.kind === p.kind,
    );
    return Promise.resolve(
      clips.map((v) => ({
        kind: v.kind,
        url: `https://media.dili.example/video/${order.code.toLowerCase()}-${v.kind}`,
        recordedAt: now - v.daysAgo * DAY_MS,
        expiresAt: now + VIDEO_LINK_TTL_MS,
      })),
    );
  }
}

/** Đơn mã `code` CÓ thuộc đại lý này không. undefined = không (kể cả mã có thật ở đại lý khác). */
function owns(customerId: string, code: string): StubOrder | undefined {
  const wanted = code.trim().toLowerCase();
  return STUB_ORDERS.find((o) => o.customerId === customerId && o.code.toLowerCase() === wanted);
}
