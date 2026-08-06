// index.ts — điểm vào tầng state/memory dài hạn. Bootstrap gọi builder để dựng store + distiller,
// share cho worker (recall ở bước STATE, distill sau turn).

import { sql } from "../db/client.ts";
import { commandOf, redis } from "../redis/client.ts";
import { buildEmbedder, buildMemoryLlmProvider } from "../llm/index.ts";
import { PgMemoryStore } from "./memory.ts";
import { RedisHistoryStore } from "./session.ts";
import { RedisDedupe } from "./dedupe.ts";
import { LlmDistiller } from "./distiller.ts";
import { LlmCompactor, RedisSummaryStore } from "./compactor.ts";
import { BatchedMemoryWriter, MemoryWriterRegistry, RedisDistillCounter } from "./memory-writer.ts";
import type { Distiller, DistillSpec, MemoryStore, MemoryWriter, SqlExecutor } from "./types.ts";

/** Bọc Bun.sql thành SqlExecutor. `unsafe(text, params)`: text = hằng schema, params tham số hoá. */
const sqlExecutor: SqlExecutor = {
  query: (text, params) => sql.unsafe(text, [...params]),
};

/** MemoryStore thật (Postgres+pgvector + embedder Gemini). Cần DATABASE_URL + GEMINI_API_KEY. */
export function buildMemoryStore(): MemoryStore {
  return new PgMemoryStore(sqlExecutor, buildEmbedder());
}

/** History ngắn hạn trên Redis. Cùng instance phục vụ append (ingest) + recent (worker). */
export function buildHistoryStore(): RedisHistoryStore {
  return new RedisHistoryStore(commandOf(redis));
}

/** Dedupe msgId trên Redis (SET NX) — atomic kể cả khi chạy nhiều process. */
export function buildDedupe(): RedisDedupe {
  return new RedisDedupe(commandOf(redis));
}

/** Distiller chạy trên con nhẹ (CONFIG.memoryModel), theo policy `spec` của agent gọi. */
export function buildDistiller(spec: DistillSpec): Distiller {
  return new LlmDistiller(buildMemoryLlmProvider(), spec);
}

/**
 * Nén hội thoại ngắn hạn — cùng con nhẹ với distiller, nhưng lưu Redis theo phòng (không cần
 * MemoryScope) nên chạy được cho cả phòng chưa bind.
 */
export function buildCompactor(): { compactor: LlmCompactor; summaries: RedisSummaryStore } {
  const summaries = new RedisSummaryStore(commandOf(redis));
  return { compactor: new LlmCompactor(buildMemoryLlmProvider(), summaries), summaries };
}

/**
 * Đường ghi dài hạn: gom lô lượt → distill → embed → pgvector. Bộ đếm lô ở Redis (nhiều worker
 * process cùng phòng vẫn đếm đúng).
 */
export function buildMemoryWriter(store: MemoryStore, spec: DistillSpec): MemoryWriter {
  return new BatchedMemoryWriter(store, buildDistiller(spec), new RedisDistillCounter(commandOf(redis)));
}

/**
 * Một writer cho MỖI agent (theo `RootAgent.memorySpec`) — agent nhớ khác nhau thì chưng cất
 * bằng prompt khác nhau. Spec trùng → dùng chung writer.
 */
export function buildMemoryWriters(
  store: MemoryStore,
  specs: ReadonlyMap<string, DistillSpec>,
): MemoryWriterRegistry {
  return new MemoryWriterRegistry(specs, (spec) => buildMemoryWriter(store, spec));
}

export { PgMemoryStore } from "./memory.ts";
export { RedisHistoryStore, parseHistoryEntry } from "./session.ts";
export { RedisDedupe } from "./dedupe.ts";
export { LlmDistiller, parseFacts, renderTranscript } from "./distiller.ts";
export {
  BatchedMemoryWriter,
  MemoryWriterRegistry,
  RedisDistillCounter,
  toDistillTurns,
  DISTILL_EVERY_TURNS,
  DISTILL_WINDOW_TURNS,
} from "./memory-writer.ts";
export {
  LlmCompactor,
  RedisSummaryStore,
  COMPACT_TRIGGER_CHARS,
  KEEP_RECENT_ENTRIES,
  SUMMARY_MAX_CHARS,
} from "./compactor.ts";
export type { ConversationCompactor, SummaryReader, SummaryStore } from "./compactor.ts";
export { toVectorLiteral, DEDUP_COSINE_DISTANCE, RECALL_MAX_COSINE_DISTANCE } from "./vector.ts";
export { MemoryType, MEMORY_TYPE_VALUES } from "./types.ts";
export { customerSupportSpec, internalOpsSpec, personalSpec } from "./specs.ts";
export type {
  MemoryScope,
  MemoryStore,
  MemoryRecall,
  MemoryWriter,
  MemoryWriterLookup,
  Distiller,
  DistillSpec,
  DistilledFact,
  RecallOptions,
  RecalledFact,
  DistillTurn,
  SqlExecutor,
} from "./types.ts";
