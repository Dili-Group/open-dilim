// daily-orders.ts — ba tool ĐỌC SỔ XUẤT KHO / HOÁ ĐƠN MISA của TOÀN HỆ THỐNG:
// `don_xuat_kho`, `don_da_hoa_don`, `don_chua_hoa_don`. Ba tập khớp nhau:
// đã hoá đơn + chưa hoá đơn = xuất kho (hai tập con bù nhau, không chồng lấn).
//
// KHÔNG GẮN ĐẠI LÝ: khác mọi tool nghiệp vụ khác trong repo, bộ này trả đơn của MỌI đại lý. Vì vậy
// hàng rào duy nhất là NGƯỜI GÕ: chỉ nhân viên đã `/ketnoi-hethong` mới gọi được (staffId lấy từ
// identity server-side, không phải tham số LLM sinh). Đại lý/guest gọi → từ chối thẳng.
//
// MỐC NGÀY LÀ NGÀY XUẤT KHO (`orders.shipped_out_at`, giờ VN), không phải ngày tạo đơn — cùng cửa
// sổ với file đối soát. Mọi câu trả lời phải nói rõ điều đó.
//
// TỔNG LẤY TỪ `meta` (tổng CẢ NGÀY do backend cộng), KHÔNG đếm các dòng trong `lines` (chỉ là trang
// đang xem).

import { ActorRole } from "../../../flash-command/types.ts";
import { AgentApiError, AgentApiErrorCode } from "../../../operational/agent-api.ts";
import type {
  InternalDailyMeta,
  InternalDailyPage,
  InternalDailyQuery,
  InternalOrderLine,
  InternalOrdersPort,
} from "../../../operational/types.ts";
import { readIntegerField, readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import { formatDate, formatDateTime, parseVietnamDate, todayInVietnam } from "../order/scope.ts";

/** Mục nào của sổ nội bộ đang hỏi — quyết định endpoint, tiêu đề và cách in một dòng. */
const InternalSection = {
  Shipped: "shipped",
  Invoiced: "invoiced",
  Uninvoiced: "uninvoiced",
} as const;
type InternalSection = (typeof InternalSection)[keyof typeof InternalSection];

const SECTION_TITLE: Readonly<Record<InternalSection, string>> = {
  [InternalSection.Shipped]: "Đơn xuất kho toàn hệ thống",
  [InternalSection.Invoiced]: "Đơn ĐÃ tạo hoá đơn MISA",
  [InternalSection.Uninvoiced]: "Đơn CHƯA tạo hoá đơn MISA",
};

const NO_PORT: ToolResult = {
  content: "Hệ thống sổ nội bộ chưa sẵn sàng — nói rõ là chưa tra được, kiểm tra lại sau.",
  isError: true,
};

/**
 * Dữ liệu ở đây là của MỌI đại lý nên không có đường "đoán người gõ là ai": chưa biết nhân viên
 * nào thì không gọi. Đại lý/guest rơi vào đây, và đó là ĐÚNG — họ không được xem sổ toàn hệ thống.
 */
const NO_STAFF: ToolResult = {
  content:
    "Chỉ nhân viên đã kết nối hệ thống mới xem được sổ này (dữ liệu của toàn bộ đại lý). " +
    "Bảo người hỏi gõ /ketnoi-hethong <token> rồi hỏi lại — KHÔNG tra hộ bằng đường khác.",
  isError: true,
};

const INVALID_DATE: ToolResult = {
  content:
    'Ngày không hợp lệ. Hỏi lại ngày cụ thể rồi gọi lại với "ngay" dạng dd/mm/yyyy ' +
    "(ví dụ 08/08/2026). Bỏ trống là lấy hôm nay.",
  isError: true,
};

const LOOKUP_FAILED: ToolResult = {
  content:
    "Hệ thống vận hành đang không phản hồi nên chưa tra được sổ. Nói rõ là hệ thống lỗi và sẽ " +
    "kiểm tra lại, KHÔNG nói là ngày đó không có đơn.",
  isError: true,
};

/** Ba câu kèm mọi kết quả: đây là ba chỗ model hay hiểu sai thành ngày tạo đơn hoặc sổ một đại lý. */
const DATE_NOTE =
  "Số liệu tính theo NGÀY XUẤT KHO (shipped_out_at, giờ VN), không phải ngày tạo đơn — đơn tạo " +
  "hôm trước mà xuất hôm nay vẫn nằm trong hôm nay.";
const SCOPE_NOTE =
  "Đây là số liệu TOÀN HỆ THỐNG (mọi đại lý), không phải sổ của một đại lý. Đừng gửi nguyên danh " +
  "sách này vào nhóm đại lý.";
const TOTAL_NOTE =
  "Con số tổng là tổng CẢ NGÀY do hệ thống cộng sẵn và khớp file kỳ đối soát: đã hoá đơn + chưa " +
  "hoá đơn = xuất kho. Không cộng lại theo các dòng đang xem.";
/** Chỉ kèm ở mục chưa hoá đơn: hai lý do khác nhau, xử lý khác nhau. */
const UNINVOICED_NOTE =
  "Hàng đợi này gồm CẢ đơn chưa có phiếu xuất kho lẫn đơn đã có phiếu nhưng chưa đẩy được sang " +
  "MISA — nhìn cột phiếu để biết đơn nào thuộc loại nào.";

export function buildInternalShippedOrdersTool(ctx: ToolContext): Tool {
  return {
    name: "don_xuat_kho",
    description:
      "Danh sách đơn XUẤT KHO trong một ngày của TOÀN HỆ THỐNG (mọi đại lý), mỗi đơn kèm trạng " +
      "thái đã/chưa tạo hoá đơn MISA. Dùng cho các câu 'hôm nay xuất bao nhiêu đơn', 'đơn xuất " +
      "kho ngày X'. Bỏ trống `ngay` là hôm nay. Chỉ nhân viên gọi được.",
    inputSchema: querySchema("Ngày cần xem đơn xuất kho"),
    announce: "Em soát sổ xuất kho chút ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> =>
      run(ctx, InternalSection.Shipped, input, signal),
  };
}

export function buildInternalInvoicedOrdersTool(ctx: ToolContext): Tool {
  return {
    name: "don_da_hoa_don",
    description:
      "Danh sách đơn ĐÃ tạo hoá đơn MISA trong một ngày (toàn hệ thống). Dùng khi cần biết đã " +
      "xuất được bao nhiêu hoá đơn trong ngày. Bỏ trống `ngay` là hôm nay. Chỉ nhân viên gọi được.",
    inputSchema: querySchema("Ngày cần soát hoá đơn đã tạo"),
    announce: "Em soát danh sách hoá đơn đã tạo ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> =>
      run(ctx, InternalSection.Invoiced, input, signal),
  };
}

export function buildInternalUninvoicedOrdersTool(ctx: ToolContext): Tool {
  return {
    name: "don_chua_hoa_don",
    description:
      "Danh sách đơn CHƯA tạo hoá đơn MISA trong một ngày (toàn hệ thống) — hàng đợi cần xử lý. " +
      "Dùng cho các câu 'còn đơn nào chưa xuất hoá đơn', 'còn tồn bao nhiêu hoá đơn'. Bỏ trống " +
      "`ngay` là hôm nay. Chỉ nhân viên gọi được.",
    inputSchema: querySchema("Ngày cần soát đơn chưa có hoá đơn"),
    announce: "Em soát hàng đợi hoá đơn ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> =>
      run(ctx, InternalSection.Uninvoiced, input, signal),
  };
}

function querySchema(dateLabel: string): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      ngay: { type: "string", description: `${dateLabel}, dạng dd/mm/yyyy. Bỏ trống = hôm nay.` },
      trang: { type: "integer", description: "Trang cần xem, tính từ 1. Bỏ trống = trang 1." },
    },
    required: [],
  };
}

