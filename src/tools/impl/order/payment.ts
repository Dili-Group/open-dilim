// payment.ts — tool ĐỌC số tiền ĐẠI LÝ phải chuyển cho CÔNG TY để đơn được đi, kèm khối chuyển khoản.
//
// Tách khỏi tra_don_hang vì đây là con số KHÁC HẲN: `tra_don_hang` in tiền của đơn theo giá bán và
// COD khách trả; tool này in giá đại lý (theo bậc chiết khấu) + phí hộp giấy. Trộn hai thứ vào một
// câu trả lời là đại lý chuyển sai tiền.
//
// BẮT BUỘC có `ma_van_don`: đây là số tiền sẽ được chuyển đi thật, trả nhầm đơn tệ hơn hỏi lại một câu.
// Tool KHÔNG tự cộng trừ: `amount` do backend cộng sẵn, mọi trường tiền là chuỗi NUMERIC(15,2).

import { AgentApiError } from "../../../operational/agent-api.ts";
import type { OrderPayment } from "../../../operational/types.ts";
import { readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import {
  LOOKUP_FAILED,
  NEED_TRACKING_NUMBER,
  NO_CUSTOMER,
  NO_PORT,
  carrierLabel,
  formatMoney,
  line,
  orderNotFound,
  resolvePrincipal,
} from "./scope.ts";

/**
 * Hai câu cảnh báo BẮT BUỘC kèm mọi kết quả: model rất dễ trả con số này cho câu hỏi "khách phải
 * trả bao nhiêu", và rất dễ tự viết tắt nội dung chuyển khoản cho gọn.
 */
const SCOPE_NOTE =
  "Đây là tiền ĐẠI LÝ chuyển cho công ty (giá đại lý + phí hộp giấy), KHÔNG phải tiền COD khách " +
  "trả. Không tự cộng trừ, không xác nhận là đã nhận được tiền.";
const TRANSFER_NOTE =
  "Nội dung chuyển khoản phải gửi NGUYÊN VĂN: không viết tắt, không đổi hoa thường, không chèn " +
  "thêm mã đơn — sai nội dung là tiền không vào ví đại lý.";

export function buildOrderPaymentTool(ctx: ToolContext): Tool {
  return {
    name: "tra_tien_can_chuyen",
    description:
      "Tra số tiền đại lý cần chuyển cho công ty để MỘT đơn được đi (giá đại lý theo bậc chiết khấu " +
      "+ phí hộp giấy), kèm ngân hàng, số tài khoản, nội dung chuyển khoản và link QR. Bắt buộc " +
      "`ma_van_don` — chưa có mã thì gọi tra_don_hang trước. KHÔNG dùng để trả lời 'khách phải trả " +
      "bao nhiêu' (đó là COD, xem tra_don_hang). CHỈ ĐỌC, không xác nhận đã thanh toán.",
    inputSchema: {
      type: "object",
      properties: {
        ma_van_don: { type: "string", description: 'Mã vận đơn, ví dụ "VTP0093412".' },
      },
      required: ["ma_van_don"],
    },
    announce: "Em xem số tiền cần chuyển của đơn này ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> => runLookup(ctx, input, signal),
  };
}

async function runLookup(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const orders = ctx.orders;
  if (orders === undefined) return NO_PORT;

  const principal = resolvePrincipal(ctx);
  if (principal === undefined) return NO_CUSTOMER;

  const trackingNumber = readStringField(input, "ma_van_don");
  if (trackingNumber === undefined) return NEED_TRACKING_NUMBER;

  let payment: OrderPayment | null;
  try {
    payment = await orders.payment({ ...principal, trackingNumber, signal });
  } catch (err) {
    if (err instanceof AgentApiError) {
      // message chỉ có method/path/status/code — KHÔNG có service token.
      console.error("[tra_tien_can_chuyen] API vận hành lỗi:", err.message);
      return LOOKUP_FAILED;
    }
    throw err;
  }

  if (payment === null) return { content: orderNotFound(trackingNumber) };
  return { content: render(payment) };
}

/**
 * Số cần chuyển đứng ĐẦU và đứng RIÊNG: đó là thứ đại lý hỏi. Phần tách giá đại lý / phí hộp giấy
 * chỉ để giải thích con số đó, không phải để model cộng lại.
 */
function render(payment: OrderPayment): string {
  const lines = [
    `Đơn ${payment.trackingNumber} — SỐ TIỀN CẦN CHUYỂN: ${formatMoney(payment.amount) ?? payment.amount}`,
    line("Giá đại lý", formatMoney(payment.baseAmount)),
    line("Phí hộp giấy", formatMoney(payment.packagingFee)),
    line("Đại lý", joinParts(payment.dealerCode, payment.dealerName)),
    line("Đơn vị vận chuyển", carrierLabel(payment.carrier)),
    // Backend không trả tên hàng ở endpoint này → chỉ nói SỐ DÒNG, đừng để model tự nghĩ ra tên.
    line(
      "Số dòng hàng tính theo giá đại lý",
      payment.items.length === 0 ? undefined : String(payment.items.length),
    ),
  ].filter(isLine);

  const bank = payment.bank;
  const transfer = [
    line("Ngân hàng", joinParts(bank?.bankName, bank?.bankCode)),
    line("Số tài khoản", bank?.accountNumber),
    line("Chủ tài khoản", bank?.accountName),
    line("Nội dung chuyển khoản", payment.transferContent),
    line("Link QR", payment.qrUrl),
  ].filter(isLine);
  if (transfer.length > 0) lines.push("Chuyển khoản:", ...transfer);

  lines.push(SCOPE_NOTE);
  if (payment.transferContent !== undefined) lines.push(TRANSFER_NOTE);
  return lines.join("\n");
}

function joinParts(...parts: readonly (string | undefined)[]): string | undefined {
  const kept = parts.filter(isLine);
  return kept.length === 0 ? undefined : kept.join(" · ");
}

function isLine(value: string | undefined): value is string {
  return value !== undefined;
}
