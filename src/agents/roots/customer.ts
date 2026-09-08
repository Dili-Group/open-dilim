// customer.ts — root agent cho KHÁCH LẺ nhắn vào Official Account (kênh `zalo-oa`). Chỉ khai
// báo; luồng chạy lượt nằm ở agents/runtime/build-agent.ts.
//
// COMMON_TOOLS (whoami + skill/reference) + `ghi_nhan_khach`. KHÔNG khai ORDER_TOOLS hay bất cứ bộ
// nào ĐỌC dữ liệu đại lý: người nhắn vào OA chưa được xác thực là ai, nên không có phạm vi nào để
// chặn theo. `ghi_nhan_khach` đi ngược chiều — chỉ GHI số điện thoại rồi bàn giao sale, không đọc
// lại gì — nên vẫn an toàn cho người chưa định danh.

import { customerSupportSpec } from "../../state/specs.ts";
import { COMMON_TOOLS, CUSTOMER_LEAD_TOOLS } from "../../tools/index.ts";
import { CUSTOMER_PROMPT } from "../prompts.ts";
import { AgentType, type RootAgentProfile } from "../types.ts";

export const customerProfile: RootAgentProfile = {
  agentType: AgentType.Customer,
  // OA chat 1-1: không có phòng nào sở hữu fact → worker bỏ qua group MemoryScope.
  directOnly: true,
  prompt: CUSTOMER_PROMPT,
  memorySpec: customerSupportSpec,
  tools: [...COMMON_TOOLS, ...CUSTOMER_LEAD_TOOLS],
};