async function run(
  ctx: ToolContext,
  section: InternalSection,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const internal = ctx.internal;
  if (internal === undefined) return NO_PORT;

  const staffId = resolveStaffId(ctx);
  if (staffId === undefined) return NO_STAFF;

  const date = parseDate(readStringField(input, "ngay"));
  if (date === undefined) return INVALID_DATE;

  const page = readIntegerField(input, "trang");
  const query: InternalDailyQuery = {
    staffId,
    date,
    page: page === undefined ? 1 : Math.max(1, page),
    signal,
  };

  try {
    return { content: render(section, date, await fetchSection(internal, section, query)) };
  } catch (err) {
    if (err instanceof AgentApiError) {
      // message chỉ có method/path/status/code — KHÔNG có service token.
      console.error(`[${SECTION_TOOL_NAME[section]}] API vận hành lỗi:`, err.message);
      return err.code === AgentApiErrorCode.InvalidDate ? INVALID_DATE : LOOKUP_FAILED;
    }
    throw err;
  }
}

const SECTION_TOOL_NAME: Readonly<Record<InternalSection, string>> = {
  [InternalSection.Shipped]: "don_xuat_kho",
  [InternalSection.Invoiced]: "don_da_hoa_don",
  [InternalSection.Uninvoiced]: "don_chua_hoa_don",
};

