// ghi-ton-kho.ts — tool GHI `ghi_ton_kho`: kho gửi ảnh bảng kiểm kho ("Kho gửi số tồn đầu/cuối
// ngày") → tool tự đọc ảnh, tự kiểm số, rồi ghi số đếm một ca + nộp phiên kiểm
// (`POST /agent/internal/inventory-counts`).
//
// Tool tự đọc ảnh chứ không để model chép số sang: model agent không nhìn được ảnh, mỗi lần chép
// 30+ con số qua một tầng nữa là thêm một chỗ lệch số. Ở đây chữ con đọc ảnh trả về đi thẳng vào
// bộ kiểm chéo (bang-kiem.ts) — model chỉ quyết ca nào, ngày nào.
//
// Lệnh GHI → client KHÔNG retry. Lỗi transport/5xx = KHÔNG BIẾT đã ghi hay chưa.

import { ActorRole } from "../../../flash-command/types.ts";
import { AgentApiError } from "../../../operational/agent-api.ts";
import { CountShift, type StockCountResult } from "../../../operational/types.ts";
import { ImageReadError } from "../../../vision/types.ts";
import { readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import { formatDate, parseVietnamDate, todayInVietnam } from "../order/scope.ts";
import { checkSheet, parseSheet, sheetQuestion } from "./bang-kiem.ts";

/** Trần số dòng lệch in ra — nhóm chat đọc 50 dòng lệch không ai đọc hết. */
const MAX_DIFF_LINES = 20;

const SHIFT_OF: Readonly<Record<string, CountShift>> = {
  dau_ngay: CountShift.DauNgay,
  cuoi_ngay: CountShift.CuoiNgay,
};

const SHIFT_LABEL: Readonly<Record<CountShift, string>> = {
  [CountShift.DauNgay]: "tồn đầu ngày (KK Sáng)",
  [CountShift.CuoiNgay]: "tồn cuối ngày (KK Chiều)",
};

const NO_PORT: ToolResult = {
  content:
    "Chức năng ghi kiểm kho chưa sẵn sàng (thiếu cổng đọc ảnh hoặc cổng hệ thống vận hành) — " +
    "nói rõ là CHƯA ghi được số tồn, nhờ kho nhập trên web.",
  isError: true,
};

/** `/agent/internal/*` bắt buộc `x-staff-id` — không có nhân viên thì backend từ chối ngay. */
const NO_STAFF: ToolResult = {
  content:
    "Người gửi chưa gắn tài khoản nhân viên nên hệ thống không ghi số tồn dưới tên ai được. " +
    "Bảo người gửi gõ /ketnoi-hethong <token> rồi gửi lại ảnh — KHÔNG ghi hộ bằng đường khác.",
  isError: true,
};

const WRITE_FAILED: ToolResult = {
  content:
    "Hệ thống vận hành đang không phản hồi nên KHÔNG RÕ số tồn đã được ghi hay chưa. Nói rõ như " +
    "vậy và nhờ kho kiểm tra trên web — ĐỪNG tự gọi lại.",
  isError: true,
};

export function buildStockCountTool(ctx: ToolContext): Tool {
  return {
    name: "ghi_ton_kho",
    description:
      "GHI số tồn kho một ca từ ẢNH BẢNG KIỂM KHO kho gửi vào nhóm, rồi nộp phiên kiểm. Gọi khi " +
      'có tin "Kho gửi số tồn đầu ngày" (ca dau_ngay) hoặc "Kho gửi số tồn cuối ngày" (ca ' +
      "cuoi_ngay) kèm ảnh. Tool TỰ đọc ảnh và tự đối chiếu (dòng Cộng, công thức KK Sáng + Hoàn + " +
      "Nhập − Xuất = KK Chiều) — lệch thì KHÔNG ghi gì và trả lý do. Đây là lệnh GHI, gọi MỘT lần " +
      "cho mỗi ảnh.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "Link ảnh bảng kiểm, chép NGUYÊN VĂN từ ghi chú [ảnh đính kèm ... url: ...] của tin kho " +
            "gửi. Không tự ghép link.",
        },
        ca: {
          type: "string",
          enum: ["dau_ngay", "cuoi_ngay"],
          description: '"dau_ngay" = tin "số tồn đầu ngày"; "cuoi_ngay" = tin "số tồn cuối ngày".',
        },
        ngay: {
          type: "string",
          description:
            "Ngày kiểm dd/mm/yyyy hoặc YYYY-MM-DD, lấy từ chính tin kho gửi. Tin không ghi ngày " +
            "thì bỏ trống = hôm nay.",
        },
      },
      required: ["url", "ca"],
    },
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> => run(ctx, input, signal),
  };
}

