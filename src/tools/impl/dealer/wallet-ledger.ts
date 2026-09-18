// wallet-ledger.ts — tool ĐỌC `tra_lich_su_vi`: lịch sử biến động VÍ TIỀN HÀNG 7 ngày gần nhất
// của đại lý phòng này (`GET /agent/wallet/ledger`), để đối soát khi đại lý thắc mắc tiền ví
// ("em nạp rồi sao ví chưa lên", "sao ví bị trừ", "số dư lệch").
//
// CHỈ ĐỌC. Đại lý lấy từ closure/ctx (resolvePrincipal), model không có tham số chỉ định đại lý.
// Cửa sổ 7 ngày do backend ép — tool không nhận khoảng ngày.

import { AgentApiError } from "../../../operational/agent-api.ts";
import type { WalletLedgerEntry, WalletLedgerPage } from "../../../operational/types.ts";
import { readIntegerField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import {
  NO_CUSTOMER,
  cell,
  formatDateTime,
  formatMoney,
  resolvePrincipal,
  table,
  type Row,
} from "../order/scope.ts";

const NO_PORT: ToolResult = {
  content: "Hệ thống ví đại lý chưa sẵn sàng — báo khách là em kiểm tra lại sau.",
  isError: true,
};

const LOOKUP_FAILED: ToolResult = {
  content:
    "Hệ thống vận hành đang không phản hồi nên chưa lấy được lịch sử ví. Báo khách là em kiểm " +
    "tra lại sau, KHÔNG tự kể giao dịch hay số dư nào.",
  isError: true,
};

/** Nhãn TransactionType (packages/core enums). Mã lạ → in số, không bịa nhãn. */
const TRANSACTION_LABEL: Readonly<Record<number, string>> = {
  0: "Nạp ví",
  1: "Trừ tiền hàng đơn",
  // Backend dùng chung mã này cho mọi lần CỘNG lại tiền đơn (hoàn hàng, điều chỉnh giảm giá đơn).
  2: "Cộng lại tiền đơn",
  8: "Trừ trả trước",
  9: "Điều chỉnh thủ công",
  10: "Rút tiền",
  11: "Trừ công nợ",
  12: "Hoàn công nợ",
  13: "Nhập số dư đầu kỳ",
  14: "Nạp ví qua chuyển khoản",
};

/** Nhãn ReferenceType. */
const REFERENCE_LABEL: Readonly<Record<number, string>> = {
  0: "đơn",
  1: "phiếu hoàn",
  2: "thủ công",
  3: "hoa hồng",
  4: "GD ngân hàng",
};

const SCOPE_NOTE =
  "Chỉ ví TIỀN HÀNG, 7 ngày gần nhất (không gồm ví hoa hồng). so_tien dương = cộng ví, âm = " +
  "trừ ví; so_du_sau là số dư ngay sau dòng đó — đọc lại đúng số, KHÔNG tự cộng trừ các dòng.";
const REFERENCE_NOTE =
  "Tham chiếu `đơn#…` là ID NỘI BỘ của đơn, KHÔNG phải mã vận đơn — đừng đọc nó cho khách như " +
  "mã vận đơn. Cần biết là đơn nào: tra_don_hang theo mã vận đơn / tên / SĐT khách rồi khớp dòng " +
  "`Tham chiếu ví: đơn#…` của kết quả.";
const DISPUTE_NOTE =
  "Không thấy giao dịch đại lý nói tới, hoặc số không khớp → nói đúng những gì thấy trong lịch " +
  "sử, rồi chuyển nhân viên phụ trách đối soát. KHÔNG kết luận ai sai, KHÔNG hứa cộng/hoàn tiền.";

export function buildWalletLedgerTool(ctx: ToolContext): Tool {
  return {
    name: "tra_lich_su_vi",
    description:
      "Tra lịch sử biến động VÍ TIỀN HÀNG của đại lý phòng này trong 7 ngày gần nhất (mới nhất " +
      "trước): nạp ví, trừ tiền hàng đơn, cộng lại tiền đơn, điều chỉnh — mỗi dòng có số tiền và " +
      "số dư sau giao dịch. Dùng để ĐỐI SOÁT khi đại lý thắc mắc tiền ví (nạp rồi chưa thấy, bị " +
      "trừ lạ, số dư lệch). Tham số trang (mặc định 1). CHỈ ĐỌC — không cộng/hoàn tiền, không " +
      "xác nhận thanh toán đơn.",
    inputSchema: {
      type: "object",
      properties: {
        trang: {
          type: "integer",
          minimum: 1,
          description: "Trang cần xem (mặc định 1). Chỉ xem trang sau khi khách muốn xem tiếp.",
        },
      },
      required: [],
    },
    announce: "Em xem lịch sử ví của mình ạ.",
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

  const page = Math.max(1, readIntegerField(input, "trang") ?? 1);

  try {
    return { content: render(await dealer.walletLedger({ ...principal, page, signal })) };
  } catch (err) {
    if (err instanceof AgentApiError) {
      // message chỉ có method/path/status/code — KHÔNG có service token.
      console.error("[tra_lich_su_vi] API vận hành lỗi:", err.message);
      return LOOKUP_FAILED;
    }
    throw err;
  }
}

function render(result: WalletLedgerPage): string {
  const lines = ["LỊCH SỬ VÍ TIỀN HÀNG (7 ngày gần nhất)"];
  if (result.totalItems !== undefined) lines.push(`- Tổng số giao dịch: ${result.totalItems}`);

  if (result.entries.length === 0) {
    lines.push("Không có giao dịch nào trong 7 ngày gần nhất (ở trang này).");
  } else {
    lines.push(table("giao_dich", result.entries.map(toRow)));
  }

  const more = morePagesNote(result);
  if (more !== undefined) lines.push(more);
  lines.push(SCOPE_NOTE, REFERENCE_NOTE, DISPUTE_NOTE);
  return lines.join("\n");
}

function toRow(entry: WalletLedgerEntry): Row {
  return {
    luc: cell(formatDateTime(entry.createdAt)),
    loai: transactionLabel(entry.type),
    so_tien: cell(signedMoney(entry.amount)),
    so_du_sau: cell(formatMoney(entry.balanceAfter)),
    tham_chieu: cell(referenceLabel(entry.referenceType, entry.referenceId)),
    ghi_chu: cell(entry.description),
  };
}

function transactionLabel(type: number | undefined): string {
  if (type === undefined) return "chưa rõ";
  return TRANSACTION_LABEL[type] ?? `mã ${type}`;
}

function referenceLabel(type: number | undefined, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const label = type === undefined ? undefined : (REFERENCE_LABEL[type] ?? `mã ${type}`);
  return label === undefined ? `#${id}` : `${label}#${id}`;
}

/** Dấu `+` cho dòng cộng: model đọc "500.000 ₫" trần rất dễ kể thành bị trừ. */
function signedMoney(raw: string | undefined): string | undefined {
  const formatted = formatMoney(raw);
  if (formatted === undefined || formatted.startsWith("-")) return formatted;
  return formatted === "0 ₫" ? formatted : `+${formatted}`;
}

function morePagesNote(result: WalletLedgerPage): string | undefined {
  const { page, totalPages } = result;
  if (page === undefined || totalPages === undefined || page >= totalPages) return undefined;
  return `Đang xem trang ${page}/${totalPages}. Hỏi khách có muốn xem tiếp không rồi gọi lại với trang ${page + 1} — đừng tự kéo hết.`;
}
