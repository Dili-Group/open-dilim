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
import type { PendingNotice } from "./pending-block.ts";
import type { TurnSpeaker } from "./speaker-block.ts";

/** Nguồn dựng context — app-scoped, dựng 1 lần ở bootstrap. context/ KHÔNG tự mở kết nối. */
export interface ContextSources {
  /** Prompt nền của agent — luôn đứng đầu system (phần ổn định nhất). */
  readonly basePrompt: string;
  /** Catalog skill = tầng 1 progressive disclosure (chỉ name + description). */
  readonly skills: SkillRegistry;
  /** Root agent đang chạy — catalog CHỈ liệt kê skill khai cho agent này. undefined = không lọc. */
  readonly agentType?: string;
  /** Cổng CHỈ-ĐỌC: lắp ngữ cảnh không bao giờ ghi memory. undefined = chưa nối (chờ chốt scope). */
  readonly memory?: MemoryRecall;
}

/** Dữ liệu của ĐÚNG một lượt. */
export interface TurnInput {
  readonly history: readonly HistoryEntry[];
  /**
   * Vai người gõ lượt này — do WIRING map từ Identity (context/ không tự resolve). undefined = chưa
   * biết vai → không in khối nào, model coi như phòng vô danh.
   */
  readonly speaker?: TurnSpeaker;
  /**
   * senderId → vai/tên, cho MỌI người xuất hiện trong `history` (không chỉ người gõ lượt này).
   * Prefix từng tin lấy vai ở đây. Do WIRING resolve (context/ không được biết `Identity`).
   * Thiếu key nào → tin của người đó in vai `?`, không phải lỗi: người lạ vẫn nhắn được vào nhóm.
   */
  readonly speakers?: ReadonlyMap<string, TurnSpeaker>;
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
  /**
   * Việc nhóm này đang được hỏi mà chưa trả lời (§6). Do WIRING cấp — context/ không tự tra.
   * Rỗng/undefined = không có việc treo → không in khối nào.
   */
  readonly pending?: readonly PendingNotice[];
  readonly signal?: AbortSignal;
}

/** Đúng 2 thứ model thấy trong 1 lượt. */
export interface TurnContext {
  /** Khối ổn định (mang breakpoint cache) trước, khối biến động sau. Xem `LlmSystemBlock`. */
  readonly system: readonly LlmSystemBlock[];
  readonly messages: readonly LlmMessage[];
}
