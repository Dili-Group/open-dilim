// index.ts — điểm vào tầng agents. Bootstrap dựng AgentRegistry, worker resolve+run.

export { buildAgentRegistry, AgentRegistry } from "./registry.ts";
export { runAgentLoop } from "./loop.ts";
export type { RootAgent, AgentRunInput, AgentConfig } from "./registry.ts";
export { SYSTEM_PROMPT } from "./prompts.ts";
export type { AgentLoopInput } from "./loop.ts";
