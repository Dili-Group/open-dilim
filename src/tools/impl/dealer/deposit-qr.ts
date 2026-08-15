// deposit-qr.ts — tool ĐỌC `lay_qr_nap_vi`: lấy mã QR SePay nạp tiền vào VÍ của đại lý phòng này
// (`GET /agent/wallet/deposit-qr`), kèm nội dung chuyển khoản + số tài khoản.
//
// Nội dung CK nạp ví = `DLM` + mã đại lý — KHÁC nội dung phiếu thanh toán gộp (`DH` + mã phiếu,
// tool tao_phieu_thanh_toan): webhook SePay khớp theo đúng chuỗi, trộn hai nội dung là tiền vào
// nhầm chỗ, đơn không được mở khoá.
//
// CHỈ ĐỌC: endpoint chỉ sinh QR, không ghi gì. Đại lý lấy từ closure/ctx (resolvePrincipal), model
// không có tham số chỉ định đại lý — không lấy được QR nạp ví của đại lý khác.

import { AgentApiError } from "../../../operational/agent-api.ts";
import type { WalletDepositQr } from "../../../operational/types.ts";
import { readIntegerField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import { NO_CUSTOMER, formatMoney, line, resolvePrincipal } from "../order/scope.ts";

const NO_PORT: ToolResult = {
  content: "Hệ thống ví đại lý chưa sẵn sàng — báo khách là em kiểm tra lại sau.",
  isError: true,
};

const LOOKUP_FAILED: ToolResult = {
  content:
    "Hệ thống vận hành đang không phản hồi nên chưa lấy được mã QR nạp ví. Báo khách là em kiểm " +
    "tra lại và gửi sau, KHÔNG tự chế nội dung chuyển khoản hay số tài khoản.",
  isError: true,
};

const NO_QR: ToolResult = {
  content:
    "Hệ thống không trả được mã QR nạp ví cho đại lý này. Báo khách là em cần bên vận hành kiểm " +
    "tra lại, KHÔNG tự chế nội dung chuyển khoản hay số tài khoản.",
  isError: true,
};

const BAD_AMOUNT: ToolResult = {
  content:
    'Tham số "so_tien" sai: cần số NGUYÊN dương (VND, vd 5000000), hoặc bỏ hẳn nếu khách chưa ' +
    "chốt số tiền. Chốt lại với khách rồi gọi lại tool.",
  isError: true,
};

/**
 * Hai câu BẮT BUỘC kèm mọi QR trả về: model rất dễ tự viết tắt nội dung CK, và rất dễ nói như
 * tiền đã vào ví.
 */
const TRANSFER_NOTE =
  "Nội dung chuyển khoản phải gửi NGUYÊN VĂN: sai nội dung là webhook SePay không khớp, tiền " +
  "không vào ví. Đây là QR NẠP VÍ — không dùng cho phiếu thanh toán gộp (nội dung DH+mã phiếu).";
const SCOPE_NOTE =
  "Chỉ đưa QR/hướng dẫn chuyển, KHÔNG xác nhận là đã nhận được tiền — hệ thống tự đối soát khi " +
  "tiền về.";

export function buildDepositQrTool(ctx: ToolContext): Tool {
  return {
    name: "lay_qr_nap_vi",
    description:
      "Lấy mã QR SePay để đại lý của phòng này NẠP TIỀN VÀO VÍ, kèm nội dung chuyển khoản + số " +
      "tài khoản. Tham số so_tien (VND) đặt sẵn số tiền trên QR — khách chưa chốt số thì bỏ " +
      "trống, đại lý tự nhập lúc chuyển. Luôn là ví của đại lý phòng này. CHỈ ĐỌC — KHÔNG dùng " +
      "để thanh toán đơn (đó là tao_phieu_thanh_toan / tra_tien_can_chuyen), KHÔNG xác nhận đã " +
      "nhận tiền.",
    inputSchema: {
      type: "object",
      properties: {
        so_tien: {
          type: "integer",
          minimum: 1,
          description: "Số tiền nạp (VND nguyên, vd 5000000). Bỏ trống → QR không đặt sẵn tiền.",
        },
      },
      required: [],
    },
    announce: "Em lấy mã QR nạp ví cho mình ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> => runLookup(ctx, input, signal),
  };
}

async function runLookup(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const dealer = ctx.dealer;
  if (dealer === undefined) return NO_PORT;

  const principal = resolvePrincipal(ctx);
  if (principal === undefined) return NO_CUSTOMER;

  // Phân biệt "không truyền" (hợp lệ — QR trống tiền) với "truyền mà rác/âm" (chặn, khỏi tốn
  // round-trip): readIntegerField trả undefined cho cả hai nên phải soi key có mặt hay không.
  const amount = readIntegerField(input, "so_tien");
  if (amount === undefined) {
    if (hasAmountField(input)) return BAD_AMOUNT;
  } else if (amount < 1) {
    return BAD_AMOUNT;
  }

  let qr: WalletDepositQr | null;
  try {
    qr = await dealer.depositQr({ ...principal, amount, signal });
  } catch (err) {
    if (err instanceof AgentApiError) {
      // message chỉ có method/path/status/code — KHÔNG có service token.
      console.error("[lay_qr_nap_vi] API vận hành lỗi:", err.message);
      return LOOKUP_FAILED;
    }
    throw err;
  }

  if (qr === null) return NO_QR;
  return render(qr);
}

function hasAmountField(input: unknown): boolean {
  return (
    typeof input === "object" &&
    input !== null &&
    (input as Record<string, unknown>)["so_tien"] !== undefined
  );
}

function render(qr: WalletDepositQr): ToolResult {
  // Thiếu cả nội dung CK lẫn QR = không có gì để đại lý chuyển đúng chỗ — coi như không có QR,
  // đừng in nửa vời cho model chế phần thiếu.
  if (qr.transferContent === undefined && qr.qrImageUrl === undefined) return NO_QR;

  const lines = [
    "QR NẠP TIỀN VÀO VÍ ĐẠI LÝ",
    line("Ngân hàng", qr.bankName),
    line("Số tài khoản", qr.accountNumber),
    line("Chủ tài khoản", qr.accountName),
    line("Nội dung chuyển khoản", qr.transferContent),
    line("Link QR", qr.qrImageUrl),
  ].filter(isLine);

  if (qr.amount !== undefined) {
    lines.push(`QR đã đặt sẵn số tiền: ${formatMoney(qr.amount) ?? qr.amount}.`);
  } else {
    lines.push("QR KHÔNG đặt sẵn số tiền — đại lý tự nhập số muốn nạp lúc chuyển.");
  }

  lines.push(TRANSFER_NOTE, SCOPE_NOTE);
  return { content: lines.join("\n") };
}

function isLine(value: string | undefined): value is string {
  return value !== undefined;
}
