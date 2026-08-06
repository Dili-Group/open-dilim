// order-status.ts — tool ĐỌC trạng thái đơn của ĐÚNG đại lý trong phòng này.
//
// Chống confused-deputy (tools/types.ts): schema CHỈ có `ma_don`. Đại lý nào thì lấy server-side
// từ ToolContext — ưu tiên chủ phòng (nhân viên gõ trong nhóm đại lý X vẫn phải ra đơn của X),
// rồi mới tới identity đại lý (chat 1-1). Model KHÔNG có đường khai đại lý khác.
//
// Thiếu mã đơn = chuyện thường ("đơn A đi giúp chị nhé"): trả danh sách đơn gần đây để model hỏi
// lại đúng một câu, thay vì đoán bừa một đơn.

import { OrderStatus, type OrderInfo, type OrderPort } from "../../operational/types.ts";
import { ActorRole } from "../../flash-command/types.ts";
import { readStringField } from "../input.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";

/** Số đơn liệt kê khi khách không nói mã — đủ để nhận ra đơn mình hỏi, không nhồi cả lịch sử. */
const RECENT_LIMIT = 5;

const TIME_ZONE = "Asia/Ho_Chi_Minh";
const dateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Nhãn tiếng Việt cho từng trạng thái — model đọc nhãn này, không đọc mã enum. */
const STATUS_LABEL: Record<OrderStatus, string> = {
  [OrderStatus.ChoXacNhan]: "chờ xác nhận",
  [OrderStatus.DaXacNhan]: "đã xác nhận, chờ đóng gói",
  [OrderStatus.DangDongGoi]: "đang đóng gói",
  [OrderStatus.DangGiao]: "đang giao",
  [OrderStatus.DaGiao]: "đã giao",
  [OrderStatus.DaHuy]: "đã huỷ",
};

export function buildOrderStatusTool(ctx: ToolContext): Tool {
  return {
    name: "tra_don_hang",
    description:
      "Tra trạng thái đơn hàng của đại lý trong cuộc trò chuyện này. Có mã đơn thì truyền `ma_don`; " +
      "không có thì gọi trống để lấy danh sách đơn gần đây rồi hỏi lại khách đơn nào. CHỈ ĐỌC.",
    inputSchema: {
      type: "object",
      properties: {
        ma_don: { type: "string", description: 'Mã đơn khách nói, ví dụ "DH-1042". Bỏ trống nếu khách chưa nói mã.' },
      },
      required: [],
    },
    // Gọi hệ vận hành mất vài giây → báo khách trước, đừng để khách nhìn màn hình trống.
    announce: "Dạ để em kiểm tra đơn hàng giúp anh/chị ạ.",
    run: (input: unknown): Promise<ToolResult> => runLookup(ctx, input),
  };
}

async function runLookup(ctx: ToolContext, input: unknown): Promise<ToolResult> {
  const orders = ctx.orders;
  if (orders === undefined) {
    return { content: "Hệ thống tra đơn chưa sẵn sàng — báo khách là em kiểm tra lại sau.", isError: true };
  }

  const customerId = resolveCustomer(ctx);
  if (customerId === undefined) {
    return {
      content:
        "Chưa xác định được đại lý của cuộc trò chuyện này (nhóm chưa /ketnoi-daily). " +
        "Không tra đơn được — báo khách cần nhân viên kết nối nhóm trước.",
      isError: true,
    };
  }

  const code = readStringField(input, "ma_don");
  if (code === undefined) return renderRecent(orders, customerId);

  const order = await orders.findByCode({ customerId, code });
  if (order === null) return renderNotFound(orders, customerId, code);
  return { content: renderOrder(order) };
}

/**
 * Đại lý được phép tra: CHỦ PHÒNG trước, rồi tới identity đại lý (chat 1-1). Nhân viên/khách lạ
 * trong phòng chưa bind → undefined, không có đường nào đoán ra đại lý.
 */
function resolveCustomer(ctx: ToolContext): string | undefined {
  if (ctx.roomCustomerId !== undefined) return ctx.roomCustomerId;
  return ctx.identity.role === ActorRole.DaiLy ? ctx.identity.customerId : undefined;
}

async function renderRecent(orders: OrderPort, customerId: string): Promise<ToolResult> {
  const recent = await orders.recent({ customerId, limit: RECENT_LIMIT });
  if (recent.length === 0) {
    return { content: "Đại lý này chưa có đơn nào trên hệ thống." };
  }
  return {
    content: [
      `Khách chưa nói mã đơn. ${recent.length} đơn gần nhất của đại lý này:`,
      ...recent.map(renderLine),
      "Hỏi lại khách đơn nào trước khi trả lời trạng thái.",
    ].join("\n"),
  };
}

async function renderNotFound(
  orders: OrderPort,
  customerId: string,
  code: string,
): Promise<ToolResult> {
  const recent = await orders.recent({ customerId, limit: RECENT_LIMIT });
  const lines = [`Không có đơn nào mã "${code}" thuộc đại lý này.`];
  if (recent.length > 0) {
    lines.push("Đơn gần nhất của đại lý:", ...recent.map(renderLine));
  }
  return { content: lines.join("\n") };
}

/** 1 dòng/đơn cho danh sách — đủ nhận diện (mã, trạng thái, ngày đặt), không nhồi chi tiết. */
function renderLine(order: OrderInfo): string {
  return `- ${order.code} · ${STATUS_LABEL[order.status]} · đặt ${formatDate(order.placedAt)} · ${formatMoney(order.totalAmount)}`;
}

/** Chi tiết 1 đơn. Field trống thì BỎ HẲN dòng — model thấy "chưa có" sẽ bịa thành "đang cập nhật". */
function renderOrder(order: OrderInfo): string {
  const lines = [
    `Đơn ${order.code}`,
    `- Trạng thái: ${STATUS_LABEL[order.status]}`,
    `- Ngày đặt: ${formatDate(order.placedAt)}`,
    `- Tổng tiền: ${formatMoney(order.totalAmount)}`,
  ];
  if (order.expectedDeliveryAt !== undefined) {
    lines.push(`- Giao dự kiến: ${formatDate(order.expectedDeliveryAt)}`);
  }
  if (order.carrier !== undefined) lines.push(`- Đơn vị vận chuyển: ${order.carrier}`);
  if (order.trackingCode !== undefined) lines.push(`- Mã vận đơn: ${order.trackingCode}`);
  if (order.note !== undefined) lines.push(`- Ghi chú: ${order.note}`);
  return lines.join("\n");
}

function formatDate(ts: number): string {
  return dateFormat.format(new Date(ts));
}

function formatMoney(amount: number): string {
  return `${amount.toLocaleString("vi-VN")}đ`;
}
