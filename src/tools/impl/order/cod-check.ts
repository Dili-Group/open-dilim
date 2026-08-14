// cod-check.ts — tool ĐỌC `kiem_tra_gia_cod`: đối chiếu COD của một đơn (hoặc một giỏ tự nhập)
// với bảng giá hiện hành qua engine `/agent/orders/cod-check`. POST nhưng không ghi gì.
//
// Dùng khi đại lý hỏi "đơn này sao chưa đi" (đơn mới có thể bị giữ vì lệch giá), "COD vậy đúng
// chưa", hoặc muốn báo giá một giỏ trước khi lên đơn. Cách đọc kết quả + ranh giới phát ngôn
// (không buộc tội đại lý khi UNREACHABLE, không khẳng định quà khi engine không phân rã được)
// nằm ở skill `kiem-tra-gia-cod` — tool chỉ dịch số liệu thành chữ kèm cảnh báo tại chỗ.
//
// Hai số tiền dễ đọc nhầm: `cod` là TIỀN HÀNG engine đối chiếu (đã trừ ship nếu nguồn đơn gộp
// ship vào COD), `orderCodAmount` là số TÀI XẾ THU trên đơn. Renderer in cả hai và dán nhãn rõ.

import { AgentApiError } from "../../../operational/agent-api.ts";
import type { CodCheckResult, CodCheckVia } from "../../../operational/types.ts";
import { readIntegerField, readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import {
  LOOKUP_FAILED,
  NO_CUSTOMER,
  NO_PORT,
  formatMoney,
  line,
  orderNotFound,
  resolvePrincipal,
} from "./scope.ts";

/** Trần số dòng hàng một giỏ tự nhập — giỏ thật không tới mức này, quá là model gửi rác. */
const MAX_CART_LINES = 50;

const INVALID_INPUT: ToolResult = {
  content:
    'Thiếu dữ liệu để kiểm giá. Truyền "ma_van_don" (kiểm đơn có sẵn trong hệ thống), HOẶC đủ cả ' +
    '"gio_hang" (mảng {sku, so_luong}) lẫn "cod" (VND nguyên, tiền hàng ĐÃ trừ ship) để kiểm một ' +
    "giỏ tự nhập. Mỗi lần gọi kiểm đúng 1 đơn/giỏ.",
  isError: true,
};

export function buildCodCheckTool(ctx: ToolContext): Tool {
  return {
    name: "kiem_tra_gia_cod",
    description:
      "Đối chiếu COD với bảng giá hiện hành của hệ thống: COD đúng giá chưa, thu dư bao nhiêu, " +
      "mức đúng gần nhất là bao nhiêu. Dùng khi đơn ở trạng thái mới mãi chưa đi (nghi bị giữ vì " +
      "lệch giá), khi đại lý hỏi COD đơn này đúng chưa, hoặc muốn tính giá một giỏ trước khi lên " +
      "đơn. Có mã vận đơn thì truyền `ma_van_don` (giỏ lấy từ đơn trong hệ thống); chưa lên đơn " +
      "thì truyền `gio_hang` + `cod`. Mỗi lần gọi 1 đơn/giỏ. CHỈ ĐỌC — không sửa giá, không duyệt đơn.",
    inputSchema: {
      type: "object",
      properties: {
        ma_van_don: {
          type: "string",
          description:
            "Mã vận đơn cần kiểm giá — hệ thống tự lấy giỏ hàng và COD của đơn, khi có mã thì " +
            "gio_hang/cod bị bỏ qua. Bỏ trống nếu kiểm một giỏ chưa lên đơn.",
        },
        gio_hang: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sku: { type: "string", description: "Mã SKU sản phẩm." },
              so_luong: { type: "integer", description: "Số lượng, nguyên dương." },
            },
            required: ["sku", "so_luong"],
          },
          description:
            "Giỏ hàng tự nhập khi KHÔNG có mã vận đơn. Phải đi kèm `cod`.",
        },
        cod: {
          type: "integer",
          description:
            "COD của giỏ tự nhập: VND nguyên, là TIỀN HÀNG đã trừ phí ship. Chỉ dùng kèm `gio_hang`.",
        },
      },
      required: [],
    },
    announce: "Em đối chiếu giá chút ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> => run(ctx, input, signal),
  };
}

