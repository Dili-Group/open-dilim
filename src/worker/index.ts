// index.ts — điểm vào tầng worker. Bootstrap gọi startWorkers() cạnh gateway.

export { startWorkers } from "./pool.ts";
export { handleEnvelope } from "./handler.ts";
export { ConversationLock } from "./lock.ts";
export { isSuperseded, BURST_WINDOW_MS } from "./burst.ts";
export type { RunningWorkers } from "./pool.ts";
export type {
  WorkerContext,
  WorkerPoolDeps,
  BrokerConsumer,
  Delivery,
  HistoryReader,
  HistoryWriter,
  LatestTurnReader,
} from "./types.ts";
