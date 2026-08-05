// assembler.ts — ghép ngữ cảnh 1 lượt: history → messages, và prompt nền + catalog skill +
// khối memory → chuỗi system.
//
// Hàm thuần nhận deps làm tham số đầu, KHÔNG interface/class ContextAssembler: 1 call site thật
// (DefaultAgent.run) — dựng port cho nó là abstraction cho code dùng một lần.

import type { LlmMessage } from "../llm/types.ts";
import { renderSkillCatalog } from "../skills/selector.ts";
import type { HistoryEntry } from "../types/index.ts";
import { renderMemoryBlock } from "./memory-block.ts";
import type { ContextSources, TurnContext, TurnInput } from "./types.ts";

const SECTION_SEPARATOR = "\n\n";

/**
 * Dựng đúng 2 thứ model thấy. Thứ tự section: prompt nền → catalog skill → khối memory, tức ỔN
 * ĐỊNH → BIẾN ĐỘNG (prompt nền + catalog giống hệt nhau mọi lượt, khối memory đổi từng lượt) —
 * đúng thứ tự prefix cache, được miễn phí ngay bây giờ.
 *
 * Ngân sách §7: history KHÔNG BAO GIỜ bị cắt để nhường memory; khối memory có cap riêng. Đó
 * chính là luật "ngắn hạn thắng dài hạn khi tràn".
 */
export async function assembleTurnContext(
  sources: ContextSources,
  input: TurnInput,
): Promise<TurnContext> {
  const sections = [sources.basePrompt, renderSkillCatalog(sources.skills)];

  // Recall chỉ chạy khi CÓ CẢ store lẫn scope. Thiếu scope = chưa biết memory thuộc về khách nào
  // → không được đoán (đoán sai = rò sang khách khác).
  const queryText = lastUserText(input.history);
  if (sources.memory !== undefined && input.memoryScope !== undefined && queryText !== undefined) {
    sections.push(
      await renderMemoryBlock(sources.memory, input.memoryScope, queryText, input.signal),
    );
  }

  return {
    system: sections.filter((section) => section !== "").join(SECTION_SEPARATOR),
    messages: toMessages(input.history),
  };
}

/**
 * History → message. Giữ nguyên hành vi hiện có: mọi entry là lượt người dùng (HistoryEntry chưa
 * có `role` — lưu lượt agent là bước sau, và khi tới thì CHỈ file này đổi).
 * Group đa speaker: gắn senderId để model trả đúng người.
 */
function toMessages(history: readonly HistoryEntry[]): LlmMessage[] {
  return history.map((entry) => ({
    role: "user" as const,
    content: [{ type: "text" as const, text: entry.isGroup ? `${entry.senderId}: ${entry.text}` : entry.text }],
  }));
}

/** Câu hỏi đi tra memory = lượt người dùng gần nhất. History rỗng → không tra. */
function lastUserText(history: readonly HistoryEntry[]): string | undefined {
  const last = history.at(-1);
  return last === undefined || last.text.trim() === "" ? undefined : last.text;
}
