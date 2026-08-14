// payment-batch.ts — tool GHI: tạo PHIẾU THANH TOÁN GỘP cho nhiều đơn chưa thanh toán của đại lý
// phòng này, trả mã QR SePay để đại lý chuyển một lần.
//
// Khác `tra_tien_can_chuyen` (ĐỌC, một đơn, nội dung CK nạp ví theo mã đại lý): phiếu gộp có nội
// dung CK RIÊNG = `DH` + mã phiếu, webhook SePay khớp theo đúng chuỗi đó để mở khoá đơn. Trộn hai
// nội dung CK là tiền về nhưng đơn không đi.
//
// Đường ghi này đại lý TỰ GÕ ĐƯỢC (như nạp PosCake): phiếu chỉ gom đơn CỦA CHÍNH đại lý phòng —
// dealerId ép server-side qua header, model không có tham số chỉ định đại lý. POST không retry,
// backend tự gộp mã trùng; tool chỉ chặn input rác để khỏi tốn round-trip.

import { AgentApiError } from "../../../operational/agent-api.ts";
import { PAYMENT_BATCH_STATUS_LABEL, type PaymentBatch } from "../../../operational/types.ts";
import { readStringListField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import {
  NO_CUSTOMER,
  NO_PORT,
  WINDOW_NOTE,
  formatMoney,
  line,
  resolvePrincipal,
  subtractMoney,
} from "./scope.ts";

/** Trần tool: 20 mã một phiếu — chặt hơn trần 200 của backend. Mỗi mã ≥ 3 ký tự. Chặn trước, khỏi ăn 400. */
const MAX_TRACKING_NUMBERS = 20;
const MIN_TRACKING_NUMBER_LENGTH = 3;

const NEED_TRACKING_NUMBERS: ToolResult = {
  content:
    'Thiếu hoặc sai "ma_van_don": cần MẢNG mã vận đơn (mỗi mã là chuỗi ≥ 3 ký tự). Chốt với khách ' +
    "danh sách đơn muốn thanh toán (gọi tra_don_hang nếu chưa rõ mã) rồi gọi lại tool này.",
  isError: true,
};

/**
 * Hai câu nhắc BẮT BUỘC kèm mọi phiếu tạo thành công: model rất dễ tự viết tắt nội dung CK, và rất
 * dễ đọc số tiền trên QR thành tổng phiếu.
 */
const TRANSFER_NOTE =
  "Nội dung chuyển khoản phải gửi NGUYÊN VĂN: sai nội dung là webhook SePay không khớp phiếu, " +
  "tiền về nhưng đơn KHÔNG được mở khoá.";
const SCOPE_NOTE =
  "Phiếu vừa tạo đang ở trạng thái CHỜ THANH TOÁN — chỉ đưa QR/hướng dẫn chuyển, KHÔNG xác nhận " +
  "là đã nhận được tiền. Không tự cộng trừ số tiền.";

export function buildPaymentBatchCreateTool(ctx: ToolContext): Tool {
  return {
    name: "tao_phieu_thanh_toan",
    description:
      "GHI: tạo PHIẾU THANH TOÁN GỘP cho NHIỀU đơn chưa thanh toán của đại lý phòng này, trả mã " +
      "QR SePay + nội dung chuyển khoản để đại lý chuyển MỘT lần cho cả loạt đơn. Chỉ gọi khi đại " +
      "lý đã chốt danh sách mã vận đơn muốn thanh toán (1–20 mã) — chưa rõ mã thì gọi " +
      "tra_don_hang trước. KHÔNG dùng để tra tiền một đơn lẻ (đó là tra_tien_can_chuyen), KHÔNG " +
      "xác nhận đã thanh toán.",
    inputSchema: {
      type: "object",
      properties: {
        ma_van_don: {
          type: "array",
          items: { type: "string" },
          description:
            'Danh sách mã vận đơn muốn gộp thanh toán, vd ["S12345678", "S12345679"]. 1–20 mã.',
        },
      },
      required: ["ma_van_don"],
    },
    announce: "Em tạo phiếu thanh toán gộp cho các đơn này ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> => runCreate(ctx, input, signal),
  };
}

async function runCreate(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const orders = ctx.orders;
  if (orders === undefined) return NO_PORT;

  const principal = resolvePrincipal(ctx);
  if (principal === undefined) return NO_CUSTOMER;

  const raw = readStringListField(input, "ma_van_don");
  if (raw === undefined || raw.length === 0) return NEED_TRACKING_NUMBERS;
  // Gộp mã trùng TRƯỚC khi đếm trần: backend cũng tự gộp, nhưng đếm trên danh sách đã gộp thì
  // thông điệp "quá trần" mới khớp số đơn thật.
  const trackingNumbers = [...new Set(raw)];
  if (trackingNumbers.some((code) => code.length < MIN_TRACKING_NUMBER_LENGTH)) {
    return NEED_TRACKING_NUMBERS;
  }
  if (trackingNumbers.length > MAX_TRACKING_NUMBERS) {
    return {
      content:
        `Danh sách có ${trackingNumbers.length} mã — quá trần ${MAX_TRACKING_NUMBERS} mã một ` +
        "phiếu. Chia thành nhiều phiếu nhỏ hơn rồi gọi lại.",
      isError: true,
    };
  }

  let batch: PaymentBatch | null;
  try {
    batch = await orders.createPaymentBatch({ ...principal, trackingNumbers, signal });
  } catch (err) {
    if (err instanceof AgentApiError) {
      // message chỉ có method/path/status/code — KHÔNG có service token.
      console.error("[tao_phieu_thanh_toan] API vận hành lỗi:", err.message);
      return {
        content:
          `Hệ vận hành từ chối hoặc không phản hồi lệnh tạo phiếu (${err.code}). CHƯA CHẮC phiếu ` +
          "đã tạo — báo là em chưa tạo xong, cần kiểm tra lại trước khi gọi lại, KHÔNG đưa QR hay " +
          "số tiền nào cho khách.",
        isError: true,
      };
    }
    throw err;
  }

  if (batch === null) {
    return {
      content:
        "Có mã vận đơn KHÔNG tồn tại hoặc không thuộc đại lý này nên phiếu CHƯA được tạo (hệ " +
        `thống không cho biết mã nào). ${WINDOW_NOTE} Soát lại danh sách mã với khách rồi gọi ` +
        "lại — ĐỪNG khẳng định đơn không tồn tại (có thể là đơn của đại lý khác).",
      isError: true,
    };
  }
  return { content: render(batch) };
}

/**
 * Mã phiếu + tổng tiền đứng ĐẦU, khối chuyển khoản đứng riêng — đại lý cần đúng ba thứ: chuyển
 * bao nhiêu, vào đâu, với nội dung gì. `order_ids` là id nội bộ, KHÔNG in ra — đại lý chỉ biết
 * mã vận đơn, in một dãy id lạ là model diễn dịch bừa.
 */
function render(batch: PaymentBatch): string {
  const lines = [
    `ĐÃ TẠO PHIẾU THANH TOÁN ${batch.code} — TỔNG TIỀN: ${formatMoney(batch.totalAmount) ?? batch.totalAmount}`,
    line("Số đơn trong phiếu", batch.orderCount === undefined ? undefined : String(batch.orderCount)),
    line("Trạng thái", statusLabel(batch.status)),
    line("Đã thanh toán", formatMoney(batch.paidAmount)),
  ].filter(isLine);

  const bank = batch.bank;
  const transfer = [
    line("Ngân hàng", bank?.bankName),
    line("Số tài khoản", bank?.accountNumber),
    line("Chủ tài khoản", bank?.accountName),
    line("Nội dung chuyển khoản", batch.transferContent),
    line("Link QR", batch.qrUrl),
  ].filter(isLine);
  if (transfer.length > 0) lines.push("Chuyển khoản:", ...transfer);

  // QR preset SỐ CÒN THIẾU, không phải tổng phiếu — nói rõ để model đừng chú thích nhầm con số.
  const remaining = subtractMoney(batch.totalAmount, batch.paidAmount ?? "0");
  if (batch.qrUrl !== undefined && remaining !== undefined) {
    lines.push(`QR đã đặt sẵn số CÒN THIẾU: ${formatMoney(remaining) ?? remaining}.`);
  }

  lines.push(TRANSFER_NOTE, SCOPE_NOTE);
  return lines.join("\n");
}

function statusLabel(status: number | undefined): string | undefined {
  if (status === undefined) return undefined;
  return PAYMENT_BATCH_STATUS_LABEL[status] ?? `mã ${status}`;
}

function isLine(value: string | undefined): value is string {
  return value !== undefined;
}
