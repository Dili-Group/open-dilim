// status.ts — tool ĐỌC trạng thái đơn của ĐÚNG đại lý trong phòng này.
//
// Chống confused-deputy (tools/types.ts): schema CHỈ có `ma_don`. Đại lý nào thì lấy server-side
// (scope.ts) — model KHÔNG có đường khai đại lý khác.
//
// Thiếu mã đơn = chuyện thường ("đơn A đi giúp chị nhé"): đây là tool DUY NHẤT chạy được khi chưa
// có mã — trả danh sách đơn gần đây để model hỏi lại đúng một câu, thay vì đoán bừa một đơn.

import type { OrderInfo, OrderPort } from "../../../operational/types.ts";
import { readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import {
  NO_CUSTOMER,
  NO_PORT,
  STATUS_LABEL,
  formatDate,
  formatMoney,
  resolveCustomer,
} from "./scope.ts";

/** Số đơn liệt kê khi khách không nói mã — đủ để nhận ra đơn mình hỏi, không nhồi cả lịch sử. */
const RECENT_LIMIT = 5;

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
  if (orders === undefined) return NO_PORT;

  const customerId = resolveCustomer(ctx);
  if (customerId === undefined) return NO_CUSTOMER;

  const code = readStringField(input, "ma_don");
  if (code === undefined) return renderRecent(orders, customerId);

  const order = await orders.findByCode({ customerId, code });
  if (order === null) return renderNotFound(orders, customerId, code);
  return { content: renderOrder(order) };
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
