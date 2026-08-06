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

// Múi giờ khách (Việt Nam). Dấu thời gian in theo giờ địa phương để model suy luận sáng/chiều
// đúng, KHÔNG lệch 7 tiếng như UTC. Locale sv-SE cho định dạng ISO-like "2026-08-05 21:47".
const TURN_TIME_ZONE = "Asia/Ho_Chi_Minh";
const turnTimeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TURN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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
 * History → message. Lượt agent (flash reply / lượt agent) → assistant, KHÔNG prefix speaker
 * cũng KHÔNG prefix thời gian (stamp vào content agent = dạy model tự nhại timestamp vào câu
 * trả lời gửi ra ngoài). Lượt người dùng → user; mỗi lượt user gắn `[thời gian]` để model biết
 * lượt nào đến trước/sau + khoảng cách thật giữa các tin; group đa speaker thêm senderId.
 */
function toMessages(history: readonly HistoryEntry[]): LlmMessage[] {
  return history.map((entry) => {
    if (entry.role === "agent") {
      return { role: "assistant" as const, content: [{ type: "text" as const, text: entry.text }] };
    }
    const speaker = entry.isGroup ? `${entry.senderId}: ` : "";
    return {
      role: "user" as const,
      content: [{ type: "text" as const, text: `[${formatTurnTime(entry.ts)}] ${speaker}${entry.text}` }],
    };
  });
}

/** Epoch ms → "YYYY-MM-DD HH:mm" giờ Việt Nam, làm dấu thứ tự cho lượt người dùng. */
function formatTurnTime(ts: number): string {
  return turnTimeFormat.format(new Date(ts));
}

/** Câu hỏi đi tra memory = lượt người dùng gần nhất. History rỗng → không tra. */
function lastUserText(history: readonly HistoryEntry[]): string | undefined {
  const last = history.at(-1);
  return last === undefined || last.text.trim() === "" ? undefined : last.text;
}
