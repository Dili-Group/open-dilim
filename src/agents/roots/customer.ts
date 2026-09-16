// customer.ts — root agent cho KHÁCH LẺ nhắn vào Official Account (kênh `zalo-oa`). Chỉ khai
// báo; luồng chạy lượt nằm ở agents/runtime/build-agent.ts.
//
// COMMON_TOOLS (whoami + skill/reference) + `ghi_nhan_khach` + VISION_TOOLS. KHÔNG khai ORDER_TOOLS
// hay bất cứ bộ nào ĐỌC dữ liệu đại lý: người nhắn vào OA chưa được xác thực là ai, nên không có
// phạm vi nào để chặn theo. `ghi_nhan_khach` đi ngược chiều — chỉ GHI số điện thoại rồi bàn giao
// sale, không đọc lại gì — nên vẫn an toàn cho người chưa định danh.
//
// VISION_TOOLS vì khách lẻ CHỤP thay vì gõ nhiều hơn cả đại lý: ảnh hộp móp/chai rò khi báo sự cố,
// ảnh sản phẩm hỏi "cái này là gì", ảnh màn hình đặt hàng. `xem_anh` chỉ đọc link ảnh do CHÍNH
// webhook kênh cấp (cổng vision duyệt host trước khi tải) — không mở ra dữ liệu riêng của ai.

import { customerSupportSpec } from "../../state/specs.ts";
import { COMMON_TOOLS, CUSTOMER_LEAD_TOOLS, DOC_TOOLS, VISION_TOOLS } from "../../tools/index.ts";
import { CUSTOMER_PROMPT } from "../prompts.ts";
import { AgentType, type RootAgentProfile } from "../types.ts";

export const customerProfile: RootAgentProfile = {
  agentType: AgentType.Customer,
  // OA chat 1-1: không có phòng nào sở hữu fact → worker bỏ qua group MemoryScope.
  directOnly: true,
  prompt: CUSTOMER_PROMPT,
  memorySpec: customerSupportSpec,
  // DOC_TOOLS cùng lý do: khách gửi file đơn thuốc, phiếu xét nghiệm, hoá đơn dạng PDF.
  tools: [...COMMON_TOOLS, ...CUSTOMER_LEAD_TOOLS, ...VISION_TOOLS, ...DOC_TOOLS],
};
