// assembler.ts — ghép ngữ cảnh 1 lượt: history → messages, và prompt nền + catalog skill +
// khối memory → các khối system.
//
// System chia LÀM HAI KHỐI theo nhịp đổi (ổn định → biến động), không phải theo chủ đề: khối đầu
// mang breakpoint prompt cache, nên mọi thứ đổi theo lượt phải nằm ở khối sau. Xem LlmSystemBlock.
//
// Hàm thuần nhận deps làm tham số đầu, KHÔNG interface/class ContextAssembler: 1 call site thật
// (DefaultAgent.run) — dựng port cho nó là abstraction cho code dùng một lần.

import type { LlmMessage, LlmSystemBlock } from "../llm/types.ts";
import { renderSkillCatalog } from "../skills/selector.ts";
import type { HistoryEntry } from "../types/index.ts";
import { renderMemoryBlock } from "./memory-block.ts";
import { renderPendingBlock } from "./pending-block.ts";
import { renderSpeakerBlock } from "./speaker-block.ts";
import type { ContextSources, TurnContext, TurnInput } from "./types.ts";

const SECTION_SEPARATOR = "\n\n";

// Múi giờ khách (Việt Nam). Dấu thời gian in theo giờ địa phương để model suy luận sáng/chiều
// đúng, KHÔNG lệch 7 tiếng như UTC. Định dạng người Việt đọc quen "21:47 05/08/2026" — giống hệt
// mốc thời gian tool đơn hàng in ra, để model không phải đối chiếu hai kiểu ngày.
const TURN_TIME_ZONE = "Asia/Ho_Chi_Minh";
const turnDateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TURN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const turnClockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TURN_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Dựng đúng 2 thứ model thấy. Thứ tự section: prompt nền → catalog skill → vai người gõ → bản tóm
 * → việc treo → khối memory,
 * tức ỔN ĐỊNH → BIẾN ĐỘNG, và ranh giới giữa hai nhóm chính là breakpoint prompt cache
 * (provider đặt `cache_control` ở khối đầu — xem llm/providers/anthropic.ts).
 *
 * Ngân sách §7: history KHÔNG BAO GIỜ bị cắt để nhường memory; khối memory có cap riêng. Đó
 * chính là luật "ngắn hạn thắng dài hạn khi tràn".
 */
export async function assembleTurnContext(
  sources: ContextSources,
  input: TurnInput,
): Promise<TurnContext> {
  // Khối ỔN ĐỊNH: giống hệt nhau ở MỌI lượt của agent này, mọi phòng → phần đem cache.
  const stable = [sources.basePrompt, renderSkillCatalog(sources.skills, sources.agentType)];

  // Khối BIẾN ĐỘNG: đổi theo lượt/phòng → phải nằm SAU breakpoint cache, nếu không mỗi lượt là
  // một prefix mới và cache không bao giờ trúng. Bản tóm đổi hiếm nhưng theo PHÒNG, nên vẫn ở đây.
  const volatile: string[] = [];

  // Vai người gõ đứng ĐẦU khối biến động: mọi phần sau (việc treo, memory) đều được đọc qua lăng
  // kính "đang nói với ai". Rỗng thì renderSpeakerBlock trả "" và joinSections tự bỏ.
  volatile.push(renderSpeakerBlock(input.speaker));

  if (input.summary !== undefined && input.summary !== "") {
    volatile.push(renderSummaryBlock(input.summary));
  }

  // Việc đang treo đứng TRƯỚC khối memory: đây là việc phải làm NGAY trong lượt này, còn memory
  // là nền. Rỗng thì renderPendingBlock trả "" và joinSections tự bỏ.
  volatile.push(renderPendingBlock(input.pending ?? []));

  // Recall chỉ chạy khi CÓ CẢ store lẫn scope. Thiếu scope = chưa biết memory thuộc về khách nào
  // → không được đoán (đoán sai = rò sang khách khác).
  const queryText = lastUserText(input.history);
  if (sources.memory !== undefined && input.memoryScope !== undefined && queryText !== undefined) {
    volatile.push(
      await renderMemoryBlock(sources.memory, input.memoryScope, queryText, input.signal),
    );
  }

  return {
    system: buildSystemBlocks(stable, volatile),
    messages: toMessages(input.history),
  };
}

/**
 * Gộp mỗi nhóm thành 1 khối và đánh dấu cache ở cuối nhóm ổn định. Một breakpoint là đủ (API cho
 * tối đa 4) — và cache khối ổn định là cache luôn cả tool schema, vì tool render TRƯỚC system.
 *
 * Khối rỗng bị loại: API từ chối text block rỗng, và một khối rỗng vẫn làm lệch prefix.
 */
function buildSystemBlocks(
  stable: readonly string[],
  volatile: readonly string[],
): readonly LlmSystemBlock[] {
  const blocks: LlmSystemBlock[] = [];
  const stableText = joinSections(stable);
  if (stableText !== "") blocks.push({ text: stableText, cache: true });

  const volatileText = joinSections(volatile);
  if (volatileText !== "") blocks.push({ text: volatileText });
  return blocks;
}

function joinSections(sections: readonly string[]): string {
  return sections.filter((section) => section !== "").join(SECTION_SEPARATOR);
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

/** Epoch ms → "HH:mm dd/mm/YYYY" giờ Việt Nam, làm dấu thứ tự cho lượt người dùng. */
function formatTurnTime(ts: number): string {
  const date = new Date(ts);
  return `${turnClockFormat.format(date)} ${turnDateFormat.format(date)}`;
}

/**
 * Khối tóm hội thoại cũ. Nói rõ đây là phần ĐÃ TRÔI để model không tưởng nhầm là tin mới nhất và
 * trả lời lại chuyện cũ.
 */
function renderSummaryBlock(summary: string): string {
  return [
    "TÓM TẮT PHẦN HỘI THOẠI TRƯỚC ĐÓ (đã trôi khỏi lịch sử bên dưới — là NGỮ CẢNH, không phải",
    "tin nhắn mới; đừng trả lời lại những gì đã xong ở đây):",
    summary,
  ].join("\n");
}

/** Câu hỏi đi tra memory = lượt người dùng gần nhất. History rỗng → không tra. */
function lastUserText(history: readonly HistoryEntry[]): string | undefined {
  const last = history.at(-1);
  return last === undefined || last.text.trim() === "" ? undefined : last.text;
}
