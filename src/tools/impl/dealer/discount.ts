// discount.ts — hai tool bậc chiết khấu của đại lý phòng này:
//   `tra_bac_chiet_khau`  ĐỌC  — danh mục bậc + bậc đang áp + bậc nâng lên được.
//   `nang_bac_chiet_khau` GHI  — đẩy đại lý lên một bậc CAO HƠN. Đường ghi DUY NHẤT của agent.
//
// Ba hàng rào của đường ghi, xếp theo thứ tự chặt dần — hàng rào nằm ở CODE, không ở prompt:
//
//   1. Người gõ phải là NHÂN VIÊN. Đại lý tự gõ "cho em lên 45%" thì Identity của họ là `dai_ly`,
//      không mang `userId` → không có ai chịu trách nhiệm lệnh ghi → từ chối. Đây chính là bước
//      "xác nhận giữa dai_ly và nhan_vien": đại lý xin ở lượt trước, nhân viên gõ ở lượt này.
//   2. CHỈ NÂNG, không hạ. So `sortOrder` bậc đích với bậc đang áp; bằng hoặc thấp hơn → từ chối.
//   3. KHÔNG AI vào được bậc CỔ ĐÔNG. Đó là bậc cao nhất và là tư cách sở hữu, không phải mức
//      thưởng doanh số — đại lý lẫn nhân viên đều không nâng vào được, kể cả từ bậc thường cao
//      nhất. Kéo theo: đại lý đang là cổ đông thì mọi bậc thường đều là hạ bậc, cũng chặn.
//
// Đại lý đi lên header (`x-dealer-id`) từ chủ phòng, nhân viên đi lên `x-staff-id` từ identity —
// model KHÔNG có tham số nào chỉ định người, chỉ chọn được bậc và viết lý do.

