// types.ts — hợp đồng LLM provider-agnostic. Agent loop CHỈ biết type ở đây, không biết
// Anthropic/Gemini (design §llm). Thêm provider = 1 file trong providers/ + 1 dòng register.

import type { Effort } from "../config.ts";

export type LlmRole = "user" | "assistant";

/** Block nội dung trung lập — map 1-1 sang content block của từng SDK ở lớp provider. */
export interface LlmTextBlock {
  readonly type: "text";
  readonly text: string;
}
export interface LlmToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}
export interface LlmToolResultBlock {
  readonly type: "tool_result";
  readonly toolUseId: string;
  readonly content: string;
  readonly isError?: boolean;
}
export type LlmContentBlock = LlmTextBlock | LlmToolUseBlock | LlmToolResultBlock;

export interface LlmMessage {
  readonly role: LlmRole;
  readonly content: readonly LlmContentBlock[];
}

/** Schema tool đưa cho model (JSON Schema object). Danh tính KHÔNG nằm ở đây (§tools). */
export interface LlmToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ChatRequest {
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  readonly tools: readonly LlmToolSchema[];
  readonly maxTokens: number;
  readonly effort: Effort;
}

/** Lý do model dừng. "other" gộp các giá trị không quan tâm ở loop tối thiểu. */
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface ChatResult {
  /** Block assistant sinh ra (text + tool_use). Dùng để append vào history + chạy tool. */
  readonly content: readonly LlmContentBlock[];
  readonly stopReason: StopReason;
}

/** Provider LLM. Loop chỉ gọi chat(); stream để sau. */
export interface LLMProvider {
  readonly name: string;
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedder — nhúng text → vector cho memory dài hạn (§7). Tách khỏi LLMProvider: khác bản chất
// (không sinh text), có thể khác nhà (chat=Anthropic, embed=Gemini). `dim` cố định theo model →
// memory core khớp cột pgvector. Swap self-host sau không sửa memory core.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ngữ cảnh dùng vector — retrieval chất lượng cao cần phân biệt bên lưu vs bên tra
 * (asymmetric embedding). `document` = fact đem lưu; `query` = câu hỏi đi tra.
 */
export type EmbedTaskType = "document" | "query";

export interface EmbedRequest {
  readonly texts: readonly string[];
  /** Mặc định "document". recall() truyền "query". */
  readonly taskType?: EmbedTaskType;
  readonly signal?: AbortSignal;
}

export interface Embedder {
  readonly name: string;
  /** Số chiều vector — memory core dựa vào để khớp cột pgvector(dim). */
  readonly dim: number;
  /** Trả vector theo ĐÚNG thứ tự `texts`; độ dài mảng ra = độ dài `texts`. */
  embed(req: EmbedRequest): Promise<number[][]>;
}

/** Lỗi tầng LLM (chat/embed). Mang provider + status để nơi gọi phân loại/log, không nuốt. */
export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    /** HTTP status; 0 = network/abort/timeout/parse. */
    readonly status: number,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
