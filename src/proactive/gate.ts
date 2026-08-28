// gate.ts — TẦNG 0 của phễu proactive: lọc heuristic 0 token, chạy trên MỌI tin group không
// mention agent nên phải rẻ tuyệt đối (regex, không I/O). Nhiệm vụ là LOẠI phần chắc chắn không
// phải câu cần giúp (sticker, ảnh trần, thông báo kho, tin của chính agent) — bắt nhầm còn hơn
// bỏ sót, tầng 1 (chờ người thật trả lời) và tầng 2 (classifier) lọc tiếp.

import type { ProactiveSpec } from "../agents/types.ts";
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
  readonly spec: ProactiveSpec;
  /**
   * Mọi id mà tin của CHÍNH agent có thể mang khi vọng lại webhook: agentUid (id mention) +
   * selfUid (id tài khoản OA gửi tin — đo thực tế HAI ID NÀY KHÁC NHAU trên Zalo). Thiếu selfUid
   * là agent tự trigger phễu trên câu trả lời của mình.
   */
  readonly selfIds: readonly string[];
}

/** true = tin đáng vào phễu → ingest đặt lịch chờ (tầng 1). Thuần, không I/O. */
export function passesProactiveGate({ envelope, spec, selfIds }: ProactiveGateInput): boolean {
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
  if (meaningful.length < MIN_MEANINGFUL_CHARS) return false;

  return spec.triggers.some((pattern) => pattern.test(meaningful));
}
