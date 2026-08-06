// personal.ts — root agent trợ lý riêng, CHỈ chat 1-1. Chỉ khai báo; luồng chạy lượt nằm ở
// agents/runtime/build-agent.ts.

import { personalSpec } from "../../state/specs.ts";
import { COMMON_TOOLS } from "../../tools/index.ts";
import { PERSONAL_PROMPT } from "../prompts.ts";
import { AgentType, type RootAgentProfile } from "../types.ts";

export const personalProfile: RootAgentProfile = {
  agentType: AgentType.Personal,
  // 1-1: không có phòng nào sở hữu fact → worker bỏ qua group MemoryScope (xem worker/handler.ts).
  directOnly: true,
  prompt: PERSONAL_PROMPT,
  memorySpec: personalSpec,
  tools: COMMON_TOOLS,
};
