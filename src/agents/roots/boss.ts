// boss.ts — root agent cho BAN LÃNH ĐẠO: hỏi để ra quyết định, không hỏi để thao tác. Chỉ khai
// báo; luồng chạy lượt nằm ở agents/runtime/build-agent.ts.

import { internalOpsSpec } from "../../state/specs.ts";
import { COMMON_TOOLS } from "../../tools/index.ts";
import { BOSS_PROMPT } from "../prompts.ts";
import { AgentType, type RootAgentProfile } from "../types.ts";

export const bossProfile: RootAgentProfile = {
  agentType: AgentType.Boss,
  // Sếp hỏi cả 1-1 lẫn trong nhóm điều hành → không giới hạn.
  directOnly: false,
  prompt: BOSS_PROMPT,
  memorySpec: internalOpsSpec,
  tools: COMMON_TOOLS,
};
