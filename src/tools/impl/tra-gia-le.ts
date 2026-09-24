// tra-gia-le.ts — `tra_gia_le` ĐỌC: báo giá LẺ một giỏ hàng cho khách Messenger — giá khách thực
// trả sau khi áp chương trình tốt nhất (engine pricing-vector), kèm giá lẻ cộng dồn và quà.
//
// Mô tả tool kèm danh mục SKU: model đối chiếu tên khách gõ hoặc nhãn trên ẢNH với danh mục rồi
// truyền mã. Mã trong danh mục dùng thẳng; còn lại tool tìm theo tên, khớp nhiều sản phẩm → trả
// danh sách để model hỏi lại khách, KHÔNG tự chọn hộ.
//
// Không có tham số danh tính nào: giá không phụ thuộc người hỏi, nên người nhắn chưa xác thực
// gọi được mà không rò gì.

import { AgentApiError } from "../../operational/agent-api.ts";
import type { RetailProduct, RetailQuote } from "../../operational/types.ts";
import { readIntegerField, readStringField } from "../input.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";
import { formatMoney } from "./order/scope.ts";
import { findCatalogProduct, renderCatalog } from "./retail-catalog.ts";

/** Giỏ khách lẻ vài dòng là cùng; quá mức này là model gửi rác. */
const MAX_CART_LINES = 10;
/** Số lượng một dòng — khách lẻ không mua cả kho; quá mức là đọc nhầm số. */
const MAX_QUANTITY = 100;

const NO_PORT: ToolResult = {
  content:
    "Chưa tra được giá vì hệ thống báo giá chưa sẵn sàng. KHÔNG tự đoán giá — nói với khách là " +
    "nhân viên sẽ báo giá chính xác khi gọi xác nhận đơn, rồi tiếp tục gom thông tin đặt hàng.",
  isError: true,
};

const LOOKUP_FAILED: ToolResult = {
  content:
    "Hệ thống báo giá đang trục trặc, chưa tra được. KHÔNG tự đoán giá — nói với khách là nhân " +
    "viên sẽ báo giá chính xác khi gọi xác nhận đơn, rồi tiếp tục gom thông tin đặt hàng.",
  isError: true,
};

const INVALID_INPUT: ToolResult = {
  content:
    `Giỏ hàng chưa hợp lệ. Truyền "gio_hang" là mảng 1–${MAX_CART_LINES} dòng, mỗi dòng có ` +
    `"san_pham" (tên hoặc mã khách nói) và "so_luong" (số nguyên 1–${MAX_QUANTITY}).`,
  isError: true,
};

/**
 * Backend trả null ở hai ca nó không tách: giỏ không có chương trình nào rẻ hơn giá lẻ, hoặc có
 * sản phẩm chưa có giá lẻ. Cả hai đều = không có con số nào đáng tin để nói.
 */
const NO_QUOTE: ToolResult = {
  content:
    "Hệ thống chưa tính được giá cho giỏ này. KHÔNG tự đoán, KHÔNG lấy giá ở đâu khác — nói với " +
    "khách là nhân viên sẽ báo giá chính xác khi gọi xác nhận đơn, rồi tiếp tục gom thông tin.",
};

interface CartRequestLine {
  readonly query: string;
  readonly quantity: number;
}

type LineMatch =
  | { readonly kind: "found"; readonly product: RetailProduct; readonly quantity: number }
  | { readonly kind: "missing"; readonly query: string }
  | { readonly kind: "ambiguous"; readonly query: string; readonly candidates: readonly RetailProduct[] };

export function buildRetailQuoteTool(ctx: ToolContext): Tool {
  return {
    name: "tra_gia_le",
    description:
      "ĐỌC: báo giá lẻ cho một giỏ hàng — số tiền khách thực trả sau khi hệ thống tự áp chương " +
      "trình khuyến mãi tốt nhất, kèm giá lẻ cộng dồn, số tiết kiệm và quà tặng. Gọi khi khách hỏi " +
      "giá, hỏi combo, hoặc trước khi tóm đơn. CHỈ báo giá theo kết quả tool, không tự tính, không " +
      "tự giảm.\n" +
      "Đối chiếu sản phẩm với danh mục dưới rồi truyền MÃ vào san_pham — kể cả khi khách gửi ẢNH: " +
      "đọc nhãn (tên, hoạt chất, quy cách) và so với tên trong danh mục (vd hộp \"Coenzyme Q10 " +
      "dạng khử\" = AFCRICH). Không chắc là mã nào thì truyền tên khách nói; ảnh không khớp sản " +
      "phẩm nào trong danh mục thì đó không phải hàng bên mình bán.\n" +
      "Danh mục (MÃ: tên):\n" +
      renderCatalog(),
    inputSchema: {
      type: "object",
      properties: {
        gio_hang: {
          type: "array",
          items: {
            type: "object",
            properties: {
              san_pham: {
                type: "string",
                description: "Mã trong danh mục (vd \"SCMNB\"), hoặc tên khách nói nếu chưa rõ mã.",
              },
              so_luong: { type: "integer", description: "Số lượng khách muốn mua, nguyên dương." },
            },
            required: ["san_pham", "so_luong"],
          },
          description: "Các dòng hàng khách muốn mua. Cùng một sản phẩm thì gộp vào một dòng.",
        },
      },
      required: ["gio_hang"],
    },
    announce: "Em xem giá chút ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> => run(ctx, input, signal),
  };
}

