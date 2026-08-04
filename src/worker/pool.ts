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
    const envelope = await deps.broker.take(signal);
    if (envelope === null) break; // aborted
    // Serialize theo phòng; handleEnvelope tự cô lập lỗi nên lock không bao giờ reject.
    await lock.run(envelope.conversationId, () => handleEnvelope(deps, envelope, signal));
  }
}