function fetchSection(
  internal: InternalOrdersPort,
  section: InternalSection,
  query: InternalDailyQuery,
): Promise<InternalDailyPage> {
  if (section === InternalSection.Shipped) return internal.shippedOrders(query);
  if (section === InternalSection.Invoiced) return internal.invoicedOrders(query);
  return internal.uninvoicedOrders(query);
}

/**
 * Nhân viên đang gõ, lấy từ identity SERVER-SIDE. `accounts.id` là bigint nên chuỗi không phải số
 * thuần là bind hỏng → coi như chưa biết ai, KHÔNG gửi rác lên header.
 */
function resolveStaffId(ctx: ToolContext): string | undefined {
  if (ctx.identity.role !== ActorRole.NhanVien) return undefined;
  return /^\d+$/.test(ctx.identity.userId) ? ctx.identity.userId : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────────

function render(section: InternalSection, date: string, page: InternalDailyPage): string {
  const lines: string[] = [
    `${SECTION_TITLE[section]} ngày ${formatDate(page.meta.date ?? date) ?? date}`,
    `Tổng cả ngày: ${totalOf(page.meta)}`,
  ];

  if (page.lines.length === 0) {
    lines.push("Trang này không có đơn nào.");
  } else {
    lines.push(...page.lines.map((order) => renderLine(section, order)));
  }

  const more = morePagesNote(page.meta);
  if (more !== undefined) lines.push(more);

  lines.push(DATE_NOTE, SCOPE_NOTE, TOTAL_NOTE);
  if (section === InternalSection.Uninvoiced) lines.push(UNINVOICED_NOTE);
  return lines.join("\n");
}

/** Thiếu tổng là dữ kiện phải nói ra, KHÔNG được im lặng biến thành 0 đơn. */
const TOTAL_MISSING = "hệ thống không trả số — chưa kết luận được";

function totalOf(meta: InternalDailyMeta): string {
  return meta.totalItems === undefined ? TOTAL_MISSING : `${meta.totalItems} đơn`;
}

/**
 * Một dòng đơn. In giá trị trần ngăn bằng `·` (không phải bảng TOON): khối này không lặp NHÃN nào
 * nên header bảng chỉ tốn thêm token — đã đo ở tool sổ ngày đại lý.
 */
function renderLine(section: InternalSection, order: InternalOrderLine): string {
  const parts = [
    order.trackingNumber,
    dealerOf(order),
    formatDateTime(order.shippedAt),
    voucherOf(order),
    invoiceStateOf(section, order),
  ].filter(isPresent);
  return `- ${parts.join(" · ")}`;
}

function dealerOf(order: InternalOrderLine): string | undefined {
  const parts = [order.dealerCode, order.dealerName].filter(isPresent);
  return parts.length === 0 ? undefined : parts.join(" ");
}

/** Không có phiếu xuất kho là dữ kiện QUAN TRỌNG ở hàng đợi: đơn chưa bàn giao, không phải lỗi đẩy MISA. */
function voucherOf(order: InternalOrderLine): string | undefined {
  return order.voucherCode ?? "chưa có phiếu xuất kho";
}

/**
 * Ở hai mục đã lọc sẵn thì cờ `invoiced` là thừa (mọi dòng như nhau) — chỉ in mốc đẩy MISA nếu có.
 * Ở mục xuất kho thì đây là cột đáng nhìn nhất.
 */
function invoiceStateOf(section: InternalSection, order: InternalOrderLine): string | undefined {
  if (section === InternalSection.Invoiced) {
    const at = formatDateTime(order.misaSyncAt);
    return at === undefined ? undefined : `đẩy MISA ${at}`;
  }
  if (section === InternalSection.Uninvoiced) return undefined;
  if (order.invoiced === undefined) return undefined;
  return order.invoiced ? "đã hoá đơn" : "chưa hoá đơn";
}

function morePagesNote(meta: InternalDailyMeta): string | undefined {
  const page = meta.page;
  const totalPages = meta.totalPages;
  if (page === undefined || totalPages === undefined || page >= totalPages) return undefined;
  return (
    `Đang xem trang ${page}/${totalPages}. Cần xem tiếp thì gọi lại với trang ${page + 1} — ` +
    "đừng tự kéo hết mọi trang."
  );
}

/**
 * Bỏ trống → hôm nay (giờ VN). Nhận `dd/mm/yyyy`, `dd-mm-yyyy`, `yyyy-mm-dd`. Ngày không tồn tại
 * (31/02) → undefined để tool hỏi lại, KHÔNG để backend tự đoán.
 */
export function parseDate(raw: string | undefined): string | undefined {
  if (raw === undefined) return todayInVietnam();
  return parseVietnamDate(raw);
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined;
}
