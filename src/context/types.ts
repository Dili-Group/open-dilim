// types.ts — hợp đồng tầng context: SỞ HỮU "model thấy gì trong 1 lượt".
//
// Trước module này, việc lắp ngữ cảnh nằm rải rác: prompt là hằng số trần trong agents/prompts.ts,
// catalog skill dựng ở bootstrap rồi không đi tới agent, memory recall không ai gọi, history map
// inline trong loop. Không nơi nào trả lời được "model đang thấy gì" → đây là nơi đó.
//
// context/ CHỈ import module lá (skills/selector, state/types, llm/types, types/) — KHÔNG import
// barrel index.ts của tầng khác (kéo theo db/client → config.ts fail-fast env, test hết chạy).

import type { LlmMessage, LlmSystemBlock } from "../llm/types.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import type { MemoryRecall, MemoryScope } from "../state/types.ts";
import type { HistoryEntry } from "../types/index.ts";

/** Nguồn dựng context — app-scoped, dựng 1 lần ở bootstrap. context/ KHÔNG tự mở kết nối. */
export interface ContextSources {
  /** Prompt nền của agent — luôn đứng đầu system (phần ổn định nhất). */
  readonly basePrompt: string;
  /** Catalog skill = tầng 1 progressive disclosure (chỉ name + description). */
  readonly skills: SkillRegistry;
  /** Cổng CHỈ-ĐỌC: lắp ngữ cảnh không bao giờ ghi memory. undefined = chưa nối (chờ chốt scope). */
  readonly memory?: MemoryRecall;
}

/** Dữ liệu của ĐÚNG một lượt. */
export interface TurnInput {
  readonly history: readonly HistoryEntry[];
  /**
   * Bản tóm phần hội thoại đã trôi khỏi cửa sổ `history` (state/compactor.ts). undefined = phòng
   * chưa đủ dài để nén, hoặc chưa nối tầng compact — không phải lỗi.
   */
  readonly summary?: string;
  /**
   * Phân vùng (ownerKind, ownerId, channel, conversationId) do WIRING cấp — context/ KHÔNG derive từ
   * Identity (memory thuộc PHÒNG, người gõ có thể là nhân viên không mang customerId). Derive
   * sai = rò memory sang khách khác. undefined = bỏ qua recall dài hạn.
   */
  readonly memoryScope?: MemoryScope;
  readonly signal?: AbortSignal;
}

/** Đúng 2 thứ model thấy trong 1 lượt. */
export interface TurnContext {
  /** Khối ổn định (mang breakpoint cache) trước, khối biến động sau. Xem `LlmSystemBlock`. */
  readonly system: readonly LlmSystemBlock[];
  readonly messages: readonly LlmMessage[];
}
