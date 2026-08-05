// index.ts — điểm vào tầng agents. Bootstrap dựng AgentRegistry, worker resolve+run.

export { buildAgentRegistry, AgentRegistry } from "./registry.ts";
export { buildDefaultAgent } from "./roots/default.ts";
export { runAgentLoop } from "./loop.ts";
export type { RootAgent, AgentRunInput, AgentConfig, AgentDeps } from "./types.ts";
export { SYSTEM_PROMPT } from "./prompts.ts";
export type { AgentLoopInput } from "./loop.ts";