import { ActorRole } from "../../../flash-command/types.ts";
import { AgentApiError } from "../../../operational/agent-api.ts";
import type {
  DealerProfile,
  DiscountPort,
  DiscountTier,
  OrderPrincipal,
  TierUpgradeResult,
} from "../../../operational/types.ts";
import { readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import { NO_CUSTOMER, cell, formatDate, line, resolvePrincipal, table } from "../order/scope.ts";

/** `discount_tiers.id` là bigint — model phải chép id từ `tra_bac_chiet_khau`, không tự nghĩ ra. */
const TIER_ID_PATTERN = /^\d+$/;
/** Backend đòi `reason` ≥ 5 ký tự. Chặn ở đây để không tốn một round-trip chỉ để nhận 400. */
const MIN_REASON_LENGTH = 5;
/** Lý do dài quá là model đang dán cả hội thoại vào lịch sử chiết khấu. Cắt ở mức người còn đọc được. */
const MAX_REASON_LENGTH = 500;

const NO_PORT: ToolResult = {
  content: "Hệ thống bậc chiết khấu chưa sẵn sàng — báo khách là em kiểm tra lại sau.",
  isError: true,
};

const LOOKUP_FAILED: ToolResult = {
  content:
    "Hệ thống vận hành đang không phản hồi nên chưa tra được bậc chiết khấu. Báo khách là em kiểm " +
    "tra lại và trả lời sau, KHÔNG kết luận gì về mức của đại lý.",
  isError: true,
};

/**
 * Bậc cổ đông là bậc cao nhất và là TƯ CÁCH SỞ HỮU, không phải mức thưởng doanh số. Không ai trong
 * nhóm chat nâng vào được — nói thẳng ở bảng để model đừng hứa với đại lý đã chạm mức cao nhất.
 */
const SHAREHOLDER_NOTE =
  "Bậc CỔ ĐÔNG là bậc cao nhất và KHÔNG nâng vào được qua đây — cả đại lý lẫn nhân viên đều không " +
  "có quyền, kể cả khi đại lý đã ở bậc cao nhất của thang thường. Ai hỏi thì chuyển hệ vận hành / " +
  "ban giám đốc, KHÔNG hứa.";

/** Nhắc kèm MỌI kết quả: model rất dễ dịch tên bậc thành một con số % rồi tuyên bố với đại lý. */
const RATE_NOTE =
  "Bậc KHÔNG phải phần trăm — tỉ lệ thật khác nhau theo từng sản phẩm. Không dịch tên bậc ra %, " +
  "không suy % từ giá đơn hàng. Khách hỏi con số % cụ thể → chuyển vận hành/kế toán.";

export function buildDiscountTierListTool(ctx: ToolContext): Tool {
  return {
    name: "tra_bac_chiet_khau",
    description:
      "Liệt kê các bậc chiết khấu hệ thống đang có, kèm thứ tự bậc, và chỉ ra bậc đại lý của " +
      "phòng này đang áp cùng những bậc nâng lên được. Dùng trước khi bàn chuyện nâng mức, và để " +
      "lấy id bậc cho nang_bac_chiet_khau. Không có tham số — luôn là đại lý của phòng này. CHỈ ĐỌC.",
    inputSchema: { type: "object", properties: {}, required: [] },
    announce: "Dạ để em xem bảng bậc chiết khấu ạ.",
    run: (_input: unknown, signal?: AbortSignal): Promise<ToolResult> => runList(ctx, signal),
  };
}

export function buildDiscountTierUpgradeTool(ctx: ToolContext): Tool {
  return {
    name: "nang_bac_chiet_khau",
    description:
      "GHI: nâng đại lý của phòng này lên một bậc chiết khấu CAO HƠN. CHỈ NHÂN VIÊN gõ mới chạy " +
      "được, và chỉ gọi SAU KHI đại lý đã nêu yêu cầu và nhân viên đã xác nhận đồng ý ngay trong " +
      "nhóm — không tự gọi thay nhân viên. Không hạ bậc, không đổi ngang bậc. Lấy `bac_id` từ " +
      "tra_bac_chiet_khau, `ly_do` ghi thẳng vào lịch sử chiết khấu nên phải nêu căn cứ thật.",
    inputSchema: {
      type: "object",
      properties: {
        bac_id: {
          type: "string",
          description: "id bậc muốn nâng lên, chép từ tra_bac_chiet_khau (chuỗi số).",
        },
        ly_do: {
          type: "string",
          description:
            "Căn cứ nâng bậc, tối thiểu 5 ký tự — vd 'Đạt doanh số quý 3', 'Hoàn tất khoá Vipassana'.",
        },
      },
      required: ["bac_id", "ly_do"],
    },
    announce: "Dạ em ghi nhận và đang cập nhật bậc chiết khấu ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> =>
      runUpgrade(ctx, input, signal),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Đọc danh mục
// ─────────────────────────────────────────────────────────────────────────────

async function runList(ctx: ToolContext, signal: AbortSignal | undefined): Promise<ToolResult> {
  const view = await loadView(ctx, signal);
  if ("error" in view) return view.error;

  const { tiers, current, scale } = view;
  // Sắp theo thang rồi tới thứ tự bậc: model đọc bảng đã sắp thì không phải tự suy bậc nào trên
  // bậc nào — mà nó suy sai thì đại lý nghe nhầm mức.
  const sorted = [...tiers].sort(compareTier);
  const rows = sorted.map((tier) => ({
    id: tier.id,
    bac: tier.tierName,
    nhan: cell(tier.displayLabel),
    thu_tu: tier.sortOrder,
    thang: tier.isShareholder ? "cổ đông (KHÔNG nâng vào được)" : "thường",
    hien_tai: tier.id === current?.id ? "x" : "",
  }));

  const upgradable = sorted.filter((tier) => checkUpgrade(tier, current, scale) === undefined);
  const lines = [
    table("bac_chiet_khau", rows),
    current === undefined
      ? "Đại lý CHƯA được xếp bậc nào trong hệ thống."
      : `- Bậc đang áp: ${describeTier(current)}`,
    `- Thang của đại lý: ${scale ? "cổ đông" : "thường"}`,
    upgradable.length === 0
      ? "Không còn bậc nào nâng lên được (đã ở bậc cao nhất nâng được)."
      : `- Nâng lên được: ${upgradable.map(describeTier).join(" · ")}`,
    SHAREHOLDER_NOTE,
    RATE_NOTE,
    "Muốn nâng: đại lý phải nêu yêu cầu, NHÂN VIÊN xác nhận trong nhóm, rồi mới gọi nang_bac_chiet_khau.",
  ];

  return { content: lines.join("\n") };
}

/** Thang thường trước, trong mỗi thang thì bậc thấp lên bậc cao. */
function compareTier(a: DiscountTier, b: DiscountTier): number {
  if (a.isShareholder !== b.isShareholder) return a.isShareholder ? 1 : -1;
  return a.sortOrder - b.sortOrder;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ghi — nâng bậc
// ─────────────────────────────────────────────────────────────────────────────

async function runUpgrade(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  // Hàng rào 1 TRƯỚC mọi thứ khác: người không có quyền ghi thì không cần biết bậc nào đang có.
  const identity = ctx.identity;
  if (identity.role !== ActorRole.NhanVien) {
    return {
      content:
        "Chỉ NHÂN VIÊN mới nâng được bậc chiết khấu, người đang gõ không phải nhân viên. Ghi nhận " +
        "yêu cầu của đại lý và báo là cần nhân viên phụ trách xác nhận trong nhóm này rồi mới cập " +
        "nhật được — KHÔNG nói là đã nâng.",
      isError: true,
    };
  }
  if (!TIER_ID_PATTERN.test(identity.userId)) {
    // Bind cũ / hệ vận hành trả userId lạ: gửi lên backend cũng bị loại ở buildAgentHeaders, mà
    // lúc đó lệnh ghi lại không có người chịu trách nhiệm.
    return {
      content:
        "Không xác định được id nhân viên đang gõ nên chưa ghi được lệnh nâng bậc. Báo nhân viên " +
        "kết nối lại bằng /ketnoi rồi thử lại.",
      isError: true,
    };
  }

  const tierId = readStringField(input, "bac_id");
  if (tierId === undefined || !TIER_ID_PATTERN.test(tierId)) {
    return {
      content:
        'Thiếu hoặc sai "bac_id". Gọi tra_bac_chiet_khau rồi chép đúng id (chuỗi số) của bậc muốn nâng.',
      isError: true,
    };
  }
  const reason = readStringField(input, "ly_do")?.trim();
  if (reason === undefined || reason.length < MIN_REASON_LENGTH) {
    return {
      content:
        `Thiếu "ly_do" hoặc quá ngắn (tối thiểu ${MIN_REASON_LENGTH} ký tự). Ghi căn cứ nâng bậc ` +
        "nhân viên vừa nêu — lý do này vào thẳng lịch sử chiết khấu.",
      isError: true,
    };
  }

  const view = await loadView(ctx, signal);
  if ("error" in view) return view.error;
  const { tiers, current, scale, principal, discount } = view;

  const target = tiers.find((tier) => tier.id === tierId);
  if (target === undefined) {
    return {
      content: `Không có bậc nào mang id ${tierId}. Gọi tra_bac_chiet_khau để lấy đúng id.`,
      isError: true,
    };
  }

  const refusal = checkUpgrade(target, current, scale);
  if (refusal !== undefined) return { content: refusal, isError: true };

  let result: TierUpgradeResult;
  try {
    result = await discount.upgrade({
      ...principal,
      tierId: target.id,
      reason: reason.slice(0, MAX_REASON_LENGTH),
      signal,
    });
  } catch (err) {
    if (err instanceof AgentApiError) {
      // message chỉ có method/path/status/code — KHÔNG có service token.
      console.error("[nang_bac_chiet_khau] API vận hành lỗi:", err.message);
      return {
        content:
          `Hệ vận hành từ chối hoặc không phản hồi lệnh nâng bậc (${err.code}). CHƯA CHẮC đã ghi ` +
          "được — báo nhân viên là em chưa cập nhật xong, cần kiểm tra lại trên hệ thống trước khi " +
          "gọi lại. KHÔNG nói với đại lý là đã nâng xong.",
        isError: true,
      };
    }
    throw err;
  }

  return { content: renderResult(result) };
}

/** undefined = nâng được. Chuỗi = lý do từ chối, viết sẵn cho model đọc lại cho người nghe. */
function checkUpgrade(
  target: DiscountTier,
  current: DiscountTier | undefined,
  scale: boolean,
): string | undefined {
  // Hàng rào TUYỆT ĐỐI, đứng trước mọi so sánh khác: bậc cổ đông là bậc cao nhất và KHÔNG phải
  // phần thưởng bán hàng — nó là tư cách sở hữu, do cấp trên hệ vận hành đặt. Không vai nào trong
  // nhóm chat (kể cả nhân viên) đẩy đại lý vào đây được, kể cả đại lý đang ở mức cao nhất.
  if (target.isShareholder) {
    return (
      `Bậc "${target.tierName}" là bậc CỔ ĐÔNG — bậc cao nhất, không ai nâng lên được qua đây, kể ` +
      "cả nhân viên và kể cả khi đại lý đang ở mức cao nhất của thang thường. Đây là tư cách cổ " +
      "đông, không phải mức thưởng doanh số. Chuyển yêu cầu lên hệ vận hành / ban giám đốc."
    );
  }
  // Tới đây bậc đích chắc chắn thuộc thang thường (nhánh trên đã chặn hết bậc cổ đông), nên lệch
  // thang chỉ còn đúng một ca: đại lý ĐANG là cổ đông. Cổ đông là bậc cao nhất → mọi bậc thường
  // đều là hạ bậc.
  if (scale) {
    return (
      `Đại lý này đang ở bậc CỔ ĐÔNG — bậc cao nhất. Bậc "${target.tierName}" thuộc thang thường ` +
      "nên đưa về đó là HẠ bậc, tool này không làm. Chuyển vận hành xử lý."
    );
  }
  if (current === undefined) return undefined;
  if (target.id === current.id) {
    return `Đại lý đang ở đúng bậc "${current.tierName}" rồi — không có gì để nâng. Nói đúng như vậy.`;
  }
  if (target.sortOrder <= current.sortOrder) {
    return (
      `Bậc "${target.tierName}" (thứ tự ${target.sortOrder}) KHÔNG cao hơn bậc đang áp ` +
      `"${current.tierName}" (thứ tự ${current.sortOrder}). Tool này chỉ nâng, không hạ bậc. ` +
      "Cần hạ bậc thì chuyển vận hành."
    );
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dữ kiện chung của cả hai tool: danh mục bậc + bậc đang áp + thang của đại lý
// ─────────────────────────────────────────────────────────────────────────────

interface TierView {
  readonly tiers: readonly DiscountTier[];
  /** undefined = đại lý chưa xếp bậc. */
  readonly current?: DiscountTier;
  /** true = đại lý đang NGỒI trên một bậc cổ đông. Chưa xếp bậc → false (thang thường). */
  readonly scale: boolean;
  readonly principal: OrderPrincipal;
  /** Chính cổng đã dùng để dựng view — mang theo để nơi gọi khỏi phải narrow `ctx.discount` lần nữa. */
  readonly discount: DiscountPort;
}

async function loadView(
  ctx: ToolContext,
  signal: AbortSignal | undefined,
): Promise<TierView | { error: ToolResult }> {
  const discount = ctx.discount;
  if (discount === undefined || ctx.dealer === undefined) return { error: NO_PORT };

  const principal = resolvePrincipal(ctx);
  if (principal === undefined) return { error: NO_CUSTOMER };

  let tiers: readonly DiscountTier[];
  let profile: DealerProfile | null;
  try {
    // Hai lời gọi độc lập — đi song song, đừng ăn hai lần round-trip trong ngân sách 20s/lượt.
    [tiers, profile] = await Promise.all([
      discount.tiers({ ...principal, signal }),
      ctx.dealer.profile({ ...principal, signal }),
    ]);
  } catch (err) {
    if (err instanceof AgentApiError) {
      console.error("[bac_chiet_khau] API vận hành lỗi:", err.message);
      return { error: LOOKUP_FAILED };
    }
    throw err;
  }

  if (tiers.length === 0) {
    return {
      error: {
        content:
          "Hệ thống không trả về bậc chiết khấu nào. Báo là em chưa lấy được bảng bậc, cần vận " +
          "hành kiểm tra — KHÔNG tự nêu tên bậc nào.",
        isError: true,
      },
    };
  }

  const currentId = profile?.discountTierId;
  const current = currentId === undefined ? undefined : tiers.find((tier) => tier.id === currentId);

  // Bậc đang áp không còn trong danh mục = không biết nó đứng thứ mấy → không đối chiếu nâng/hạ
  // được nữa. Chặn CẢ tool đọc: để nó in bảng bình thường là model kết luận "chưa có bậc" rồi coi
  // mọi bậc đều là nâng.
  if (currentId !== undefined && current === undefined) {
    return {
      error: {
        content:
          `Hồ sơ ghi đại lý đang ở bậc id ${currentId} nhưng bậc đó không còn trong danh mục hệ ` +
          "thống — không đối chiếu được nâng hay hạ. Chuyển vận hành kiểm tra bậc của đại lý, " +
          "KHÔNG tự chốt bậc nào.",
        isError: true,
      },
    };
  }

  // Thang lấy từ BẬC ĐANG NGỒI, không lấy cờ `is_shareholder` trên hồ sơ: cờ đó là tư cách sở hữu,
  // còn thang là chỗ đại lý đang đứng trên bảng giá. Đại lý có cờ cổ đông nhưng chưa xếp bậc vẫn
  // phải xếp được vào bậc thường — mà bậc cổ đông thì đã cấm tuyệt đối ở checkUpgrade rồi.
  const scale = current?.isShareholder ?? false;
  return { tiers, current, scale, principal, discount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────────

function describeTier(tier: DiscountTier): string {
  return tier.displayLabel === undefined
    ? `${tier.tierName} (id ${tier.id})`
    : `${tier.tierName} · ${tier.displayLabel} (id ${tier.id})`;
}

function renderResult(result: TierUpgradeResult): string {
  return [
    "ĐÃ CẬP NHẬT bậc chiết khấu.",
    line("Đại lý", result.dealerCode),
    line("Bậc cũ", result.fromTier === undefined ? "chưa xếp bậc" : result.fromTier.tierName),
    line("Bậc mới", describeTier(result.toTier)),
    line("Áp dụng từ", formatDate(result.effectiveFrom)),
    line("Lý do", result.reason),
    line("Người cập nhật", result.changedBy),
    line("Mã lịch áp dụng", result.scheduleId),
    RATE_NOTE,
    "Báo lại cho đại lý bằng TÊN BẬC và ngày áp dụng ở trên, không kèm con số phần trăm nào.",
  ]
    .filter((text): text is string => text !== undefined)
    .join("\n");
}
