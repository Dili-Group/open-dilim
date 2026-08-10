// daily.ts — hai tool ĐỌC SỔ NGÀY của đại lý: `bao_cao_ngay` (bốn con số tổng) và
// `chi_tiet_so_ngay` (liệt kê từng đơn của một mục).
//
// MỐC NGÀY LÀ NGÀY XUẤT/HOÀN KHO, không phải ngày tạo đơn — đơn tạo hôm qua mà xuất hôm nay thuộc
// hôm nay. Mọi câu trả lời phải nói rõ điều đó, nếu không đại lý đối chiếu nhầm với sổ tạo đơn.
//
// TỔNG LẤY TỪ `meta` (tổng CẢ NGÀY do backend cộng), KHÔNG cộng các dòng trong `lines` (chỉ là
// trang đang xem). Tool duy nhất tự tính là chênh lệch phải-trả − hoàn-lại, làm bằng BigInt
// (subtractMoney) chứ không để model cộng trừ tiền.
//
// Đại lý đến từ ctx (resolvePrincipal), không phải input LLM sinh — model không hỏi được sổ của
// đại lý khác.

import { AgentApiError, AgentApiErrorCode } from "../../../operational/agent-api.ts";
import {
  DailySection,
  type DailyChargeLine,
  type DailyMeta,
  type DailyOrderLine,
  type DailyPort,
  type DailyQuery,
  type DailyRefundLine,
} from "../../../operational/types.ts";
import { readIntegerField, readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import {
  NO_CUSTOMER,
  formatDate,
  formatDateTime,
  formatMoney,
  line,
  parseVietnamDate,
  resolvePrincipal,
  subtractMoney,
  todayInVietnam,
} from "../order/scope.ts";

/** Chỉ lấy `meta` (tổng cả ngày) — không cần dòng nào, xin 1 cho nhẹ payload. */
const SUMMARY_PAGE_SIZE = 1;

/**
 * Phần trang mà tầng render dùng chung cho cả bốn mục: chỉ cần `meta` và SỐ dòng. Không dùng
 * `DailyPage<Line>` vì bốn mục có bốn kiểu dòng khác nhau, gom lại chỉ để đếm là đủ.
 */
interface DailyPageShape {
  readonly meta: DailyMeta;
  readonly lines: readonly unknown[];
}

/** Bốn mục của báo cáo, ĐÚNG THỨ TỰ: xuất kho, hoàn về, tiền phải trả, tiền hoàn lại. */
type ReportSections = readonly [
  shipped: PromiseSettledResult<DailyPageShape>,
  returned: PromiseSettledResult<DailyPageShape>,
  charges: PromiseSettledResult<DailyPageShape>,
  refunds: PromiseSettledResult<DailyPageShape>,
];

const NO_PORT: ToolResult = {
  content: "Hệ thống sổ ngày chưa sẵn sàng — báo khách là em kiểm tra lại sau.",
  isError: true,
};

const LOOKUP_FAILED: ToolResult = {
  content:
    "Hệ thống vận hành đang không phản hồi nên chưa tra được sổ ngày. Báo khách là em kiểm tra lại " +
    "và trả lời sau, KHÔNG nói là ngày đó không có đơn.",
  isError: true,
};

const INVALID_DATE: ToolResult = {
  content:
    'Ngày không hợp lệ. Hỏi lại khách ngày cụ thể rồi gọi lại với "ngay" dạng dd/mm/yyyy ' +
    "(ví dụ 08/08/2026). Bỏ trống là lấy hôm nay.",
  isError: true,
};

/** Ba câu kèm mọi kết quả: đây là ba chỗ model hay nói sai thành tiền của khách hoặc ngày tạo đơn. */
const DATE_NOTE =
  "Số liệu tính theo NGÀY XUẤT KHO / NGÀY HOÀN, không phải ngày tạo đơn — đơn tạo hôm trước mà " +
  "xuất hôm nay vẫn nằm trong hôm nay.";
const CHARGE_NOTE =
  "Tiền phải chuyển là tiền ĐẠI LÝ chuyển cho công ty (giá đại lý + phí thùng carton), KHÔNG phải " +
  "COD khách trả.";
const TOTAL_NOTE =
  "Các con số trên là tổng CẢ NGÀY do hệ thống cộng sẵn và khớp với file kỳ đối soát. Không cộng " +
  "trừ lại, không làm tròn. Khách báo lệch → hỏi mã vận đơn cụ thể rồi tra bằng tra_don_hang.";

export function buildDailyReportTool(ctx: ToolContext): Tool {
  return {
    name: "bao_cao_ngay",
    description:
      "Tổng kết sổ một ngày của đại lý: số đơn xuất kho, tổng tiền đại lý phải chuyển cho công ty, " +
      "số đơn hoàn về, tổng tiền công ty trả lại. Dùng cho báo cáo cuối ngày và các câu 'hôm nay " +
      "xuất mấy đơn', 'hôm nay phải chuyển bao nhiêu', 'chốt sổ hôm nay'. Bỏ trống `ngay` là hôm " +
      "nay. Trả TỔNG cả ngày — cần danh sách từng đơn thì gọi chi_tiet_so_ngay.",
    inputSchema: {
      type: "object",
      properties: {
        ngay: { type: "string", description: 'Ngày cần chốt, dạng dd/mm/yyyy. Bỏ trống = hôm nay.' },
      },
      required: [],
    },
    announce: "Em kiểm tra sổ ngày chút ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> => runReport(ctx, input, signal),
  };
}

export function buildDailyDetailTool(ctx: ToolContext): Tool {
  return {
    name: "chi_tiet_so_ngay",
    description:
      "Liệt kê từng đơn của MỘT mục trong sổ ngày: đơn xuất kho, đơn hoàn về, tiền phải trả theo " +
      "đơn, hoặc tiền hoàn lại theo đơn. Dùng khi khách hỏi 'gồm những đơn nào', 'liệt kê ra cho " +
      "em'. Mỗi lần 20 đơn — còn trang thì hỏi khách có xem tiếp không, ĐỪNG tự kéo hết mọi trang.",
    inputSchema: {
      type: "object",
      properties: {
        muc: {
          type: "string",
          enum: [
            DailySection.Shipped,
            DailySection.Returned,
            DailySection.Charges,
            DailySection.Refunds,
          ],
          description:
            "xuat_kho = đơn xuất kho; hoan_ve = đơn hoàn về; tien_phai_tra = tiền đại lý chuyển cho " +
            "công ty theo đơn; tien_hoan_lai = tiền công ty trả lại theo đơn.",
        },
        ngay: { type: "string", description: 'Ngày cần xem, dạng dd/mm/yyyy. Bỏ trống = hôm nay.' },
        trang: { type: "integer", description: "Trang cần xem, tính từ 1. Bỏ trống = trang 1." },
      },
      required: ["muc"],
    },
    announce: "Em lấy danh sách đơn cho mình ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> => runDetail(ctx, input, signal),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// bao_cao_ngay
// ─────────────────────────────────────────────────────────────────────────────

async function runReport(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const daily = ctx.daily;
  if (daily === undefined) return NO_PORT;

  const principal = resolvePrincipal(ctx);
  if (principal === undefined) return NO_CUSTOMER;

  const date = parseDate(readStringField(input, "ngay"));
  if (date === undefined) return INVALID_DATE;

  const query: DailyQuery = { ...principal, date, pageSize: SUMMARY_PAGE_SIZE, signal };
  // allSettled: một mục hỏng KHÔNG được nuốt ba mục còn lại — đại lý vẫn đối chiếu được phần đọc được.
  const sections: ReportSections = await Promise.allSettled([
    daily.shippedOrders(query),
    daily.returnedOrders(query),
    daily.charges(query),
    daily.refunds(query),
  ]);

  const fatal = firstFatal(sections, "bao_cao_ngay");
  if (fatal !== undefined) return fatal;

  return { content: renderReport(date, sections) };
}

function renderReport(
  date: string,
  [shipped, returned, charges, refunds]: ReportSections,
): string {
  const shippedMeta = metaOf(shipped);
  const returnedMeta = metaOf(returned);
  const chargesMeta = metaOf(charges);
  const refundsMeta = metaOf(refunds);

  const heading = [formatDate(date) ?? date, dealerOf([shippedMeta, chargesMeta, returnedMeta, refundsMeta])]
    .filter(isPresent)
    .join(" — đại lý ");

  const lines = [
    `Sổ ngày ${heading}`,
    `- Xuất kho: ${countOf(shippedMeta)}`,
    `- Tiền phải chuyển cho công ty: ${amountOf(chargesMeta)}${chargeBreakdown(chargesMeta)}`,
    `- Hoàn về: ${countOf(returnedMeta)}`,
    `- Tiền công ty trả lại: ${amountOf(refundsMeta)}`,
    // Tự tính BẰNG BigInt vì model không được cộng trừ tiền; thiếu một vế thì bỏ hẳn dòng.
    line(
      "Chênh lệch còn phải chuyển",
      formatMoney(subtractMoney(chargesMeta?.totalAmount, refundsMeta?.totalAmount)),
    ),
  ].filter(isPresent);

  lines.push(DATE_NOTE, CHARGE_NOTE, TOTAL_NOTE);
  return lines.join("\n");
}

/** Mục tra không được là dữ kiện phải nói ra, KHÔNG được im lặng biến thành 0 đơn. */
const SECTION_FAILED = "chưa tra được (hệ thống vận hành lỗi)";
const SECTION_MISSING = "hệ thống không trả số — chưa kết luận được";

function countOf(meta: DailyMeta | undefined): string {
  if (meta === undefined) return SECTION_FAILED;
  if (meta.totalItems === undefined) return SECTION_MISSING;
  const quantity = meta.totalQuantity;
  const suffix = quantity === undefined ? "" : ` · ${quantity} sản phẩm`;
  return `${meta.totalItems} đơn${suffix}`;
}

function amountOf(meta: DailyMeta | undefined): string {
  if (meta === undefined) return SECTION_FAILED;
  return formatMoney(meta.totalAmount) ?? SECTION_MISSING;
}

/** Phần tách tiền hàng / phí thùng chỉ để giải thích con số tổng, không phải để model cộng lại. */
function chargeBreakdown(meta: DailyMeta | undefined): string {
  const goods = formatMoney(meta?.goodsAmount);
  const carton = formatMoney(meta?.cartonFee);
  if (goods === undefined || carton === undefined) return "";
  return ` (tiền hàng ${goods} + phí thùng ${carton})`;
}

function metaOf(result: PromiseSettledResult<DailyPageShape>): DailyMeta | undefined {
  return result.status === "fulfilled" ? result.value.meta : undefined;
}

function dealerOf(metas: readonly (DailyMeta | undefined)[]): string | undefined {
  for (const meta of metas) {
    if (meta?.dealerCode !== undefined) return meta.dealerCode;
  }
  return undefined;
}

/**
 * Lỗi khiến CẢ báo cáo vô nghĩa: ngày sai (mọi mục cùng sai) hoặc không mục nào đọc được. Lỗi
 * không phải AgentApiError là bug thật → ném lại để runner ghi log, không nuốt thành "chưa tra được".
 */
function firstFatal(
  sections: readonly PromiseSettledResult<DailyPageShape>[],
  toolName: string,
): ToolResult | undefined {
  let invalidDate = false;
  let failed = 0;
  for (const section of sections) {
    if (section.status !== "rejected") continue;
    const reason: unknown = section.reason;
    if (!(reason instanceof AgentApiError)) throw reason;
    // message chỉ có method/path/status/code — KHÔNG có service token.
    console.error(`[${toolName}] API vận hành lỗi:`, reason.message);
    if (reason.code === AgentApiErrorCode.InvalidDate) invalidDate = true;
    failed++;
  }
  if (invalidDate) return INVALID_DATE;
  return failed === sections.length ? LOOKUP_FAILED : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// chi_tiet_so_ngay
// ─────────────────────────────────────────────────────────────────────────────

const NEED_SECTION: ToolResult = {
  content:
    'Thiếu hoặc sai "muc". Chọn một trong: xuat_kho, hoan_ve, tien_phai_tra, tien_hoan_lai.',
  isError: true,
};

const SECTION_TITLE: Readonly<Record<DailySection, string>> = {
  [DailySection.Shipped]: "Đơn xuất kho",
  [DailySection.Returned]: "Đơn hoàn về",
  [DailySection.Charges]: "Tiền phải chuyển cho công ty",
  [DailySection.Refunds]: "Tiền công ty trả lại",
};

async function runDetail(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const daily = ctx.daily;
  if (daily === undefined) return NO_PORT;

  const principal = resolvePrincipal(ctx);
  if (principal === undefined) return NO_CUSTOMER;

  const section = parseSection(readStringField(input, "muc"));
  if (section === undefined) return NEED_SECTION;

  const date = parseDate(readStringField(input, "ngay"));
  if (date === undefined) return INVALID_DATE;

  const page = readIntegerField(input, "trang");
  const query: DailyQuery = { ...principal, date, page: page === undefined ? 1 : Math.max(1, page), signal };

  try {
    return { content: await renderDetail(daily, section, date, query) };
  } catch (err) {
    if (err instanceof AgentApiError) {
      console.error("[chi_tiet_so_ngay] API vận hành lỗi:", err.message);
      return err.code === AgentApiErrorCode.InvalidDate ? INVALID_DATE : LOOKUP_FAILED;
    }
    throw err;
  }
}

async function renderDetail(
  daily: DailyPort,
  section: DailySection,
  date: string,
  query: DailyQuery,
): Promise<string> {
  const heading = `${SECTION_TITLE[section]} ngày ${formatDate(date) ?? date}`;
  const notes = section === DailySection.Charges ? [DATE_NOTE, CHARGE_NOTE, TOTAL_NOTE] : [DATE_NOTE, TOTAL_NOTE];

  if (section === DailySection.Shipped || section === DailySection.Returned) {
    const page =
      section === DailySection.Shipped
        ? await daily.shippedOrders(query)
        : await daily.returnedOrders(query);
    return join([heading, ...summaryLines(page.meta), ...page.lines.flatMap(renderOrderLine)], page, notes);
  }

  if (section === DailySection.Charges) {
    const page = await daily.charges(query);
    return join([heading, ...summaryLines(page.meta), ...page.lines.map(renderChargeLine)], page, notes);
  }

  const page = await daily.refunds(query);
  return join([heading, ...summaryLines(page.meta), ...page.lines.map(renderRefundLine)], page, notes);
}

function join(
  lines: readonly (string | undefined)[],
  page: DailyPageShape,
  notes: readonly string[],
): string {
  const kept = lines.filter(isPresent);
  if (page.lines.length === 0) kept.push("Trang này không có đơn nào.");
  const more = morePagesNote(page.meta);
  if (more !== undefined) kept.push(more);
  kept.push(...notes);
  return kept.join("\n");
}

/** Tổng cả ngày in NGAY dưới tiêu đề để model không cộng các dòng bên dưới ra tổng. */
function summaryLines(meta: DailyMeta): readonly (string | undefined)[] {
  return [
    line("Tổng cả ngày", meta.totalItems === undefined ? undefined : `${meta.totalItems} đơn`),
    line("Tổng tiền cả ngày", formatMoney(meta.totalAmount)),
  ];
}

function morePagesNote(meta: DailyMeta): string | undefined {
  const page = meta.page;
  const totalPages = meta.totalPages;
  if (page === undefined || totalPages === undefined || page >= totalPages) return undefined;
  return `Đang xem trang ${page}/${totalPages}. Hỏi khách có muốn xem tiếp không rồi gọi lại với trang ${page + 1} — đừng tự kéo hết.`;
}

function renderOrderLine(order: DailyOrderLine): readonly string[] {
  const head = [
    order.trackingNumber,
    formatDateTime(order.at),
    order.quantity === undefined ? undefined : `${order.quantity} sản phẩm`,
    formatMoney(order.goodsAmount),
  ]
    .filter(isPresent)
    .join(" · ");
  // Hàng tặng phải ghi rõ "(Tặng)": line_amount = 0 nên đại lý dễ tưởng bị tính tiền hoặc bị thiếu tiền.
  const items = order.items.map((item) => {
    const parts = [
      [item.productName, item.sku].filter(isPresent).join(" ") || "(không rõ hàng)",
      item.quantity === undefined ? undefined : `x${item.quantity}`,
      item.isGift === true ? "(Tặng)" : formatMoney(item.lineAmount),
    ].filter(isPresent);
    return `    ${parts.join(" · ")}`;
  });
  return [`- ${head}`, ...items];
}

function renderChargeLine(charge: DailyChargeLine): string {
  const parts = [
    charge.trackingNumber,
    formatDateTime(charge.shippedAt),
    charge.quantity === undefined ? undefined : `${charge.quantity} sản phẩm`,
    formatMoney(charge.amount),
    formatMoney(charge.cartonFee) === undefined ? undefined : `phí thùng ${formatMoney(charge.cartonFee)}`,
  ].filter(isPresent);
  return `- ${parts.join(" · ")}`;
}

function renderRefundLine(refund: DailyRefundLine): string {
  const parts = [
    refund.trackingNumber,
    formatDateTime(refund.returnedAt),
    refund.quantity === undefined ? undefined : `${refund.quantity} sản phẩm`,
    formatMoney(refund.amount),
  ].filter(isPresent);
  return `- ${parts.join(" · ")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input LLM = UNTRUSTED: ngày phải là ngày CÓ THẬT trước khi lên query string.
// ─────────────────────────────────────────────────────────────────────────────

function parseSection(raw: string | undefined): DailySection | undefined {
  const found = Object.values(DailySection).find((value) => value === raw);
  return found;
}

/**
 * Bỏ trống → hôm nay (giờ VN). Nhận `dd/mm/yyyy`, `dd-mm-yyyy`, `yyyy-mm-dd` — model in ngày cho
 * khách theo `dd/mm/yyyy` nên nó cũng gọi lại tool bằng dạng đó. Trả về ISO `yyyy-mm-dd`.
 * Ngày không tồn tại (31/02) → undefined để tool hỏi lại, KHÔNG để backend tự đoán.
 */
export function parseDate(raw: string | undefined): string | undefined {
  if (raw === undefined) return todayInVietnam();
  return parseVietnamDate(raw);
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined;
}
