// index.ts — điểm vào tầng llm. Bootstrap gọi buildLlmProvider() 1 lần, share cho worker.

export { buildLlmProvider, buildMemoryLlmProvider, buildEmbedder } from "./registry.ts";
export { AnthropicProvider } from "./providers/anthropic.ts";
export { GeminiEmbedder } from "./providers/gemini-embedder.ts";
export { LLMError } from "./types.ts";
export type {
  LLMProvider,
  ChatRequest,
  ChatResult,
  StopReason,
  LlmMessage,
  LlmContentBlock,
  LlmTextBlock,
  LlmToolUseBlock,
  LlmToolResultBlock,
  LlmToolSchema,
  LlmRole,
  Embedder,
  EmbedRequest,
  EmbedTaskType,
} from "./types.ts";