async function run(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const orders = ctx.orders;
  if (orders === undefined) return NO_PORT;

  const principal = resolvePrincipal(ctx);
  if (principal === undefined) return NO_CUSTOMER;

  const trackingNumber = readStringField(input, "ma_van_don");
  const items = trackingNumber === undefined ? readCartField(input) : undefined;
  const cod = trackingNumber === undefined ? readIntegerField(input, "cod") : undefined;
  if (trackingNumber === undefined && (items === undefined || cod === undefined)) {
    return INVALID_INPUT;
  }

  let result: CodCheckResult | null;
  try {
    result = await orders.codCheck({ ...principal, trackingNumber, items, cod, signal });
  } catch (err) {
    if (err instanceof AgentApiError) {
      // message chỉ có method/path/status/code — KHÔNG có token.
      console.error("[kiem_tra_gia_cod] API vận hành lỗi:", err.message);
      return LOOKUP_FAILED;
    }
    throw err;
  }

  if (result === null) {
    // 404 ở endpoint này = mã không tồn tại/đã xoá trên toàn hệ thống, nhưng câu nói ra ngoài vẫn
    // giữ chuẩn chung: không khẳng định "không tồn tại".
    return { content: orderNotFound(trackingNumber ?? ""), isError: true };
  }

  return { content: render(result, trackingNumber) };
}

