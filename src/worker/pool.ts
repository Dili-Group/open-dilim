// pool.ts — spawn N worker consume broker (design §worker pool.ts). Mỗi worker: take → order-lock
// theo conversationId → handle. Trả handle để bootstrap stop sạch khi shutdown.

import { ConversationLock } from "./lock.ts";
import { handleEnvelope } from "./handler.ts";
import type { WorkerPoolDeps } from "./types.ts";

export interface RunningWorkers {
  /** Dừng nhận việc mới, chờ các worker đang chạy thoát vòng. */
  stop(): Promise<void>;
}

export function startWorkers(deps: WorkerPoolDeps): RunningWorkers {
  const controller = new AbortController();
  const lock = new ConversationLock();
  const loops: Promise<void>[] = [];
  for (let i = 0; i < deps.workerCount; i++) {
    loops.push(workerLoop(deps, lock, controller.signal));
  }

  return {
    async stop(): Promise<void> {
      controller.abort();
      await Promise.all(loops);
    },
  };
}

async function workerLoop(
  deps: WorkerPoolDeps,
  lock: ConversationLock,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    const delivery = await deps.broker.take(signal);
    if (delivery === null) break; // aborted
    const envelope = delivery.envelope;
    // Serialize theo phòng. handleEnvelope trả AgentResult — lỗi là GIÁ TRỊ (status="failed"),
    // không phải exception → lock không có gì để reject. Hợp đồng nằm ở KIỂU, không ở comment.
    const result = await lock.run(envelope.conversationId, () =>
      handleEnvelope(deps, envelope, signal),
    );
    // failed = hỏng hạ tầng/LLM (DB chết, kênh chết) → KHÔNG ack, để broker giao lại; lặp hoài
    // thì broker tự đẩy DLQ. reply/suspended = lượt đã xong đúng nghĩa vụ → ack.
    if (result.status === "failed") {
      console.error(`[worker] msg ${envelope.msgId} hỏng ở bước ${result.step}:`, result.error);
    }
    try {
      if (result.status === "failed") await delivery.retryLater();
      else await delivery.ack();
    } catch (err) {
      // Ack hỏng (Redis chớp tắt) không được giết worker: message ở lại PEL, lượt sau reclaim.
      console.error(`[worker] chốt trạng thái msg ${envelope.msgId} hỏng:`, err);
    }
  }
}