async function run(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const pricing = ctx.retailPricing;
  if (pricing === undefined) return NO_PORT;

  const cart = readCart(input);
  if (cart === undefined) return INVALID_INPUT;

  let matches: LineMatch[];
  let quote: RetailQuote | null;
  try {
    matches = await Promise.all(
      cart.map(async (line): Promise<LineMatch> => {
        const known = findCatalogProduct(line.query);
        if (known !== undefined) return { kind: "found", product: known, quantity: line.quantity };
        return matchLine(line, await pricing.searchProducts(line.query, signal));
      }),
    );
    const unresolved = renderUnresolved(matches);
    if (unresolved !== undefined) return unresolved;
    quote = await pricing.recommend(toCartLines(matches), signal);
  } catch (err) {
    if (err instanceof AgentApiError) {
      // message chỉ có method/path/status/code — KHÔNG có token.
      console.error("[tra_gia_le] API báo giá lỗi:", err.message);
      return LOOKUP_FAILED;
    }
    throw err;
  }

  if (quote === null) return NO_QUOTE;
  return { content: renderQuote(quote, matches) };
}

/** Một dòng sai shape → loại CẢ giỏ: báo giá thiếu một dòng là báo sai tổng. */
function readCart(input: unknown): readonly CartRequestLine[] | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)["gio_hang"];
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CART_LINES) return undefined;
  const lines: CartRequestLine[] = [];
  for (const entry of value) {
    const query = readStringField(entry, "san_pham")?.trim();
    const quantity = readIntegerField(entry, "so_luong");
    if (query === undefined || query === "") return undefined;
    if (quantity === undefined || quantity <= 0 || quantity > MAX_QUANTITY) return undefined;
    lines.push({ query, quantity });
  }
  return lines;
}

/**
 * Khớp chính xác SKU hoặc tên thắng ngay (tên "Sụn khớp" cũng khớp ILIKE "Sụn khớp Plus").
 * Không khớp chính xác mà chỉ ra đúng một sản phẩm → lấy. Nhiều hơn → để khách chọn.
 */
function matchLine(line: CartRequestLine, products: readonly RetailProduct[]): LineMatch {
  const wanted = line.query.toLocaleLowerCase("vi");
  const exact = products.find(
    (p) => p.sku.toLocaleLowerCase("vi") === wanted || p.name.toLocaleLowerCase("vi") === wanted,
  );
  const only = products.length === 1 ? products[0] : undefined;
  const product = exact ?? only;
  if (product !== undefined) return { kind: "found", product, quantity: line.quantity };
  if (products.length === 0) return { kind: "missing", query: line.query };
  return { kind: "ambiguous", query: line.query, candidates: products };
}

function renderUnresolved(matches: readonly LineMatch[]): ToolResult | undefined {
  const lines: string[] = [];
  for (const match of matches) {
    if (match.kind === "missing") {
      lines.push(`- "${match.query}": không tìm thấy sản phẩm nào đang bán mang tên này.`);
    } else if (match.kind === "ambiguous") {
      const names = match.candidates.map((p) => p.name).join("; ");
      lines.push(`- "${match.query}": khớp nhiều sản phẩm — ${names}.`);
    }
  }
  if (lines.length === 0) return undefined;
  return {
    content: [
      "Chưa báo giá được vì chưa rõ sản phẩm:",
      ...lines,
      "Hỏi lại khách đúng MỘT câu cho rõ sản phẩm (đọc tên các lựa chọn nếu có), rồi gọi lại tool " +
        "với tên đầy đủ. KHÔNG tự chọn hộ khách, KHÔNG báo giá phần đã rõ khi giỏ còn thiếu.",
    ].join("\n"),
    isError: true,
  };
}

/** Gộp theo SKU: hai cách gọi tên cùng một sản phẩm không được thành hai dòng giá. */
function toCartLines(matches: readonly LineMatch[]): { sku: string; quantity: number }[] {
  const bySku = new Map<string, number>();
  for (const match of matches) {
    if (match.kind !== "found") continue;
    bySku.set(match.product.sku, (bySku.get(match.product.sku) ?? 0) + match.quantity);
  }
  return [...bySku].map(([sku, quantity]) => ({ sku, quantity }));
}

function renderQuote(quote: RetailQuote, matches: readonly LineMatch[]): string {
  const names = new Map<string, RetailProduct>();
  for (const match of matches) {
    if (match.kind === "found") names.set(match.product.sku, match.product);
  }
  const epoch = quote.pricingEpoch === undefined ? "" : ` (bảng giá phiên bản ${quote.pricingEpoch})`;

  const out = [`Báo giá giỏ hàng${epoch}:`];
  for (const line of toCartLines(matches)) {
    const product = names.get(line.sku);
    out.push(`- ${product?.name ?? line.sku}: ${line.quantity} ${product?.unit ?? ""}`.trimEnd());
  }
  out.push(`Khách trả (tiền hàng, CHƯA gồm phí ship): ${money(quote.optimal)}`);
  if (quote.savings > 0) {
    out.push(`Nếu mua lẻ từng hộp: ${money(quote.retailTotal)} — tiết kiệm ${money(quote.savings)}`);
  }
  for (const campaign of quote.campaigns) {
    const times = campaign.count > 1 ? ` ×${campaign.count}` : "";
    out.push(`Chương trình áp dụng: ${campaign.label}${times}`);
    for (const [sku, quantity] of Object.entries(campaign.gifts ?? {})) {
      out.push(`  Quà tặng kèm: ${names.get(sku)?.name ?? sku} ×${quantity * campaign.count}`);
    }
  }
  out.push(
    "Cách nói: báo đúng số \"khách trả\", nêu tên chương trình và quà nếu có. Phí ship nhân viên " +
      "báo khi gọi xác nhận đơn. KHÔNG làm tròn, KHÔNG tự giảm thêm, KHÔNG hứa quà ngoài danh sách này.",
  );
  return out.join("\n");
}

function money(value: number): string {
  return formatMoney(String(value)) ?? `${value}`;
}
