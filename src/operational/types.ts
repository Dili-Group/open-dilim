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

/**
 * Cổng ĐỌC đơn hàng. `customerId` do server cấp (chủ phòng / identity đại lý), KHÔNG do LLM sinh
 * — mọi truy vấn đều bị chặn trong phạm vi một đại lý, tra mã đơn của đại lý khác phải ra null.
 */
export interface OrderPort {
  /** null = không có đơn mã đó THUỘC đại lý này (kể cả khi mã tồn tại ở đại lý khác). */
  findByCode(p: { customerId: string; code: string }): Promise<OrderInfo | null>;
  /** Đơn mới nhất trước, để agent hỏi lại "đơn nào" khi khách nói trống mã. */
  recent(p: { customerId: string; limit: number }): Promise<readonly OrderInfo[]>;
}