/** `gio_hang` (mảng {sku, so_luong}) → map SKU → số lượng. Một dòng sai shape → loại CẢ giỏ. */
function readCartField(input: unknown): Readonly<Record<string, number>> | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)["gio_hang"];
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CART_LINES) {
    return undefined;
  }
  const counts: Record<string, number> = {};
  for (const entry of value) {
    const sku = readStringField(entry, "sku");
    const quantity = readIntegerField(entry, "so_luong");
    if (sku === undefined || quantity === undefined || quantity <= 0) return undefined;
    counts[sku] = (counts[sku] ?? 0) + quantity;
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render — dịch verdict thành chữ cho model, kèm ranh giới phát ngôn ngay tại chỗ.
// ─────────────────────────────────────────────────────────────────────────────

function render(result: CodCheckResult, trackingNumber: string | undefined): string {
  const source =
    trackingNumber !== undefined
      ? `đơn ${trackingNumber} (giỏ + COD lấy từ hệ thống)`
      : "giỏ tự nhập";
  const epoch =
    result.pricingEpoch === undefined ? "" : ` Bảng giá phiên bản ${result.pricingEpoch}.`;

  const lines: (string | undefined)[] = [
    `Kiểm tra giá COD — nguồn: ${source}.${epoch}`,
    line("Tiền hàng đối chiếu", vnd(result.cod)),
    driverCollectLine(result),
    line("Giỏ chuẩn hoá", formatSkuCounts(result.cart)),
    verdictLines(result),
    giftLines(result),
  ];
  return lines.filter((l) => l !== undefined).join("\n");
}

/** Số tài xế thu — chỉ in khi KHÁC tiền hàng (khác = COD đơn gộp phí ship), kèm nhãn chống đọc nhầm. */
function driverCollectLine(result: CodCheckResult): string | undefined {
  const collect = result.orderCodAmount;
  if (collect === undefined) return undefined;
  const money = formatMoney(collect);
  if (money === undefined || money === vnd(result.cod)) return undefined;
  return (
    `- Tài xế thu trên đơn: ${money} — KHÁC tiền hàng ở trên vì COD đơn này gộp phí ship. ` +
    "Nói về giá hàng thì dùng tiền hàng; nói về số khách đưa tài xế thì dùng số này."
  );
}

function verdictLines(result: CodCheckResult): string {
  const { verdict } = result;
  switch (verdict.status) {
    case "OPTIMAL":
      return [
        "Kết luận: COD ĐÚNG GIÁ — khớp giá tốt nhất giỏ này có thể đạt.",
        comboLine("Cách tính", verdict.via),
      ]
        .filter((l) => l !== undefined)
        .join("\n");
    case "VALID_COMBO":
      return [
        `Kết luận: COD hợp lệ nhưng THU DƯ ${vnd(verdict.overpay) ?? "một khoản"} so với giá tốt ` +
          `nhất ${vnd(verdict.optimal) ?? "(hệ thống không trả số)"}.`,
        comboLine("Cách ghép ra số COD hiện tại", verdict.via),
        comboLine("Cách ghép ra giá tốt nhất", verdict.optimalVia),
      ]
        .filter((l) => l !== undefined)
        .join("\n");
    case "INVALID":
      return invalidLines(result);
    case "UNREACHABLE":
      return (
        "Kết luận: giỏ này CHƯA CÓ bảng giá để đối chiếu (thường là SKU chưa vào bảng giá / hàng " +
        "thử nghiệm) — KHÔNG kết luận được đúng sai, và đây KHÔNG phải bằng chứng đơn sai giá. " +
        "Đừng nói đại lý sai; ghi nhận và chuyển vận hành nếu cần."
      );
    case "TOO_COMPLEX":
      return (
        "Kết luận: giỏ quá lớn, hệ thống bỏ tính — cần người kiểm tra tay. Ghi nhận và chuyển " +
        "vận hành, không tự phán đúng sai."
      );
    default:
      return `Kết luận: hệ thống trả trạng thái lạ "${verdict.status}" — không tự diễn giải, chuyển vận hành kiểm tra.`;
  }
}

function invalidLines(result: CodCheckResult): string {
  const { verdict } = result;
  const lines: (string | undefined)[] = [
    `Kết luận: COD ${vnd(result.cod)} KHÔNG khớp mức giá hợp lệ nào của giỏ này.`,
    line("Giá tốt nhất giỏ có thể đạt", vnd(verdict.optimal)),
    line(
      "Mức hợp lệ gần nhất",
      verdict.nearest === undefined || verdict.nearest.length === 0
        ? undefined
        : verdict.nearest.map((n) => vnd(n)).join(" hoặc "),
    ),
  ];
  if (verdict.validCount === 1) {
    lines.push("Giỏ này chỉ có ĐÚNG MỘT mức COD hợp lệ — nói chắc con số đúng được.");
  } else if (verdict.validCount !== undefined && verdict.validCount > 1) {
    lines.push(
      `Giỏ này có ${verdict.validCount} mức COD hợp lệ (nhiều cách ghép combo) — ` +
        'nêu mức gần nhất để tham khảo, ĐỪNG khẳng định "giá phải là X".',
    );
  }
  if (result.hypotheses !== undefined && result.hypotheses.length > 0) {
    lines.push("Hệ thống đoán nguyên nhân lệch (đọc NGUYÊN VĂN, không suy diễn thêm):");
    lines.push(...result.hypotheses.map((h) => `- ${h}`));
  } else {
    lines.push("Hệ thống không đoán được nguyên nhân lệch — đừng tự bịa lý do.");
  }
  return lines.filter((l) => l !== undefined).join("\n");
}

/**
 * Quà tặng chỉ nói được khi engine phân rã được giỏ (OPTIMAL/VALID_COMBO). Ở các status khác
 * `giftItems` rỗng nghĩa là KHÔNG BIẾT, không phải "không có quà" — im lặng thay vì in {}.
 */
function giftLines(result: CodCheckResult): string | undefined {
  const status = result.verdict.status;
  if (status !== "OPTIMAL" && status !== "VALID_COMBO") return undefined;
  const paid = formatSkuCounts(result.paidItems);
  const gifts = formatSkuCounts(result.giftItems);
  const parts: string[] = [];
  if (paid !== undefined) parts.push(`tính tiền: ${paid}`);
  parts.push(gifts === undefined ? "quà tặng: không có" : `quà tặng: ${gifts}`);
  return `- Phân rã giỏ — ${parts.join(" · ")}.`;
}

/** Cách ghép: tên chương trình + giá từng phần, kèm phần dư tính giá lẻ nếu có. */
function comboLine(label: string, via: CodCheckVia | undefined): string | undefined {
  if (via === undefined || via.parts.length === 0) return undefined;
  const parts = via.parts
    .map((part) => {
      const name = part.label ?? "chương trình không tên";
      const price = vnd(part.price);
      return price === undefined ? name : `${name} · ${price}`;
    })
    .join(" + ");
  const remainder =
    via.retailRemainderAmount !== undefined && via.retailRemainderAmount > 0
      ? ` + phần dư tính giá lẻ ${vnd(via.retailRemainderAmount)}`
      : "";
  return `- ${label}: ${parts}${remainder}`;
}

function formatSkuCounts(counts: Readonly<Record<string, number>> | undefined): string | undefined {
  if (counts === undefined) return undefined;
  const entries = Object.entries(counts);
  if (entries.length === 0) return undefined;
  return entries.map(([sku, qty]) => `${sku} ×${qty}`).join(", ");
}

/** VND nguyên từ engine (number) → chuỗi tiền Việt. */
function vnd(value: number | undefined): string | undefined {
  return value === undefined ? undefined : formatMoney(String(value));
}
