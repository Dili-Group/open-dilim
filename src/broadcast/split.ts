// split.ts — tách một câu trả lời thành NHIỀU tin nhắn liên tiếp, theo marker model tự đặt.
// Lý do: người Việt nhắn tin thành mấy bong bóng ngắn (xác nhận → dữ kiện → câu chốt); dồn hết
// vào một khối dài là dấu hiệu rõ nhất của máy trả lời.
//
// Marker do MODEL đặt chứ code không tự đoán chỗ ngắt: cắt máy móc ở dòng trống sẽ xé rời bảng
// đơn hàng, tách số tiền khỏi ngữ cảnh của nó. Model quên marker → về đúng hành vi cũ (một tin).

/** Dòng ngắt: chỉ gồm 3 gạch trở lên (cho phép khoảng trắng hai đầu). */
const SPLIT_MARKER = /^[ \t]*-{3,}[ \t]*$/;

/**
 * Trần số bong bóng một lượt. Quá bốn tin liên tiếp không còn giống người nhắn nữa mà thành spam
 * — phần dư gộp vào tin cuối chứ không bỏ.
 */
const MAX_CHUNKS = 4;

/** Nhịp gõ tối thiểu mỗi tin, kể cả tin một dòng — gửi tức thì thì mất luôn cảm giác đang gõ. */
const BASE_DELAY_MS = 400;
const MS_PER_CHAR = 15;
/** Trần nhịp gõ: tin dài không được giữ worker slot quá lâu chỉ để diễn. */
const MAX_DELAY_MS = 2_500;

/**
 * Cắt text thành các đoạn theo marker. Không có marker → trả đúng một phần tử (nguyên văn đã
 * trim). Đoạn rỗng bị loại; text rỗng → mảng rỗng (caller không gửi gì).
 */
export function splitReply(text: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    const chunk = current.join("\n").trim();
    if (chunk !== "") chunks.push(chunk);
    current = [];
  };

  for (const line of text.split("\n")) {
    if (SPLIT_MARKER.test(line)) flush();
    else current.push(line);
  }
  flush();

  if (chunks.length <= MAX_CHUNKS) return chunks;
  // Gộp phần dư vào tin cuối: cắt bớt dữ kiện thì mất thông tin, còn gộp chỉ là tin cuối dài hơn.
  const kept = chunks.slice(0, MAX_CHUNKS - 1);
  kept.push(chunks.slice(MAX_CHUNKS - 1).join("\n"));
  return kept;
}

/** Thời gian "đang gõ" trước một tin, theo độ dài của chính tin đó. */
export function typingDelayMs(chunk: string): number {
  return Math.min(BASE_DELAY_MS + chunk.length * MS_PER_CHAR, MAX_DELAY_MS);
}
