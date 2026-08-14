// registry.ts — chọn LLMProvider theo CONFIG.provider. Thêm provider = thêm case + 1 file.
// Gemini chưa xây → throw rõ ràng (seam), không im lặng trả sai provider.

import { CONFIG, type Config } from "../config.ts";
import type { Embedder, LLMProvider, VisionReader } from "./types.ts";
import { AnthropicProvider } from "./providers/anthropic.ts";
import { GeminiChat } from "./providers/gemini.ts";
import { GeminiEmbedder } from "./providers/gemini-embedder.ts";
import { GeminiVision } from "./providers/gemini-vision.ts";

export function buildLlmProvider(config: Config = CONFIG): LLMProvider {
  return buildProviderForModel(config, config.model);
}

/**
 * Provider cho con NHẸ (distill + rolling summary) — cùng provider agent, model = memoryModel.
 * AnthropicProvider cột model lúc construct → cần instance riêng, không dùng chung với agent.
 */
export function buildMemoryLlmProvider(config: Config = CONFIG): LLMProvider {
  return buildProviderForModel(config, config.memoryModel);
}

/**
 * Provider cho NÉN hội thoại ngắn hạn — LUÔN Gemini (config.compactModel), độc lập PROVIDER của
 * agent, cùng lý do với embedder/vision: việc nền tần suất cao, chạy con rẻ. GeminiChat text-only
 * là đủ — compactor không dùng tool.
 *
 * Thiếu GEMINI_API_KEY → rơi về con nhẹ theo PROVIDER (memoryModel) thay vì chặn boot, giữ đúng
 * hành vi cũ cho môi trường chưa có key.
 */
export function buildCompactorLlmProvider(config: Config = CONFIG): LLMProvider {
  if (config.geminiApiKey === undefined) {
    console.warn("[llm] thiếu GEMINI_API_KEY → nén hội thoại dùng memoryModel thay vì Gemini.");
    return buildMemoryLlmProvider(config);
  }
  return new GeminiChat(config.geminiApiKey, config.compactModel);
}

function buildProviderForModel(config: Config, model: string): LLMProvider {
  switch (config.provider) {
    case "anthropic": {
      // config.ts đã required() key khi provider=anthropic; check lại cho type hẹp.
      if (config.anthropicApiKey === undefined) {
        throw new Error("PROVIDER=anthropic nhưng thiếu ANTHROPIC_API_KEY");
      }
      return new AnthropicProvider(config.anthropicApiKey, model, config.anthropicBaseUrl);
    }
    case "gemini":
      throw new Error("Provider 'gemini' chưa được cài đặt (llm/providers/gemini.ts).");
  }
}

/**
 * Embedder cho memory dài hạn — LUÔN Gemini `gemini-embedding-001`, độc lập PROVIDER của agent
 * (agent chạy Anthropic vẫn embed bằng Gemini). Cần GEMINI_API_KEY.
 */
export function buildEmbedder(config: Config = CONFIG): Embedder {
  if (config.geminiApiKey === undefined) {
    throw new Error("Memory dài hạn cần GEMINI_API_KEY (embedder gemini-embedding-001).");
  }
  return new GeminiEmbedder(config.geminiApiKey);
}

/**
 * Con đọc ảnh — cũng LUÔN Gemini, độc lập PROVIDER của agent. Cần GEMINI_API_KEY; thiếu thì
 * bootstrap không dựng (tool `xem_anh` không được khai), chứ không chặn boot.
 */
export function buildVisionReader(config: Config = CONFIG): VisionReader {
  if (config.geminiApiKey === undefined) {
    throw new Error(`Đọc ảnh cần GEMINI_API_KEY (vision ${config.vision.model}).`);
  }
  return new GeminiVision(config.geminiApiKey, config.vision.model);
}
