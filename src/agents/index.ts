// index.ts — điểm vào tầng agents. Bootstrap dựng AgentRegistry, worker resolve theo channel
// (resolveAgentType) rồi run. Bố cục thư mục: xem README.md cùng cấp.

// Định tuyến + tra cứu
export { buildAgentRegistry, AgentRegistry } from "./registry.ts";
export { resolveAgentType } from "./router.ts";

// Bộ máy chạy lượt (runtime/)
export { buildRootAgent } from "./runtime/build-agent.ts";
export { runAgentLoop } from "./runtime/loop.ts";
export { chooseSubAgent } from "./runtime/sub-router.ts";
export type { AgentLoopInput } from "./runtime/loop.ts";

// Hợp đồng + prompt
export { AgentType } from "./types.ts";
export type {
  RootAgent,
  RootAgentProfile,
  SubAgent,
  AgentRunInput,
  AgentConfig,
  AgentDeps,
} from "./types.ts";
export { SYSTEM_PROMPT } from "./prompts.ts";
