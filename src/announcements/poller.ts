// poller.ts — nhịp GỬI THẬT các lượt đã xếp hàng. Đây là chỗ duy nhất chạm egress của tầng này.
//
// GIÀNH TRƯỚC, GỬI SAU (CAS trên `next_attempt_at`) — thua CAS thì instance khác đang gửi, rút im
// lặng. Không có lock ngoài nào, không có lock nào hết hạn giữa chừng để mà gửi đôi.
//
// KHÔNG qua LLM: text đã soạn một lần lúc nháp và nằm nguyên trong `announcements.text`. Mọi đại
// lý phải đọc đúng cùng một câu — bơm Envelope cho agent từng nhóm tự soạn lại là 45 câu khác nhau.
//
// Cô lập lỗi theo lượt: một nhóm bị Zalo từ chối chỉ giết đúng lượt đó, tick vẫn chạy tiếp.

import { capForChannel } from "../broadcast/limits.ts";
import { captureError } from "../observability/sentry.ts";
import { AGENT_SENDER_ID } from "../types/index.ts";
import type { AnnouncementDeps, Delivery } from "./types.ts";

/** Nhịp quét. Cùng nhịp với scheduler/workflows — tin hết hàng không cần mịn hơn một phút. */
export const DEFAULT_TICK_MS = 60_000;

/**
 * Số lượt gửi song song trong một batch. Store đã chặn trần mỗi tick; batch ở đây để 30 lượt
 * không phải xếp hàng tuần tự, nhưng vẫn không thả hết một lượt — bridge Zalo là tài nguyên chung
 * với câu trả lời của người dùng đang chờ.
 */
export const SEND_BATCH_SIZE = 5;

/** Số lần thử một nhóm trước khi chịu thua. Nhóm bị xoá / bot bị kick thì thử mãi cũng vậy. */
export const MAX_ATTEMPTS = 4;

/** Giãn cách giữa hai lần thử cùng một nhóm: 2 phút, 4, 8... (backoff nhân đôi từ `attempts`). */
const BASE_BACKOFF_MS = 2 * 60_000;

export interface RunningAnnouncementPoller {
  /** Dừng nhận tick mới + chờ tick đang chạy xong (không cắt giữa lúc đang gửi). */
  stop(): Promise<void>;
}

/** Mốc thử kế sau lần thử thứ `attempts`. Nhân đôi để nhóm hỏng cứng thôi làm phiền bridge. */
export function backoffFrom(attempts: number, nowMs: number): Date {
  return new Date(nowMs + BASE_BACKOFF_MS * 2 ** Math.max(0, attempts));
}

/** Chạy 1 lượt quét. Export riêng để test gọi thẳng, không phải chờ timer. */
export async function tick(deps: AnnouncementDeps, nowMs: number): Promise<void> {
  const due = await deps.store.dueForSend(new Date(nowMs));

  // Batch tuần tự, trong batch chạy song song. `deliverSafely` không bao giờ reject nên một lượt
  // hỏng không kéo cả batch xuống — batch sau vẫn chạy.
  for (let start = 0; start < due.length; start += SEND_BATCH_SIZE) {
    const batch = due.slice(start, start + SEND_BATCH_SIZE);
    await Promise.all(batch.map((delivery) => deliverSafely(deps, delivery, nowMs)));
  }
}

/** Bọc `deliver` để lỗi cô lập theo lượt (Promise.all không được thấy reject). */
async function deliverSafely(
  deps: AnnouncementDeps,
  delivery: Delivery,
  nowMs: number,
): Promise<void> {
  try {
    await deliver(deps, delivery, nowMs);
  } catch (err) {
    console.error(`[announcements] lượt gửi ${delivery.id} lỗi:`, err);
    captureError(err, "announcements.deliver", {
      deliveryId: delivery.id,
      announcementId: delivery.announcementId,
    });
  }
}

async function deliver(deps: AnnouncementDeps, delivery: Delivery, nowMs: number): Promise<void> {
  const expected = delivery.nextAttemptAt;
  // Lượt còn Pending mà không có mốc thử = row hỏng (sửa tay DB). Bỏ qua, không đoán mốc mới.
  if (expected === undefined) return;

  // `attempts` trong tay là số TRƯỚC lần này; claim sẽ +1. Mốc lùi tính theo số sau khi +1 để hai
  // lần thử liên tiếp không rơi vào cùng một khoảng.
  const attemptsAfter = delivery.attempts + 1;
  const claimed = await deps.store.claim({
    id: delivery.id,
    expected,
    next: backoffFrom(attemptsAfter, nowMs),
  });
  if (!claimed) return;

  // Cap là lưới an toàn: service đã từ chối text quá trần lúc soạn, nhưng nhóm có thể nằm ở kênh
  // có trần chặt hơn được thêm sau khi đợt phát đã xếp hàng.
  const text = capForChannel(delivery.channel, delivery.text);

  try {
    await deps.broadcaster.send(
      {
        channel: delivery.channel,
        conversationId: delivery.groupId,
        isGroup: true,
        // Không @ ai: tin phát chung không trả lời riêng người nào. ZaloBroadcaster bỏ qua field
        // này, nhưng hợp đồng Broadcaster vẫn đòi — điền định danh agent cho đúng nghĩa.
        replyToSenderId: AGENT_SENDER_ID,
      },
      text,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const giveUp = attemptsAfter >= MAX_ATTEMPTS;
    await deps.store.markFailed({ id: delivery.id, reason, giveUp });
    if (giveUp) {
      console.error(
        `[announcements] bỏ nhóm ${delivery.groupId} sau ${attemptsAfter} lần thử: ${reason}`,
      );
    }
    return;
  }

  await deps.store.markSent(delivery.id, new Date(nowMs));

  // Ghi history SAU khi đánh dấu đã gửi, và hỏng thì chỉ log: tin đã tới nơi rồi, đánh dấu lại
  // thành chưa gửi sẽ khiến nhóm nhận tin lần hai. Đổi lại, agent đại lý mất nguồn để trích lại
  // (skill het-hang Luật 2) — nên vẫn phải kêu lên, không nuốt.
  try {
    await deps.history.append({
      conversationId: delivery.groupId,
      msgId: `announce:${delivery.announcementId}:${delivery.groupId}`,
      senderId: AGENT_SENDER_ID,
      text,
      isGroup: true,
      role: "agent",
      ts: nowMs,
    });
  } catch (err) {
    console.error(`[announcements] ghi history nhóm ${delivery.groupId} lỗi:`, err);
  }
}

/** Khởi động vòng tick. Tick chạy tuần tự — tick sau chờ tick trước xong (không chồng lượt). */
export function startAnnouncementPoller(
  deps: AnnouncementDeps,
  tickMs: number = DEFAULT_TICK_MS,
): RunningAnnouncementPoller {
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();

  const timer = setInterval(() => {
    if (stopped) return;
    inFlight = inFlight.then(async () => {
      if (stopped) return;
      try {
        await tick(deps, Date.now());
      } catch (err) {
        // Postgres chết → tick sau thử lại. Không để một tick hỏng giết cả process.
        console.error("[announcements] tick lỗi:", err);
        captureError(err, "announcements.tick");
      }
    });
  }, tickMs);

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}
