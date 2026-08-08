// profile.ts — tool ĐỌC hồ sơ đại lý của phòng này: bậc chiết khấu, biên chiết khấu thực tế,
// người giới thiệu, nhân viên phụ trách.
//
// KHÔNG có tham số: đại lý đến từ closure/ctx (resolvePrincipal), không phải từ input LLM sinh —
// model không được quyền hỏi hồ sơ đại lý khác.
//
// CHỈ ĐỌC. Đường GHI bậc chiết khấu nằm ở discount.ts (`nang_bac_chiet_khau`), tool khác — port
// khác — và chỉ mở cho nhân viên.

import { AgentApiError } from "../../../operational/agent-api.ts";
import type { DealerProfile } from "../../../operational/types.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import { NO_CUSTOMER, formatDate, line, resolvePrincipal } from "../order/scope.ts";

/** Cổng chưa nối — nói rõ là hệ thống chưa sẵn sàng, KHÔNG để model diễn dịch thành "chưa có bậc". */
const NO_PORT: ToolResult = {
  content: "Hệ thống hồ sơ đại lý chưa sẵn sàng — báo khách là em kiểm tra lại sau.",
  isError: true,
};

const LOOKUP_FAILED: ToolResult = {
  content:
    "Hệ thống vận hành đang không phản hồi nên chưa tra được hồ sơ. Báo khách là em kiểm tra lại " +
    "và trả lời sau, KHÔNG nói là đại lý chưa có bậc chiết khấu.",
  isError: true,
};

const NO_PROFILE: ToolResult = {
  content:
    "Hệ thống không có hồ sơ cho đại lý này. Báo khách là em cần bên vận hành kiểm tra lại hồ sơ, " +
    "KHÔNG kết luận gì về mức chiết khấu.",
  isError: true,
};

/**
 * Hai câu BẮT BUỘC kèm mọi kết quả có bậc: model rất dễ dịch tên bậc thành một con số % rồi tuyên
 * bố "chị đang ở X%", và rất dễ hứa nâng bậc.
 */
const RATE_NOTE =
  "Hồ sơ chỉ có TÊN BẬC, không có con số phần trăm — tỉ lệ thật khác nhau theo từng sản phẩm. " +
  "Không dịch tên bậc ra %, không suy % từ giá đơn hàng. Khách hỏi mức % cụ thể → chuyển vận hành/kế toán.";
const WRITE_NOTE =
  "Tool CHỈ ĐỌC: không nâng, không đổi bậc ở đây. Nâng bậc đi qua nang_bac_chiet_khau và CHỈ khi " +
  "nhân viên gõ xác nhận (skill chiet-khau).";
/** Bậc null là trạng thái thật, không phải lỗi — nói đúng để model không đoán một bậc. */
const NO_TIER_NOTE =
  "Đại lý CHƯA được xếp bậc chiết khấu nào trong hệ thống. Không suy ra mức % từ giá đơn hàng — " +
  "chuyển bên vận hành/kế toán xác nhận bậc.";

export function buildDealerProfileTool(ctx: ToolContext): Tool {
  return {
    name: "tra_ho_so_dai_ly",
    description:
      "Tra hồ sơ đại lý của cuộc trò chuyện này: mã và tên đại lý, bậc chiết khấu đang áp cùng " +
      "biên chiết khấu thực tế (min–max), ngày hiệu lực bậc, ngày tham gia, người giới thiệu, " +
      "nhân viên phụ trách. Dùng khi khách hỏi 'em đang mức mấy %', 'bậc của em là gì', 'ai phụ " +
      "trách em'. Không có tham số — luôn là đại lý của phòng này. CHỈ ĐỌC, không nâng bậc.",
    inputSchema: { type: "object", properties: {}, required: [] },
    announce: "Dạ để em xem hồ sơ đại lý mình ạ.",
    run: (_input: unknown, signal?: AbortSignal): Promise<ToolResult> => runLookup(ctx, signal),
  };
}

async function runLookup(ctx: ToolContext, signal: AbortSignal | undefined): Promise<ToolResult> {
  const dealer = ctx.dealer;
  if (dealer === undefined) return NO_PORT;

  const principal = resolvePrincipal(ctx);
  if (principal === undefined) return NO_CUSTOMER;

  let profile: DealerProfile | null;
  try {
    profile = await dealer.profile({ ...principal, signal });
  } catch (err) {
    if (err instanceof AgentApiError) {
      // message chỉ có method/path/status/code — KHÔNG có service token.
      console.error("[tra_ho_so_dai_ly] API vận hành lỗi:", err.message);
      return LOOKUP_FAILED;
    }
    throw err;
  }

  if (profile === null) return NO_PROFILE;
  return { content: render(profile) };
}

function render(profile: DealerProfile): string {
  const heading = joinParts(profile.code, profile.name);
  const lines = [
    `Hồ sơ đại lý${heading === undefined ? "" : ` ${heading}`}`,
    line("Bậc chiết khấu", joinParts(profile.discountTierName, profile.discountTierLabel)),
    line("Bậc áp dụng từ", formatDate(profile.discountEffectiveFrom)),
    line("Tham gia từ", formatDate(profile.joinedAt)),
    line("Cấp giới thiệu", profile.referralLevel === undefined ? undefined : String(profile.referralLevel)),
    line("Cổ đông", formatFlag(profile.isShareholder)),
    line("Dùng thương hiệu công ty", formatFlag(profile.usesBrand)),
    line("Người giới thiệu", joinParts(profile.referrerCode, profile.referrerName)),
    line("Nhân viên phụ trách", joinParts(profile.staffName, profile.staffPhone)),
    line("Điện thoại", profile.phone),
    // Email = email đăng nhập app: đại lý quên mật khẩu cần nhập đúng ô này (skill huong-dan, reference mat-khau.md).
    line("Email", profile.email),
    line("Khu vực", joinParts(profile.ward, profile.district, profile.province)),
  ].filter(isPresent);

  // Không tên bậc lẫn nhãn bậc = chưa xếp bậc (backend trả discount_* null cả cụm).
  const hasTier =
    profile.discountTierName !== undefined || profile.discountTierLabel !== undefined;
  lines.push(hasTier ? RATE_NOTE : NO_TIER_NOTE, WRITE_NOTE);
  return lines.join("\n");
}

function formatFlag(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? "có" : "không";
}

function joinParts(...parts: readonly (string | undefined)[]): string | undefined {
  const kept = parts.filter(isPresent);
  return kept.length === 0 ? undefined : kept.join(" · ");
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined;
}
