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

/**
 * Một khối system prompt. Chia khối để đánh dấu ĐƯỜNG BIÊN ổn định/biến động cho prompt cache:
 * provider đặt breakpoint cache ngay sau khối cuối có `cache: true`, và phần trước đó (gồm cả
 * tool schema — chúng render TRƯỚC system) được tái dùng ở lượt sau thay vì trả tiền lại.
 *
 * Cache là PREFIX MATCH: lệch 1 byte ở phần trước breakpoint là hỏng cả cache. Vì vậy mọi thứ
 * đổi theo lượt (bản tóm, khối memory) phải nằm ở khối SAU breakpoint.
 */
export interface LlmSystemBlock {
  readonly text: string;
  /** Đặt breakpoint cache sau khối này. Bỏ trống = khối biến động, không cache. */
  readonly cache?: boolean;
}

/**
 * System prompt 1 khối, không cache — cho lượt phụ (định tuyến sub-agent, chưng cất, nén): prompt
 * ngắn, gọi thưa, không chạm ngưỡng tối thiểu để cache có lợi.
 */
export function singleSystem(text: string): readonly LlmSystemBlock[] {
  return [{ text }];
}

export interface ChatRequest {
  readonly system: readonly LlmSystemBlock[];
  readonly messages: readonly LlmMessage[];
  readonly tools: readonly LlmToolSchema[];
  readonly maxTokens: number;
  readonly effort: Effort;
}

/** Lý do model dừng. "other" gộp các giá trị không quan tâm ở loop tối thiểu. */
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";

/**
 * Token BỊ TÍNH TIỀN của MỘT lần gọi. Bốn loại tách rời vì đơn giá khác nhau tới 100 lần
 * (xem usage/pricing.ts) — gộp lại thành "tổng token" là mất luôn thông tin để tính tiền.
 *
 * Đây là số nhà cung cấp báo về, KHÔNG phải ước lượng: chỉ có nó mới khớp hoá đơn.
 */
export interface LlmUsage {
  /** Input KHÔNG trúng cache (cache miss). */
  readonly input: number;
  readonly output: number;
  /** Input đọc lại từ prompt cache (cache hit) — rẻ nhất. */
  readonly cacheRead: number;
  /** Input ghi vào prompt cache lần đầu. */
  readonly cacheWrite: number;
}

/** Usage rỗng — provider giả (test) hoặc nhánh không gọi model thật. */
export const EMPTY_USAGE: LlmUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export interface ChatResult {
  /** Block assistant sinh ra (text + tool_use). Dùng để append vào history + chạy tool. */
  readonly content: readonly LlmContentBlock[];
  readonly stopReason: StopReason;
  /** Bắt buộc: bỏ sót một lần gọi là hụt tiền âm thầm, không có cách nào phát hiện sau. */
  readonly usage: LlmUsage;
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

// ─────────────────────────────────────────────────────────────────────────────
// VisionReader — đọc MỘT ảnh, trả chữ. Tách khỏi LLMProvider giống Embedder: khác bản chất (một
// phát một, không hội thoại, không tool) và cố ý khác nhà — agent chạy Anthropic nhưng ảnh đi qua
// con Gemini rẻ, vì đọc ảnh là việc lặt vặt tần suất cao.
//
// Nhận BYTES chứ không nhận URL: tải file là việc có hàng rào riêng (allowlist host, trần dung
// lượng — xem vision/image-vision.ts), không phải việc của tầng gọi model.
// ─────────────────────────────────────────────────────────────────────────────

export interface VisionRequest {
  /** Ảnh đã tải về, base64 thuần (KHÔNG kèm tiền tố `data:`). */
  readonly imageBase64: string;
  /** MIME thật của ảnh (image/jpeg, image/png...). Sai MIME thì model đọc ra rác. */
  readonly mimeType: string;
  /** Hỏi gì về ảnh. Tầng trên luôn truyền — không có câu hỏi mặc định ở đây. */
  readonly question: string;
  readonly signal?: AbortSignal;
}

export interface VisionReader {
  readonly name: string;
  /** Trả chữ model đọc được. Rỗng = model không trả gì → tầng trên coi là lỗi nghiệp vụ. */
  describe(req: VisionRequest): Promise<string>;
}

/** Lỗi tầng LLM (chat/embed/vision). Mang provider + status để nơi gọi phân loại/log, không nuốt. */
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
