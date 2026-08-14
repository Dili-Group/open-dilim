// index.ts — điểm vào tầng llm. Bootstrap gọi buildLlmProvider() 1 lần, share cho worker.

export {
  buildLlmProvider,
  buildMemoryLlmProvider,
  buildCompactorLlmProvider,
  buildEmbedder,
  buildVisionReader,
} from "./registry.ts";
export { AnthropicProvider } from "./providers/anthropic.ts";
export { GeminiChat } from "./providers/gemini.ts";
export { GeminiEmbedder } from "./providers/gemini-embedder.ts";
export { GeminiVision } from "./providers/gemini-vision.ts";
export { LLMError, singleSystem } from "./types.ts";
export type {
  LLMProvider,
  ChatRequest,
  ChatResult,
  StopReason,
  LlmMessage,
  LlmSystemBlock,
  LlmContentBlock,
  LlmTextBlock,
  LlmToolUseBlock,
  LlmToolResultBlock,
  LlmToolSchema,
  LlmRole,
  Embedder,
  EmbedRequest,
  EmbedTaskType,
  VisionReader,
  VisionRequest,
} from "./types.ts";
