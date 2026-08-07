// fire.ts — biến 1 job tới hạn thành 1 lượt chạy y hệt message thường (§8): dựng Envelope
// `source=cron` → ghi history phòng → push broker ingress. KHÔNG có path xử lý mới.
//
// GHI HISTORY LÀ BẮT BUỘC, không phải tuỳ chọn: agent đọc việc-phải-làm từ history phòng
// (`RootAgent.run` nhận `history`, không nhận Envelope), và worker coi history rỗng là lượt hỏng
// (worker/handler.ts bước STATE). Bỏ bước này thì job nào cũng chết ở đó.
//
// Thứ tự giống gateway "ingest dày": dedupe → history → publish. Hỏng giữa chừng thì KHÔNG gỡ
// mark dedupe — mốc cron đã trôi qua, bắn bù lượt đó chỉ tạo báo cáo trùng cho phòng.

import type { Envelope, HistoryEntry } from "../types/index.ts";
import type { DedupeGate, EnvelopePublisher, HistoryAppender, SchedulerJob } from "./types.ts";

/**
 * Đích cron là PHÒNG (nhóm đại lý đã /ketnoi-daily) — đó là toàn bộ job đang có. Cờ này đổi hành
 * vi broadcast (topic nhóm vs DM) và bước tra chủ phòng của worker; job 1-1 xuất hiện thì thêm
 * cột `is_group` vào scheduler_jobs, ĐỪNG đoán từ dạng `target`.
 */
const CRON_TARGET_IS_GROUP = true;

/**
 * msgId idempotent theo (job, mốc chạy): tick trùng / instance khác cùng bắn → dedupe nuốt cái
 * thứ hai. `scheduledMs` là MỐC LỊCH, không phải Date.now() — hai instance lệch đồng hồ vài giây
 * vẫn sinh ra cùng một id.
 */
export function cronMsgId(jobId: string, scheduledMs: number): string {
  return `cron:${jobId}:${scheduledMs}`;
}

/** Envelope cron. Tách hàm để test khẳng định được shape mà không cần Redis. */
export function buildCronEnvelope(job: SchedulerJob, scheduledMs: number): Envelope {
  return {
    source: "cron",
    channel: job.channel,
    msgId: cronMsgId(job.id, scheduledMs),
    conversationId: job.target,
    // Vai vẫn do AUTH resolve từ senderId này — job không mang sẵn quyền gì.
    senderId: job.identity,
    isGroup: CRON_TARGET_IS_GROUP,
    // Không ai "nhắc" agent, nhưng job sinh ra là để agent chạy → qua thẳng trigger gate.
    addressedToAgent: true,
    text: job.task,
    mentions: [],
    ts: scheduledMs,
  };
}

/** false = bỏ bắn (đã bắn rồi ở tick/instance khác). Lỗi I/O ném ra cho caller log theo job. */
export async function fireJob(
  deps: { readonly broker: EnvelopePublisher; readonly history: HistoryAppender; readonly dedupe: DedupeGate },
  job: SchedulerJob,
  scheduledMs: number,
): Promise<boolean> {
  const envelope = buildCronEnvelope(job, scheduledMs);

  const first = await deps.dedupe.firstSee(envelope.channel, envelope.msgId);
  if (!first) return false;

  await deps.history.append(toHistoryEntry(envelope));
  await deps.broker.publish(envelope);
  return true;
}

/**
 * Lượt cron vào history với `role: "user"`: agent phải ĐỌC nó như một yêu cầu cần làm. Ghi
 * `role: "agent"` thì model coi đó là lời của chính mình và không làm gì.
 */
function toHistoryEntry(envelope: Envelope): HistoryEntry {
  return {
    conversationId: envelope.conversationId,
    msgId: envelope.msgId,
    senderId: envelope.senderId,
    text: envelope.text,
    isGroup: envelope.isGroup,
    role: "user",
    ts: envelope.ts,
  };
}
