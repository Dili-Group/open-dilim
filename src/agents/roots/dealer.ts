// dealer.ts — root agent cho ĐẠI LÝ (kế toán đại lý) trong nhóm chat của đại lý đó. Chỉ khai
// báo; luồng chạy lượt nằm ở agents/runtime/build-agent.ts.

import { customerSupportSpec } from "../../state/specs.ts";
import { COMMON_TOOLS, DEALER_TOOLS, ORDER_TOOLS } from "../../tools/index.ts";
import { DEALER_PROMPT } from "../prompts.ts";
import { AgentType, type RootAgentProfile } from "../types.ts";

export const dealerProfile: RootAgentProfile = {
  agentType: AgentType.Dealer,
  // Đại lý làm việc trong NHÓM của họ → cần group scope để đọc/ghi trí nhớ của phòng.
  directOnly: false,
  prompt: DEALER_PROMPT,
  memorySpec: customerSupportSpec,
  tools: [...COMMON_TOOLS, ...ORDER_TOOLS, ...DEALER_TOOLS],
};
