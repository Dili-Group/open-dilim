// default.ts — profile dự phòng của registry: channel chưa map agent nào thì lượt vẫn chạy được
// (design §4: type sai/thiếu → default agent), thay vì rơi vào lỗi. Giọng phục vụ, bộ tool chung.

import { customerSupportSpec } from "../../state/specs.ts";
import { COMMON_TOOLS } from "../../tools/index.ts";
import { SYSTEM_PROMPT } from "../prompts.ts";
import type { RootAgentProfile } from "../types.ts";

export const defaultProfile: RootAgentProfile = {
  agentType: "default",
  directOnly: false,
  prompt: SYSTEM_PROMPT,
  memorySpec: customerSupportSpec,
  tools: COMMON_TOOLS,
};
