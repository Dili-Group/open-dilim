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
import {
  buildDiscountTierListTool,
  buildDiscountTierUpgradeTool,
} from "./impl/dealer/discount.ts";
import { buildDailyDetailTool, buildDailyReportTool } from "./impl/dealer/daily.ts";
import { buildPoscakeRegisterTool } from "./impl/dealer/poscake.ts";
import { buildImageReadTool } from "./impl/vision/xem-anh.ts";
import { buildWorkflowOpenTool } from "./impl/workflow/open.ts";
import { buildWorkflowAnswerTool } from "./impl/workflow/answer.ts";
import { buildWorkflowListTool } from "./impl/workflow/list.ts";
import {
  buildNoticeDraftTool,
  buildNoticeSendTool,
  buildNoticeStatusTool,
} from "./impl/announce/notice.ts";
import { HET_HANG_FLOW, VAN_HANH_FLOW } from "./impl/announce/flows.ts";

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
 * CHỈ ĐỌC. Đường GHI bậc chiết khấu tách hẳn sang DEALER_TIER_TOOLS.
 */
export const DEALER_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildDealerProfileTool(ctx),
];

/**
 * Tool BẬC CHIẾT KHẤU: đọc danh mục bậc, và GHI lệnh nâng bậc cho đại lý của phòng.
 *
 * Bộ DUY NHẤT có đường ghi dữ liệu nghiệp vụ. Hàng rào không nằm ở chỗ khai bộ tool này cho agent
 * nào, mà nằm trong chính tool: `nang_bac_chiet_khau` từ chối nếu người gõ không phải NHÂN VIÊN,
 * và từ chối mọi bậc không cao hơn bậc đang áp. Khai cho agent đại lý là cố ý — đại lý xin ở lượt
 * trước, nhân viên gõ xác nhận ở lượt sau, cả hai diễn ra trong CÙNG nhóm chat đó (skill `chiet-khau`).
 */
export const DEALER_TIER_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildDiscountTierListTool(ctx),
  (ctx: ToolContext): Tool => buildDiscountTierUpgradeTool(ctx),
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
 * Tool NẠP TÀI KHOẢN POSCAKE: ghi Shop ID + API Key PosCake của đại lý phòng này vào hệ vận hành
 * (đơn PosCake tự chảy về DILIM). Đi kèm skill `huong-dan` — đại lý làm theo reference `poscake.md`
 * để lấy hai thứ đó, rồi gửi ngay trong nhóm thay vì nhắn riêng đầu mối.
 *
 * Bộ DUY NHẤT nhận credential của đại lý làm tham số. Hàng rào nằm trong tool: guest không gọi
 * được, key không bao giờ được in lại/log lại, và tool KHÔNG dán webhook URL hộ (link đó vận hành
 * cấp riêng từng đại lý).
 */
export const POSCAKE_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildPoscakeRegisterTool(ctx),
];

/**
 * Tool ĐỌC ẢNH đính kèm. Khai cho agent nào có người gửi ảnh vào (đại lý gửi phiếu chuyển khoản,
 * ảnh màn hình lỗi PosCake) — không phải agent nào cũng nhận ảnh.
 *
 * Không có đường ghi, nhưng là tool DUY NHẤT gọi ra ngoài theo link do người dùng đưa → hàng rào
 * (allowlist host CDN, trần dung lượng, chặn redirect) nằm trong cổng `vision`, không ở tool.
 */
export const VISION_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildImageReadTool(ctx),
];

/**
 * Tool VIỆC TREO (§6) — hỏi bên liên quan rồi chờ họ trả lời (giây → giờ → NGÀY).
 *
 * Chia làm hai đầu, agent nào khai đầu nào là tuỳ vai của nó:
 *   - `mo_viec_cho`  : bên ĐI HỎI (vd agent kho nhận mã đơn hoàn `*DH`).
 *   - `tra_loi_viec` : bên ĐƯỢC HỎI (vd agent đại lý, khi đại lý đọc mã đơn gốc).
 *   - `viec_dang_cho`: soát việc còn treo — CẢ HAI đầu đều dùng được, nên tách bộ riêng
 *                      (ToolRegistry throw nếu một agent khai trùng tên tool hai lần).
 *
 * Nghiệp vụ cụ thể KHÔNG nằm ở tool: `ma_viec` chọn WorkflowDef (workflows/defs/). Thêm nghiệp vụ
 * là thêm một def, ba tool này tự phục vụ được ngay.
 */
export const WORKFLOW_ASK_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildWorkflowOpenTool(ctx),
];

export const WORKFLOW_REPLY_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildWorkflowAnswerTool(ctx),
];

export const WORKFLOW_LIST_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildWorkflowListTool(ctx),
];

/**
 * Tool PHÁT TIN HẾT HÀNG tới mọi nhóm đại lý — bán kính ảnh hưởng lớn nhất trong cả bộ tool.
 *
 * Hàng rào KHÔNG nằm ở chỗ khai bộ này cho agent nào, mà nằm trong chính tool: cả ba từ chối nếu
 * người gõ không phải nhân viên có `role_slug = warehouse` (quản lý kho). Chốt gửi còn phải qua
 * hai bước — soạn nháp, người thật duyệt, rồi mới xếp hàng (nguyên tắc 7).
 *
 * Gửi thật do poller (`announcements/poller.ts`) làm ngầm, KHÔNG qua LLM: mọi đại lý phải đọc
 * đúng một câu. `soat_thong_bao` là đường để quản lý kho biết đợt phát đã tới đâu.
 */
export const WAREHOUSE_ANNOUNCE_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildNoticeDraftTool(ctx, HET_HANG_FLOW),
  (ctx: ToolContext): Tool => buildNoticeSendTool(ctx, HET_HANG_FLOW),
  (ctx: ToolContext): Tool => buildNoticeStatusTool(ctx, HET_HANG_FLOW),
];

/**
 * Tool PHÁT TIN CHUNG của VẬN HÀNH — cùng hạ tầng, cùng người kiểm duyệt như bộ trên, khác ở CỬA
 * QUYỀN: soạn thì mọi nhân viên vận hành đều được, CHỐT thì chỉ `role_slug ∈ {ceo, swe}`.
 *
 * Hai quyền tách rời nhưng KHÔNG bắc cầu cho nhau: nháp chỉ chính người soạn mới chốt được
 * (announcements/service.ts), nên nháp của nhân viên thường là bản đọc thử — muốn phát thật thì
 * CEO/swe tự soạn bản của mình rồi chốt. Cố tình giữ vậy: chốt hộ nháp người khác là đúng cái
 * cửa mà một câu lái trong nhóm sẽ đi qua.
 */
export const OPS_ANNOUNCE_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildNoticeDraftTool(ctx, VAN_HANH_FLOW),
  (ctx: ToolContext): Tool => buildNoticeSendTool(ctx, VAN_HANH_FLOW),
  (ctx: ToolContext): Tool => buildNoticeStatusTool(ctx, VAN_HANH_FLOW),
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
