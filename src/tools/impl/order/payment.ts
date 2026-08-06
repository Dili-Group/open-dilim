// payment.ts — tool ĐỌC số tiền của MỘT đơn: tổng, đã trả, còn phải trả, hạn.
//
// Tách khỏi tra_don_hang vì hai câu hỏi khác nhau ("hàng tới chưa" vs "còn nợ bao nhiêu") và số
// tiền đổi độc lập với trạng thái giao. Gộp một tool là mỗi lần hỏi giao hàng lại kéo theo công nợ.
//
// BẮT BUỘC có `ma_don`: tiền là số khách sẽ chuyển đi — trả nhầm đơn tệ hơn hỏi lại một câu.
// Số "còn phải trả" LẤY NGUYÊN từ hệ vận hành, tool không tự trừ (chiết khấu/phí nằm ở backend).

import { PaymentStatus, type OrderPayment } from "../../../operational/types.ts";
import { readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import {
  NEED_ORDER_CODE,
  NO_CUSTOMER,
  NO_PORT,
  formatDate,
  formatMoney,
  resolveCustomer,
} from "./scope.ts";

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  [PaymentStatus.ChuaThanhToan]: "chưa thanh toán",
  [PaymentStatus.TraMotPhan]: "đã trả một phần",
  [PaymentStatus.DaThanhToan]: "đã thanh toán đủ",
};

export function buildOrderPaymentTool(ctx: ToolContext): Tool {
  return {
    name: "tra_thanh_toan_don",
    description:
      "Tra số tiền của MỘT đơn: tổng tiền, đã trả, còn phải trả, hạn thanh toán. Bắt buộc `ma_don` " +
      "— chưa biết mã thì gọi tra_don_hang trước. CHỈ ĐỌC, không xác nhận thanh toán.",
    inputSchema: {
      type: "object",
      properties: {
        ma_don: { type: "string", description: 'Mã đơn cần tra tiền, ví dụ "DH-1042".' },
      },
      required: ["ma_don"],
    },
    announce: "Dạ để em kiểm tra số tiền của đơn này ạ.",
    run: (input: unknown): Promise<ToolResult> => runLookup(ctx, input),
  };
}

async function runLookup(ctx: ToolContext, input: unknown): Promise<ToolResult> {
  const orders = ctx.orders;
  if (orders === undefined) return NO_PORT;

  const customerId = resolveCustomer(ctx);
  if (customerId === undefined) return NO_CUSTOMER;

  const code = readStringField(input, "ma_don");
  if (code === undefined) return NEED_ORDER_CODE;

  const payment = await orders.payment({ customerId, code });
  if (payment === null) {
    return {
      content: `Không có dữ liệu thanh toán cho đơn "${code}" của đại lý này (sai mã, hoặc đơn chưa phát sinh công nợ).`,
    };
  }
  return { content: render(payment, Date.now()) };
}

/**
 * "Quá hạn" tính Ở ĐÂY từ `dueAt` + còn nợ, không chờ backend có thêm một trạng thái nữa — nhưng
 * chỉ khi CÒN nợ: đơn trả đủ rồi thì cái hạn đã trôi qua không còn nghĩa lý gì.
 */
function render(payment: OrderPayment, now: number): string {
  const lines = [
    `Thanh toán đơn ${payment.code}`,
    `- Tình trạng: ${PAYMENT_LABEL[payment.status]}`,
    `- Tổng tiền: ${formatMoney(payment.totalAmount)}`,
    `- Đã trả: ${formatMoney(payment.paidAmount)}`,
    `- Còn phải trả: ${formatMoney(payment.remainingAmount)}`,
  ];
  if (payment.dueAt !== undefined) {
    const overdue = payment.remainingAmount > 0 && payment.dueAt < now;
    lines.push(`- Hạn thanh toán: ${formatDate(payment.dueAt)}${overdue ? " (ĐÃ QUÁ HẠN)" : ""}`);
  }
  if (payment.method !== undefined) lines.push(`- Hình thức: ${payment.method}`);
  return lines.join("\n");
}
