// operations.ts — root agent cho NHÂN VIÊN VẬN HÀNH Dili. Chỉ khai báo; luồng chạy lượt nằm ở
// agents/runtime/build-agent.ts. Thêm sub-agent (đơn hàng / kho / công nợ) = thêm phần tử `subAgents`.

import { internalOpsSpec } from "../../state/specs.ts";
import { COMMON_TOOLS } from "../../tools/index.ts";
import { OPERATIONS_PROMPT } from "../prompts.ts";
import { AgentType, type RootAgentProfile } from "../types.ts";

export const operationsProfile: RootAgentProfile = {
  agentType: AgentType.Operations,
  // Nhân viên làm việc cả trong nhóm khách lẫn nhóm nội bộ → phục vụ group.
  directOnly: false,
  prompt: OPERATIONS_PROMPT,
  memorySpec: internalOpsSpec,
  tools: COMMON_TOOLS,
};
