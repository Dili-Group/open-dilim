// types.ts — port worker cần từ nơi khởi động (bootstrap). Broker/history đọc qua port này,
// không bind impl in-mem/Redis. Đổi hạ tầng chỉ sửa bootstrap.

import type { Envelope, HistoryEntry } from "../types/index.ts";
import type { IdentityResolver } from "../auth/types.ts";
import type { AgentRegistry } from "../agents/registry.ts";
import type { Broadcaster } from "../broadcast/types.ts";

/** Đầu consume của broker (worker đọc). Ing.publish nằm ở port Broker của message-ingest. */
export interface BrokerConsumer {
  take(signal?: AbortSignal): Promise<Envelope | null>;
}

/** Đọc history phòng (STATE bước 7). */
export interface HistoryReader {
  recent(conversationId: string, limit: number): Promise<HistoryEntry[]>;
}

/** Service 1 worker cần để xử lý 1 envelope. */
export interface WorkerContext {
  readonly history: HistoryReader;
  readonly identity: IdentityResolver;
  readonly agents: AgentRegistry;
  readonly broadcaster: Broadcaster;
}

/** Bó đầy đủ để start pool: context + nguồn queue + số worker. */
export interface WorkerPoolDeps extends WorkerContext {
  readonly broker: BrokerConsumer;
  readonly workerCount: number;
}
