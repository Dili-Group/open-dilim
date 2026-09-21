// gate.ts — TẦNG 0 của phễu proactive: guard CẤU TRÚC, 0 token, không I/O. Chạy trên MỌI tin
// group không mention agent, và chạy TRONG đường nóng của webhook (gateway gọi trước khi trả
// 202, bên trong vùng đã mark dedupe) → ở đây tuyệt đối không được gọi mạng.
//
// Nhiệm vụ đã thu hẹp: chỉ loại thứ KHÔNG THỂ là câu cần giúp dù đọc kiểu gì — tin không phải
// người thật gõ, tin của chính agent, tin đã tag đích danh người khác, tin rỗng/chỉ media. Việc
// đoán Ý ĐỊNH chuyển hẳn sang tầng 2 (proactive/judge.ts), nơi không ai đang chờ và tầng 1 đã
// lọc gần hết. Trước đây tầng này còn một danh sách regex intent — đã bỏ.

import type { Envelope } from "../types/index.ts";

/**
 * Placeholder đính kèm bridge Zalo chèn vào text khi tin chỉ có media. Tin mà bỏ các khối này
 * (+ URL) xong không còn nội dung thì không có gì để agent trả lời.
 */
const ATTACHMENT_PLACEHOLDER = /\[(Ảnh|Tệp) đính kèm\]/g;
const URL_PATTERN = /https?:\/\/\S+/g;

/** Text còn dưới ngần này ký tự sau khi bỏ placeholder/URL = không có câu hỏi thật. */
const MIN_MEANINGFUL_CHARS = 4;

export interface ProactiveGateInput {
  readonly envelope: Envelope;
  /**
   * Mọi id mà tin của CHÍNH agent có thể mang khi vọng lại webhook: agentUid (id mention) +
   * selfUid (id tài khoản OA gửi tin — đo thực tế HAI ID NÀY KHÁC NHAU trên Zalo). Thiếu selfUid
   * là agent tự trigger phễu trên câu trả lời của mình.
   */
  readonly selfIds: readonly string[];
}

/** true = tin đáng vào hàng chờ (tầng 1). Thuần, không I/O. */
export function passesProactiveGate({ envelope, selfIds }: ProactiveGateInput): boolean {
  // Phễu chỉ dành cho tin người thật gõ trong NHÓM mà trigger gate đã bỏ qua. Tin direct và tin
  // mention agent đã có lượt riêng; envelope tổng hợp (cron/distill/proactive) không phải tin.
  if (!envelope.isGroup || envelope.addressedToAgent || envelope.source !== "channel") return false;
  if (selfIds.includes(envelope.senderId)) return false;
  // Tin đã tag ĐÍCH DANH người khác (tag agent thì addressedToAgent đã true, không rơi vào đây):
  // người hỏi đang nhờ đúng người đó làm — việc của NGƯỜI, không phải câu bơ vơ cần agent nhặt.
  if (envelope.mentions.length > 0) return false;

  const meaningful = envelope.text
    .replace(ATTACHMENT_PLACEHOLDER, " ")
    .replace(URL_PATTERN, " ")
    .trim();
  return meaningful.length >= MIN_MEANINGFUL_CHARS;
}
