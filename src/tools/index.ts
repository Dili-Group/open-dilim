// index.ts — dựng tool cho 1 request. Identity bind SERVER-SIDE ở đây (closure), rồi tool chỉ
// thấy tham số nghiệp vụ. Thêm tool = thêm file impl/ + 1 factory ở đây, rồi khai vào bộ tool
// của agent cần nó (agents/roots/*.ts) — KHÔNG phải tool nào cũng đi tới mọi agent.

import { ToolRegistry } from "./registry.ts";
import type { Tool, ToolContext, ToolFactory } from "./types.ts";
import { buildWhoamiTool } from "./impl/whoami.ts";
import { buildUseSkillTool } from "./impl/use-skill.ts";
import { buildUseReferenceTool } from "./impl/use-reference.ts";
import { buildOrderStatusTool } from "./impl/order/status.ts";
import { buildOrderPaymentTool } from "./impl/order/payment.ts";
import { buildOrderVideoTool } from "./impl/order/video.ts";
import { buildDealerProfileTool } from "./impl/dealer/profile.ts";
import { buildDailyDetailTool, buildDailyReportTool } from "./impl/dealer/daily.ts";

/** Bộ tool ai cũng có: biết mình là ai + đọc skill/reference. Không chạm dữ liệu nghiệp vụ. */
export const COMMON_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildWhoamiTool(ctx.identity),
  (ctx: ToolContext): Tool => buildUseSkillTool(ctx.skills, ctx.agentType),
  (ctx: ToolContext): Tool => buildUseReferenceTool(ctx.skills, ctx.agentType),
];

/**
 * Tool đọc dữ liệu đơn hàng — CHỈ agent phục vụ đại lý được khai (tool tự chặn phạm vi theo đại
 * lý chủ phòng, nhưng agent không phục vụ đại lý thì cũng không có việc gì gọi nó).
 *
 * Cả ba đều CHỈ ĐỌC. Huỷ/sửa đơn, xác nhận đã thanh toán là WRITE → chưa có tool nào, đi qua nhân
 * viên vận hành cho tới khi dựng xong approval gate (§6) — xem skill `don-hang`.
 *
 * HAI loại tiền, hai tool: tiền của đơn theo giá bán + COD khách trả nằm trong `tra_don_hang`; tiền
 * ĐẠI LÝ chuyển cho công ty để đơn được đi nằm ở `tra_tien_can_chuyen` (endpoint riêng, giá theo bậc
 * chiết khấu). Không tool nào tự ghép số của tool kia.
 */
export const ORDER_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildOrderStatusTool(ctx),
  (ctx: ToolContext): Tool => buildOrderPaymentTool(ctx),
  (ctx: ToolContext): Tool => buildOrderVideoTool(ctx),
];

/**
 * Tool đọc HỒ SƠ đại lý (bậc chiết khấu, người giới thiệu, nhân viên phụ trách) — cùng phạm vi
 * như ORDER_TOOLS: đại lý của phòng, do server ép qua header, không nhận tham số đại lý.
 *
 * CHỈ ĐỌC. Nâng bậc chiết khấu là WRITE → chưa có tool, đi qua người duyệt — xem skill `chiet-khau`.
 */
export const DEALER_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildDealerProfileTool(ctx),
];

/**
 * Tool SỔ NGÀY: chốt sổ một ngày của đại lý (xuất kho, hoàn về, tiền phải chuyển, tiền được trả
 * lại) và liệt kê từng đơn của một mục. Cùng phạm vi đại lý như ORDER_TOOLS.
 *
 * Số ở đây tính theo NGÀY XUẤT/HOÀN KHO, không phải ngày tạo đơn, và khớp file kỳ đối soát — đây
 * là nguồn duy nhất cho skill `bao-cao-cuoi-ngay`. CHỈ ĐỌC: không có đường xác nhận đã chuyển tiền.
 */
export const DAILY_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildDailyReportTool(ctx),
  (ctx: ToolContext): Tool => buildDailyDetailTool(ctx),
];

/**
 * Dựng registry tool cho request hiện tại từ bộ factory của agent. Factory chạy Ở ĐÂY (không ở
 * bootstrap) vì tool closure identity — dùng lại instance giữa hai người gõ là act-as nhầm người.
 */
export function buildToolRegistry(
  factories: readonly ToolFactory[],
  ctx: ToolContext,
): ToolRegistry {
  return new ToolRegistry(factories.map((build) => build(ctx)));
}

export { ToolRegistry } from "./registry.ts";
export { runToolCall } from "./runner.ts";
export { readStringField } from "./input.ts";
export type { Tool, ToolResult, ToolContext, ToolFactory } from "./types.ts";
