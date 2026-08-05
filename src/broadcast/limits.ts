// limits.ts — trần độ dài text egress theo channel. Model không bị prompt ràng độ dài cứng được,
// nên cắt ở biên gửi: quá trần thì platform từ chối cả tin, mất luôn câu trả lời.

/** Trần mỗi tin theo channel. Channel chưa khai → DEFAULT_MAX_CHARS. */
const CHANNEL_MAX_CHARS: Readonly<Record<string, number>> = {
  zalo: 4500,
};

const DEFAULT_MAX_CHARS = 4500;

// Báo cho người đọc biết tin bị cắt, không để câu cụt lửng lơ.
const TRUNCATION_SUFFIX = "… (nội dung đã bị cắt bớt)";

/** Text vượt trần channel → cắt và gắn hậu tố; trong trần → trả nguyên bản. */
export function capForChannel(channel: string, text: string): string {
  const max = CHANNEL_MAX_CHARS[channel] ?? DEFAULT_MAX_CHARS;
  if (text.length <= max) return text;
  // Hậu tố nằm TRONG trần, không đẩy tin vượt lại.
  return text.slice(0, max - TRUNCATION_SUFFIX.length).trimEnd() + TRUNCATION_SUFFIX;
}
