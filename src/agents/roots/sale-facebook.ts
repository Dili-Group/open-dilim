// sale-facebook.ts — root agent cho KHÁCH LẺ nhắn Facebook Page qua Messenger (kênh `meta`). Chỉ
// khai báo; luồng chạy lượt nằm ở agents/runtime/build-agent.ts.
//
// Cùng hàng rào với customer.ts: người nhắn chưa xác thực → KHÔNG khai ORDER_TOOLS hay bộ nào đọc
// dữ liệu đại lý. KHÔNG khai CUSTOMER_LEAD_TOOLS: `ghi_nhan_khach` gắn `zalo_user_id`, id người
// nhắn ở đây là PSID Messenger — gắn vào là ghi rác vào hồ sơ khách.
//
// RETAIL_PRICING_TOOLS (`tra_gia_le`) chỉ đọc giá lẻ theo giỏ — không danh tính, không rò gì.
//
// "Chốt đơn" ở kênh này KHÔNG có đường ghi: agent gom đủ thông tin trong chính hội thoại rồi dừng,
// nhân viên đọc hội thoại trên inbox Page và lên đơn. Luật gom ở skill `chot-don-facebook`.

import { customerSupportSpec } from "../../state/specs.ts";
import { COMMON_TOOLS, DOC_TOOLS, RETAIL_PRICING_TOOLS, VISION_TOOLS } from "../../tools/index.ts";
import { SALE_FACEBOOK_PROMPT } from "../prompts.ts";
import { AgentType, type RootAgentProfile } from "../types.ts";

export const saleFacebookProfile: RootAgentProfile = {
  agentType: AgentType.SaleFacebook,
  // Messenger chỉ có chat 1-1 với Page.
  directOnly: true,
  prompt: SALE_FACEBOOK_PROMPT,
  memorySpec: customerSupportSpec,
  // Khách chụp ảnh sản phẩm/hộp hàng và gửi file đơn thuốc như bên OA.
  tools: [...COMMON_TOOLS, ...RETAIL_PRICING_TOOLS, ...VISION_TOOLS, ...DOC_TOOLS],
};
