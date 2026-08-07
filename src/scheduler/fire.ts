// fire.ts — biến 1 job tới hạn thành 1 lượt chạy y hệt message thường (§8): dựng Envelope
// `source=cron` → ghi history phòng → push broker ingress. KHÔNG có path xử lý mới.
//
// GHI HISTORY LÀ BẮT BUỘC, không phải tuỳ chọn: agent đọc việc-phải-làm từ history phòng
// (`RootAgent.run` nhận `history`, không nhận Envelope), và worker coi history rỗng là lượt hỏng
// (worker/handler.ts bước STATE). Bỏ bước này thì job nào cũng chết ở đó.
//
// Thứ tự giống gateway "ingest dày": dedupe → history → publish. Hỏng giữa chừng thì KHÔNG gỡ
// mark dedupe — mốc cron đã trôi qua, bắn bù lượt đó chỉ tạo báo cáo trùng cho phòng.

import type { Broadcaster } from "../broadcast/index.ts";
import type { Envelope, HistoryEntry } from "../types/index.ts";
import type {
  DedupeGate,
  EnvelopePublisher,
  HistoryAppender,
  SchedulerJob,
  TypingLookup,
} from "./types.ts";

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

/** Mở đầu tin báo trước; phần sau là mô tả việc của job. */
const ANNOUNCE_PREFIX = "⏰ Chuẩn bị chạy job: ";

/** false = bỏ bắn (đã bắn rồi ở tick/instance khác). Lỗi I/O ném ra cho caller log theo job. */
export async function fireJob(
  deps: {
    readonly broker: EnvelopePublisher;
    readonly history: HistoryAppender;
    readonly dedupe: DedupeGate;
    readonly typing?: TypingLookup;
    readonly broadcaster?: Broadcaster;
  },
  job: SchedulerJob,
  scheduledMs: number,
): Promise<boolean> {
  const envelope = buildCronEnvelope(job, scheduledMs);

  const first = await deps.dedupe.firstSee(envelope.channel, envelope.msgId);
  if (!first) return false;

  // Báo TRƯỚC khi publish: người trong phòng thấy nhịp gõ rồi tin báo, sau đó mới tới kết quả
  // agent. Sau dedupe → mỗi mốc chạy chỉ báo một lần.
  await announceFiring(deps, job, envelope);

  await deps.history.append(toHistoryEntry(envelope));
  await deps.broker.publish(envelope);
  return true;
}

/**
 * Gửi nhịp typing + tin "sắp chạy job" tới phòng đích. Cosmetic: hỏng thì log rồi đi tiếp, KHÔNG
 * để mất lượt cron chỉ vì bridge chớp.
 */
async function announceFiring(
  deps: { readonly typing?: TypingLookup; readonly broadcaster?: Broadcaster },
  job: SchedulerJob,
  envelope: Envelope,
): Promise<void> {
  if (deps.broadcaster === undefined && deps.typing === undefined) return;

  const target = {
    channel: envelope.channel,
    conversationId: envelope.conversationId,
    isGroup: envelope.isGroup,
  };
  try {
    await deps.typing?.for(envelope.channel).typing(target);
    await deps.broadcaster?.send(
      { ...target, replyToSenderId: envelope.senderId },
      `${ANNOUNCE_PREFIX}${job.task}`,
    );
  } catch (err) {
    console.error(`[scheduler] báo trước job ${job.id} lỗi:`, err);
  }
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
