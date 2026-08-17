// payment.ts — tool ĐỌC số tiền ĐẠI LÝ phải chuyển cho CÔNG TY để đơn được đi. CHỈ con số —
// KHÔNG in khối chuyển khoản.
//
// Tách khỏi tra_don_hang vì đây là con số KHÁC HẲN: `tra_don_hang` in tiền của đơn theo giá bán và
// COD khách trả; tool này in giá đại lý (theo bậc chiết khấu) + phí hộp giấy. Trộn hai thứ vào một
// câu trả lời là đại lý chuyển sai tiền.
//
// Backend endpoint này có trả kèm khối CK, nhưng nội dung là `DLM` + mã đại lý — tức NẠP VÍ:
// tiền về chỉ vào ví (bù âm nếu ví âm), webhook KHÔNG mở khoá đơn nào. Đường thanh toán duy nhất
// để đơn đi là phiếu gộp `tao_phieu_thanh_toan` (nội dung `DH` + mã phiếu). Vì thế render CỐ Ý
// bỏ khối CK — in ra là đại lý chuyển theo, tiền kẹt trong ví mà đơn vẫn đứng im.
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
 * trả bao nhiêu", và rất dễ tự bịa/nhớ lại một khối chuyển khoản để "cho tiện".
 */
const SCOPE_NOTE =
  "Đây là tiền ĐẠI LÝ chuyển cho công ty (giá đại lý + phí hộp giấy), KHÔNG phải tiền COD khách " +
  "trả. Không tự cộng trừ, không xác nhận là đã nhận được tiền.";
const BATCH_NOTE =
  "Muốn thanh toán để đơn được đi → tạo phiếu thanh toán gộp (tao_phieu_thanh_toan) rồi chuyển " +
  "theo QR/nội dung của PHIẾU. KHÔNG đưa nội dung CK nạp ví (DLM…) cho việc này — tiền chỉ vào " +
  "ví, đơn không được mở khoá. KHÔNG tự chế số tài khoản hay nội dung chuyển khoản.";

export function buildOrderPaymentTool(ctx: ToolContext): Tool {
  return {
    name: "tra_tien_can_chuyen",
    description:
      "Tra số tiền đại lý cần chuyển cho công ty để MỘT đơn được đi (giá đại lý theo bậc chiết khấu " +
      "+ phí hộp giấy). CHỈ TRẢ CON SỐ — không có khối chuyển khoản; đại lý muốn thanh toán thật " +
      "thì tạo phiếu gộp tao_phieu_thanh_toan (kể cả chỉ 1 đơn). Bắt buộc `ma_van_don` — chưa có " +
      "mã thì gọi tra_don_hang trước. KHÔNG dùng để trả lời 'khách phải trả bao nhiêu' (đó là COD, " +
      "xem tra_don_hang). CHỈ ĐỌC, không xác nhận đã thanh toán.",
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
 * chỉ để giải thích con số đó, không phải để model cộng lại. Khối CK backend trả kèm bị BỎ CỐ Ý
 * (nội dung DLM = nạp ví, không mở khoá đơn) — xem chú thích đầu file.
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

  lines.push(SCOPE_NOTE, BATCH_NOTE);
  return lines.join("\n");
}

function joinParts(...parts: readonly (string | undefined)[]): string | undefined {
  const kept = parts.filter(isLine);
  return kept.length === 0 ? undefined : kept.join(" · ");
}

function isLine(value: string | undefined): value is string {
  return value !== undefined;
}
