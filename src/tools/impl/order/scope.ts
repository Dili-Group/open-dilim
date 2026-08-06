// scope.ts — thứ dùng chung của MỌI tool đơn hàng: ai được tra, và cách in số/ngày cho model đọc.
//
// Đặt riêng vì phần "ai được tra" là hàng rào bảo mật: sửa một chỗ, cả ba tool cùng theo. Ba tool
// đơn hàng (status/payment/video) không được tự nghĩ ra cách resolve đại lý của riêng mình.

import { ActorRole } from "../../../flash-command/types.ts";
import { OrderStatus } from "../../../operational/types.ts";
import type { ToolContext, ToolResult } from "../../types.ts";

const TIME_ZONE = "Asia/Ho_Chi_Minh";
const dateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Nhãn tiếng Việt cho trạng thái đơn — model đọc nhãn, không đọc mã enum. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  [OrderStatus.ChoXacNhan]: "chờ xác nhận",
  [OrderStatus.DaXacNhan]: "đã xác nhận, chờ đóng gói",
  [OrderStatus.DangDongGoi]: "đang đóng gói",
  [OrderStatus.DangGiao]: "đang giao",
  [OrderStatus.DaGiao]: "đã giao",
  [OrderStatus.DaHuy]: "đã huỷ",
};

/**
 * Đại lý được phép tra trong lượt này: CHỦ PHÒNG trước (nhân viên gõ trong nhóm đại lý X vẫn tra
 * đơn của X), rồi tới identity đại lý (chat 1-1). Không ra ai → undefined, KHÔNG đoán.
 */
export function resolveCustomer(ctx: ToolContext): string | undefined {
  if (ctx.roomCustomerId !== undefined) return ctx.roomCustomerId;
  return ctx.identity.role === ActorRole.DaiLy ? ctx.identity.customerId : undefined;
}

/** Lỗi nghiệp vụ chung: chưa nối cổng / chưa biết đại lý. Trả structured để model tự xoay, không throw. */
export const NO_PORT: ToolResult = {
  content: "Hệ thống đơn hàng chưa sẵn sàng — báo khách là em kiểm tra lại sau.",
  isError: true,
};

export const NO_CUSTOMER: ToolResult = {
  content:
    "Chưa xác định được đại lý của cuộc trò chuyện này (nhóm chưa /ketnoi-daily). " +
    "Không tra được — báo khách cần nhân viên kết nối nhóm trước.",
  isError: true,
};

/** Thiếu mã đơn cho tool BẮT BUỘC có mã: chỉ model biết cách chốt mã (gọi tra_don_hang trước). */
export const NEED_ORDER_CODE: ToolResult = {
  content: 'Thiếu "ma_don". Gọi tra_don_hang để chốt đơn nào với khách trước, rồi gọi lại tool này.',
  isError: true,
};

export function formatDate(ts: number): string {
  return dateFormat.format(new Date(ts));
}

export function formatMoney(amount: number): string {
  return `${amount.toLocaleString("vi-VN")}đ`;
}
