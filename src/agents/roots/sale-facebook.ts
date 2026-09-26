// sale-facebook.ts — root agent cho KHÁCH LẺ nhắn Facebook Page qua Messenger (kênh `meta`). Chỉ
// khai báo; luồng chạy lượt nằm ở agents/runtime/build-agent.ts.
//
// Cùng hàng rào với customer.ts: người nhắn chưa xác thực → KHÔNG khai ORDER_TOOLS hay bộ nào đọc
// dữ liệu đại lý. KHÔNG khai CUSTOMER_LEAD_TOOLS: `ghi_nhan_khach` gắn `zalo_user_id`, id người
// nhắn ở đây là PSID Messenger — gắn vào là ghi rác vào hồ sơ khách.
//
// Agent chỉ hiểu vấn đề và xin số điện thoại; người thật gọi lại tư vấn, báo giá, chốt đơn. Vì vậy
// KHÔNG khai RETAIL_PRICING_TOOLS: có tool báo giá trong tay thì model sẽ tìm cách dùng nó. Số điện
// thoại không có đường ghi — nằm trong hội thoại, nhân viên đọc trên inbox Page.

import { customerSupportSpec } from "../../state/specs.ts";
import { COMMON_TOOLS, DOC_TOOLS, VISION_TOOLS } from "../../tools/index.ts";
import { SALE_FACEBOOK_PROMPT } from "../prompts.ts";
import { AgentType, type RootAgentProfile } from "../types.ts";

export const saleFacebookProfile: RootAgentProfile = {
  agentType: AgentType.SaleFacebook,
  // Messenger chỉ có chat 1-1 với Page.
  directOnly: true,
  prompt: SALE_FACEBOOK_PROMPT,
  memorySpec: customerSupportSpec,
  // Khách chụp ảnh sản phẩm/hộp hàng và gửi file đơn thuốc như bên OA.
  tools: [...COMMON_TOOLS, ...VISION_TOOLS, ...DOC_TOOLS],
};
