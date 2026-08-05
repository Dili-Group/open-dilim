// deps-memory.ts — impl in-memory của IngestDeps (Broker / HistoryStore / Dedupe).
//
// ⚠️ CHỈ CHO TEST. Runtime thật dùng Redis (broker/queue.ts, state/session.ts, state/dedupe.ts);
// bootstrap KHÔNG còn wire mấy class này. Giữ lại vì test cần queue/history không cần server:
// state nằm trong RAM → mất khi restart, KHÔNG share cross-process.
//
// JS single-thread → firstSee (check-and-mark) atomic tự nhiên, khỏi lock.

import type { Envelope, HistoryEntry } from "../types/index.ts";
import type { Broker, Dedupe, HistoryStore, IngestDeps } from "../message-ingest/index.ts";
import type { BrokerConsumer, Delivery } from "../worker/index.ts";

/**
 * Ingress queue in-mem, consume được (worker pool đọc qua take()). FIFO fair giữa nhiều worker:
 * publish giao thẳng cho waiter đang chờ (nếu có), ngược lại xếp queue. Abort → take trả null.
 */
export class MemoryBroker implements Broker, BrokerConsumer {
  readonly queue: Delivery[] = [];
  private readonly waiters: Array<(delivery: Delivery | null) => void> = [];
  /** msgId đã ack — test khẳng định worker chốt đúng trạng thái. */
  readonly acked: string[] = [];

  publish(envelope: Envelope): Promise<void> {
    const delivery = this.makeDelivery(envelope);
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter(delivery);
    else this.queue.push(delivery);
    return Promise.resolve();
  }

  /** In-mem không có PEL: retryLater chỉ đánh dấu "chưa xong", không giao lại. */
  private makeDelivery(envelope: Envelope): Delivery {
    return {
      envelope,
      ack: () => {
        this.acked.push(envelope.msgId);
        return Promise.resolve();
      },
      retryLater: () => Promise.resolve(),
    };
  }

  /** Lấy 1 message; chờ tới khi có hoặc signal abort (trả null để worker thoát vòng). */
  take(signal?: AbortSignal): Promise<Delivery | null> {
    if (signal?.aborted === true) return Promise.resolve(null);
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);

    return new Promise((resolve) => {
      const settle = (env: Delivery | null): void => {
        signal?.removeEventListener("abort", onAbort);
        resolve(env);
      };
      const onAbort = (): void => {
        const idx = this.waiters.indexOf(settle);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(null);
      };

      this.waiters.push(settle);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

/** History phòng in-mem, giữ đúng thứ tự append (giờ nhận). Worker đọc qua recent(). */
export class MemoryHistoryStore implements HistoryStore {
  readonly entries: HistoryEntry[] = [];

  append(entry: HistoryEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }

  /** N turn gần nhất của 1 phòng, đúng thứ tự thời gian. */
  recent(conversationId: string, limit: number): Promise<HistoryEntry[]> {
    const forRoom = this.entries.filter((e) => e.conversationId === conversationId);
    return Promise.resolve(forRoom.slice(-limit));
  }
}

/** Dedupe in-mem qua Set. Key = `channel:msgId`. */
export class MemoryDedupe implements Dedupe {
  private readonly seen = new Set<string>();

  firstSee(channel: string, msgId: string): Promise<boolean> {
    const key = keyOf(channel, msgId);
    if (this.seen.has(key)) return Promise.resolve(false);
    this.seen.add(key);
    return Promise.resolve(true);
  }

  release(channel: string, msgId: string): Promise<void> {
    this.seen.delete(keyOf(channel, msgId));
    return Promise.resolve();
  }
}

function keyOf(channel: string, msgId: string): string {
  return `${channel}:${msgId}`;
}

/** Bó 3 port in-mem thành IngestDeps cho gateway. */
export function createMemoryDeps(): IngestDeps {
  return {
    broker: new MemoryBroker(),
    history: new MemoryHistoryStore(),
    dedupe: new MemoryDedupe(),
  };
}