async function run(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const { vision, inventoryCount } = ctx;
  if (vision === undefined || inventoryCount === undefined) return NO_PORT;
  const staffId = resolveStaffId(ctx);
  if (staffId === undefined) return NO_STAFF;

  const url = readStringField(input, "url");
  if (url === undefined) {
    return {
      content:
        'Thiếu "url". Chép nguyên văn link trong ghi chú [ảnh đính kèm ... url: ...] của tin kho ' +
        "gửi. Tin không kèm ảnh thì nhờ kho gửi lại kèm ảnh bảng kiểm.",
      isError: true,
    };
  }
  const shift = SHIFT_OF[readStringField(input, "ca") ?? ""];
  if (shift === undefined) {
    return { content: '"ca" phải là "dau_ngay" hoặc "cuoi_ngay".', isError: true };
  }
  const rawDate = readStringField(input, "ngay");
  const date = rawDate === undefined ? todayInVietnam() : parseVietnamDate(rawDate);
  if (date === undefined) {
    return { content: `Ngày "${rawDate}" không hợp lệ. Dùng dd/mm/yyyy hoặc YYYY-MM-DD.`, isError: true };
  }
  const day = Number(date.slice(8, 10));

  let text: string;
  try {
    text = await vision.read({ url, question: sheetQuestion(day), signal });
  } catch (err) {
    // Lỗi đọc được trước (link lạ, ảnh to) → lời cho model. Lỗi hạ tầng để runner bắt.
    if (err instanceof ImageReadError) return { content: err.message, isError: true };
    throw err;
  }

  const check = checkSheet(parseSheet(text), shift, day);
  if (!check.ok) {
    return {
      content: [
        "CHƯA GHI GÌ — số đọc từ ảnh không khớp nên không dám ghi:",
        ...check.problems.map((problem) => `- ${problem}`),
        "Báo kho đúng các điểm trên và nhờ chụp lại rõ, đủ cả bảng (gồm dòng Cộng). KHÔNG tự sửa " +
          "số, KHÔNG gọi lại với cùng ảnh.",
      ].join("\n"),
      isError: true,
    };
  }

  let result: StockCountResult;
  try {
    result = await inventoryCount.record({
      staffId,
      date,
      shift,
      lines: check.lines.map((line) => ({ sku: line.sku, countedQuantity: line.quantity })),
      signal,
    });
  } catch (err) {
    if (!(err instanceof AgentApiError)) throw err;
    // message chỉ có method/path/status/lời backend — KHÔNG có service token.
    console.error("[ghi_ton_kho] API vận hành lỗi:", err.message);
    if (err.status === 0 || err.status >= 500) return WRITE_FAILED;
    return {
      content: `Hệ thống từ chối, CHƯA ghi số tồn: ${err.message}. Báo kho nguyên nhân này.`,
      isError: true,
    };
  }

  return {
    content: render({ date, shift, readTotal: check.total, skipped: check.skipped, result }),
  };
}

/** `accounts.id` bigint → chỉ nhận chuỗi số thuần; bind cũ/hỏng thì coi như chưa gắn nhân viên. */
function resolveStaffId(ctx: ToolContext): string | undefined {
  if (ctx.identity.role !== ActorRole.NhanVien) return undefined;
  return /^\d+$/.test(ctx.identity.userId) ? ctx.identity.userId : undefined;
}

interface RenderInput {
  readonly date: string;
  readonly shift: CountShift;
  readonly readTotal: number;
  readonly skipped: readonly { readonly stt: number; readonly quantity: number }[];
  readonly result: StockCountResult;
}

export function render({ date, shift, readTotal, skipped, result }: RenderInput): string {
  const lines = [
    `Đã ghi ${SHIFT_LABEL[shift]} ngày ${formatDate(date) ?? date}: ${countOf(result.saved)} mã, ` +
      `dòng Cộng trên bảng ${formatQuantity(readTotal)} (đã khớp với từng dòng).`,
    result.submittedNow === false
      ? "Phiên đã nộp từ trước — lần này chỉ cập nhật lại số đếm."
      : "Đã nộp phiên kiểm.",
    ...compareLines(shift, result),
  ];
  if (result.unknownSkus.length > 0) {
    lines.push(`KHÔNG ghi — mã không có trong danh mục: ${result.unknownSkus.join(", ")}`);
  }
  if (skipped.length > 0) {
    const rows = skipped.map((row) => `STT ${row.stt} (${formatQuantity(row.quantity)})`);
    lines.push(`KHÔNG ghi — dòng không có mã hàng: ${rows.join(", ")}`);
  }
  lines.push(
    "Báo kho ngắn gọn: đã ghi bao nhiêu mã, lệch MISA những mã nào (nếu có), và mã/dòng nào không " +
      "ghi được — đừng đọc lại cả bảng.",
  );
  return lines.join("\n");
}

function compareLines(shift: CountShift, result: StockCountResult): string[] {
  if (result.compared !== true) {
    return shift === CountShift.CuoiNgay
      ? ["Ca cuối ngày: hệ thống tự so với MISA lúc 23:59."]
      : ["Chưa so được với MISA (MISA chưa chốt số hôm trước)."];
  }
  if (result.diffs.length === 0) return ["So với MISA: khớp hết."];
  const shown = result.diffs.slice(0, MAX_DIFF_LINES).map(
    (diff) =>
      `- ${diff.sku}${diff.name === undefined ? "" : ` ${diff.name}`}: đếm ${optional(diff.counted)}, ` +
      `MISA ${optional(diff.misa)} (${signed(diff.diff)})`,
  );
  const more = result.diffs.length - shown.length;
  return [
    `Lệch MISA ${result.diffs.length} mã:`,
    ...shown,
    ...(more > 0 ? [`- … và ${more} mã khác (xem trên web)`] : []),
  ];
}

function countOf(count: number | undefined): string {
  return count === undefined ? "(hệ thống không trả số)" : String(count);
}

function optional(quantity: number | undefined): string {
  return quantity === undefined ? "không rõ" : formatQuantity(quantity);
}

function signed(diff: number | undefined): string {
  if (diff === undefined) return "lệch không rõ";
  return diff > 0 ? `+${formatQuantity(diff)}` : formatQuantity(diff);
}

/**
 * 4347 → "4.347" — đúng kiểu kho đang ghi trên bảng. Tự chèn dấu chứ không `toLocaleString`: máy
 * thiếu locale data thì Intl lặng lẽ rơi về "4,347" (xem usage/budget.ts).
 */
function formatQuantity(quantity: number): string {
  return String(quantity).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
