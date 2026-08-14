// index.ts — dựng tool cho 1 request. Identity bind SERVER-SIDE ở đây (closure), rồi tool chỉ
// thấy tham số nghiệp vụ. Thêm tool = thêm file impl/ + 1 factory ở đây, rồi khai vào bộ tool
// của agent cần nó (agents/roots/*.ts) — KHÔNG phải tool nào cũng đi tới mọi agent.

import { ToolRegistry } from "./registry.ts";
import type { McpPort } from "../mcp/types.ts";
import type { Tool, ToolContext, ToolFactory } from "./types.ts";
import { buildMcpTool } from "./impl/mcp/remote.ts";
import { buildWhoamiTool } from "./impl/whoami.ts";
import { buildUseSkillTool } from "./impl/use-skill.ts";
import { buildUseReferenceTool } from "./impl/use-reference.ts";
import { buildOrderStatusTool } from "./impl/order/status.ts";
import { buildOrderPaymentTool } from "./impl/order/payment.ts";
import { buildCodCheckTool } from "./impl/order/cod-check.ts";
import { buildPaymentBatchCreateTool } from "./impl/order/payment-batch.ts";
import { buildValidatePaidOrdersTool } from "./impl/order/validate-paid.ts";
import { buildOrderVideoTool } from "./impl/order/video.ts";
import { buildDealerProfileTool } from "./impl/dealer/profile.ts";
import {
  buildDiscountTierListTool,
  buildDiscountTierUpgradeTool,
} from "./impl/dealer/discount.ts";
import { buildDailyDetailTool, buildDailyReportTool } from "./impl/dealer/daily.ts";
import {
  buildInternalInvoicedOrdersTool,
  buildInternalShippedOrdersTool,
  buildInternalUninvoicedOrdersTool,
} from "./impl/internal/daily-orders.ts";
import { buildValidateOrdersTool } from "./impl/internal/validate-orders.ts";
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
 * Cả bộ đều CHỈ ĐỌC. Huỷ/sửa đơn, xác nhận đã thanh toán là WRITE → chưa có tool nào, đi qua nhân
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
  // Đối chiếu COD với bảng giá (engine cod-check). POST nhưng CHỈ ĐỌC — không sửa giá, không
  // duyệt đơn. Cách đọc kết quả + ranh giới phát ngôn: skill `kiem-tra-gia-cod`.
  (ctx: ToolContext): Tool => buildCodCheckTool(ctx),
];

/**
 * Tool PHIẾU THANH TOÁN GỘP: GHI một phiếu gom nhiều đơn chưa thanh toán của đại lý phòng này,
 * trả QR SePay để chuyển một lần. Tách khỏi ORDER_TOOLS vì bộ đó CHỈ ĐỌC.
 *
 * Đường ghi này đại lý TỰ GÕ ĐƯỢC (như POSCAKE_TOOLS — ghi thứ của chính họ): phiếu chỉ gom đơn
 * CỦA đại lý phòng, dealerId ép server-side qua header; mã lạ/đơn đại lý khác → backend 404, phiếu
 * không tạo. Xác nhận ĐÃ thanh toán vẫn KHÔNG có đường nào — webhook SePay tự đối soát.
 */
export const PAYMENT_BATCH_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildPaymentBatchCreateTool(ctx),
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
 * Tool SỔ NỘI BỘ: đơn xuất kho trong ngày của TOÀN HỆ THỐNG, và hai lát cắt theo hoá đơn MISA
 * (đã tạo / chưa tạo). Ba tập khớp nhau: đã + chưa = xuất kho.
 *
 * Bộ DUY NHẤT đọc dữ liệu KHÔNG gắn đại lý nào — khai cho agent NỘI BỘ thôi. Hàng rào nằm trong
 * chính tool: cả ba từ chối nếu người gõ không phải nhân viên đã `/ketnoi-hethong` (staffId lấy
 * server-side từ identity, LLM không truyền vào được).
 *
 * Mốc ngày là NGÀY XUẤT KHO, cùng cửa sổ với file kỳ đối soát. CHỈ ĐỌC: không có đường tạo hoá đơn.
 */
export const INTERNAL_DAILY_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildInternalShippedOrdersTool(ctx),
  (ctx: ToolContext): Tool => buildInternalInvoicedOrdersTool(ctx),
  (ctx: ToolContext): Tool => buildInternalUninvoicedOrdersTool(ctx),
];

/**
 * Tool DUYỆT ĐƠN QUA KHO: GHI một lô mã vận đơn (1–200) vào `/agent/internal/orders/validate`
 * để đơn được đưa qua bước kho. Tách khỏi INTERNAL_DAILY_TOOLS vì bộ đó CHỈ ĐỌC.
 *
 * Hàng rào theo VAI: chỉ nhân viên gọi được (role từ identity server-side). `x-staff-id` chỉ là
 * audit tuỳ chọn — backend không đòi. Lệnh ghi KHÔNG retry — lỗi giữa chừng là trạng thái lửng,
 * tool báo đúng như vậy thay vì xúi gửi lại.
 */
export const INTERNAL_VALIDATE_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildValidateOrdersTool(ctx),
];

/**
 * Tool DUYỆT ĐƠN ĐÃ THANH TOÁN: đường GHI `validateOrders` mở cho NHÓM ĐẠI LÝ — đại lý gửi bill
 * chuyển khoản (hoặc đơn COD 0đ) kèm mã vận đơn thì agent duyệt lô đó qua bước kho tại chỗ.
 *
 * Khác INTERNAL_VALIDATE_TOOLS (hàng rào theo VAI nhân viên, mọi đơn): hàng rào ở đây theo PHẠM
 * VI — từng mã được tra qua cổng đọc đơn scoped đại lý chủ phòng (server-side) trước khi ghi,
 * mã của đại lý khác bị loại khỏi lô. Guest bị chặn. Điều kiện 0đ/bill nằm ở skill `duyet-don-0d`
 * (giai đoạn này chưa dựng gate đối chiếu số tiền).
 */
export const DEALER_VALIDATE_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildValidatePaidOrdersTool(ctx),
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
 * Bộ tool lấy từ SERVER MCP đã nối được — dựng theo tên server mà agent khai
 * (`RootAgentProfile.mcpServers`), không phải "nối được server nào thì agent nào cũng thấy".
 *
 * Danh sách tool chốt lúc boot (mcp/registry.ts) nên hàm này chỉ tra cache: không gọi mạng, không
 * đổi giữa hai lượt — thứ tự và nội dung phải ổn định thì prefix cache mới sống.
 *
 * Khác mọi bộ trên: tool MCP KHÔNG bind identity (không có act-as server-side), nên phạm vi của
 * nó rộng đúng bằng phạm vi của service token nằm trong config server đó. Chỉ khai cho agent thật
 * sự cần — xem tools/impl/mcp/remote.ts.
 */
export function mcpToolFactories(
  mcp: McpPort,
  servers: readonly string[],
): readonly ToolFactory[] {
  return servers.flatMap((server) =>
    mcp.tools(server).map((info): ToolFactory => (): Tool => buildMcpTool(mcp, info)),
  );
}

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
