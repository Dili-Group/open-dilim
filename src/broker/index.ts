// index.ts — điểm lắp tầng broker. Bootstrap gọi buildBroker() để có 1 instance dùng cho CẢ
// publish (ingest) lẫn take (worker pool).

import { hostname } from "node:os";
import { commandOf, createBlockingClient, redis } from "../redis/client.ts";
import { RedisStreamBroker } from "./queue.ts";

/**
 * Tên consumer trong group. Kèm pid để hai process trên cùng máy không dùng chung PEL — process
 * chết thì pending của nó nhận diện được và bị reclaim theo idle.
 */
function consumerName(): string {
  return `${hostname()}-${process.pid}`;
}

/** Dựng broker Redis Streams + đảm bảo consumer group tồn tại (fail-fast nếu Redis chưa lên). */
export async function buildBroker(): Promise<RedisStreamBroker> {
  const broker = new RedisStreamBroker(
    commandOf(redis),
    commandOf(createBlockingClient()),
    consumerName(),
  );
  await broker.ensureGroup();
  return broker;
}

export { RedisStreamBroker, INGRESS_STREAM, INGRESS_DLQ, INGRESS_GROUP } from "./queue.ts";
export { parseEnvelope, parseEntries, parsePending, parseReadReply } from "./resp.ts";
export type { StreamEntry, PendingEntry } from "./resp.ts";
