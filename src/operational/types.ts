// types.ts — hợp đồng dữ liệu nghiệp vụ đọc từ hệ vận hành. File LÁ: KHÔNG import config.ts
// (fail-fast env) nên tool/test import thoải mái; impl HTTP mới chạm client.ts.
//
// OrderPort là PORT: tool tra đơn phụ thuộc interface này, không phụ thuộc HTTP. Hệ vận hành
// chưa có endpoint đơn hàng → bootstrap cắm `StubOrderPort` (order-stub.ts); có endpoint rồi
// thì thêm impl HTTP và đổi đúng 1 dòng ở bootstrap, tool/skill/test không đụng tới.

/** Trạng thái đơn — whitelist đóng: chuỗi lạ từ backend phải map về đây ở boundary, không lọt thẳng vào prompt. */
export const OrderStatus = {
  ChoXacNhan: "cho_xac_nhan",
  DaXacNhan: "da_xac_nhan",
  DangDongGoi: "dang_dong_goi",
  DangGiao: "dang_giao",
  DaGiao: "da_giao",
  DaHuy: "da_huy",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Một đơn hàng, đã lọc về đúng phần agent được phép nói với đại lý. */
export interface OrderInfo {
  /** Mã đơn người dùng gõ/đọc được (vd "DH-1024"). */
  readonly code: string;
  /** Đại lý sở hữu đơn — luôn có để nơi gọi chốt lại đúng chủ, không tin mỗi tham số đầu vào. */
  readonly customerId: string;
  readonly status: OrderStatus;
  /** Epoch ms lúc đặt. */
  readonly placedAt: number;
  /** Epoch ms giao dự kiến. undefined = chưa có lịch (đơn chưa xác nhận / đã huỷ). */
  readonly expectedDeliveryAt?: number;
  /** Tổng tiền VND. */
  readonly totalAmount: number;
  readonly carrier?: string;
  readonly trackingCode?: string;
  /** Ghi chú vận hành đã duyệt cho đại lý xem (vd lý do huỷ). */
  readonly note?: string;
}

/** Tình trạng thanh toán của MỘT đơn (không phải công nợ tổng của đại lý). */
export const PaymentStatus = {
  ChuaThanhToan: "chua_thanh_toan",
  TraMotPhan: "tra_mot_phan",
  DaThanhToan: "da_thanh_toan",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/**
 * Số tiền của một đơn. `remainingAmount` do BACKEND tính, không phải `total - paid` ở client:
 * chiết khấu, phí ship, điều chỉnh sau đặt đều nằm ở hệ vận hành — agent trừ tay là ra số sai.
 */
export interface OrderPayment {
  readonly code: string;
  readonly customerId: string;
  readonly status: PaymentStatus;
  readonly totalAmount: number;
  readonly paidAmount: number;
  readonly remainingAmount: number;
  /** Epoch ms hạn thanh toán. undefined = chưa có hạn (đơn chưa xác nhận). */
  readonly dueAt?: number;
  /** Hình thức đã thoả thuận (vd "chuyển khoản", "COD"). */
  readonly method?: string;
}

/**
 * Loại video quay đơn. `dong_goi` = quay lúc đóng hàng đi; `khui_hoan` = quay lúc khui kiện hàng
 * đại lý trả về. Hai loại phục vụ hai tranh chấp khác nhau (thiếu hàng lúc nhận / thiếu hàng lúc hoàn).
 */
export const OrderVideoKind = {
  DongGoi: "dong_goi",
  KhuiHoan: "khui_hoan",
} as const;
export type OrderVideoKind = (typeof OrderVideoKind)[keyof typeof OrderVideoKind];

/** Link xem video, LUÔN có hạn: link vào nhóm chat là link đi xa hơn nhóm chat. */
export interface OrderVideo {
  readonly kind: OrderVideoKind;
  readonly url: string;
  /** Epoch ms lúc quay. */
  readonly recordedAt: number;
  /** Epoch ms link hết hạn. */
  readonly expiresAt: number;
}

/**
 * Cổng ĐỌC đơn hàng. `customerId` do server cấp (chủ phòng / identity đại lý), KHÔNG do LLM sinh
 * — mọi truy vấn đều bị chặn trong phạm vi một đại lý, tra mã đơn của đại lý khác phải ra null.
 *
 * CHỈ ĐỌC: huỷ/sửa đơn là WRITE, đi qua nhân viên vận hành cho tới khi có approval gate (§6).
 */
export interface OrderPort {
  /** null = không có đơn mã đó THUỘC đại lý này (kể cả khi mã tồn tại ở đại lý khác). */
  findByCode(p: { customerId: string; code: string }): Promise<OrderInfo | null>;
  /** Đơn mới nhất trước, để agent hỏi lại "đơn nào" khi khách nói trống mã. */
  recent(p: { customerId: string; limit: number }): Promise<readonly OrderInfo[]>;
  /** null = không có đơn đó của đại lý này. Tách khỏi `findByCode` vì số tiền đổi độc lập với trạng thái giao. */
  payment(p: { customerId: string; code: string }): Promise<OrderPayment | null>;
  /** Video của đơn, lọc theo `kind` nếu có. [] = đơn không có video (chưa quay / chưa tới bước đó). */
  videos(p: {
    customerId: string;
    code: string;
    kind?: OrderVideoKind;
  }): Promise<readonly OrderVideo[]>;
}
