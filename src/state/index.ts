// index.ts — điểm vào tầng state/memory dài hạn. Bootstrap gọi builder để dựng store + distiller,
// share cho worker (recall ở bước STATE, distill sau turn).

import { sql } from "../db/client.ts";
import { commandOf, redis } from "../redis/client.ts";
import { buildCompactorLlmProvider, buildEmbedder, buildMemoryLlmProvider } from "../llm/index.ts";
import { PgMemoryStore } from "./memory.ts";
import { RedisHistoryStore } from "./session.ts";
import { RedisDedupe } from "./dedupe.ts";
import { RedisTurnMarker } from "./turn-marker.ts";
import { LlmDistiller } from "./distiller.ts";
import { LlmCompactor, RedisSummaryStore } from "./compactor.ts";
import { MemoryWriterRegistry, RedisDistillCursor, TurnoverMemoryWriter } from "./memory-writer.ts";
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

/** Vạch tin mới nhất phòng: ingest nâng, worker soi để gom tin gửi liên tiếp (worker/burst.ts). */
export function buildTurnMarker(): RedisTurnMarker {
  return new RedisTurnMarker(commandOf(redis));
}

/** Distiller chạy trên con nhẹ (CONFIG.memoryModel), theo policy `spec` của agent gọi. */
export function buildDistiller(spec: DistillSpec): Distiller {
  return new LlmDistiller(buildMemoryLlmProvider(), spec);
}

/**
 * Nén hội thoại ngắn hạn — chạy Gemini (CONFIG.compactModel, thiếu key thì registry rơi về
 * memoryModel), lưu Redis theo phòng (không cần MemoryScope) nên chạy được cho cả phòng chưa bind.
 */
export function buildCompactor(): { compactor: LlmCompactor; summaries: RedisSummaryStore } {
  const summaries = new RedisSummaryStore(commandOf(redis));
  return { compactor: new LlmCompactor(buildCompactorLlmProvider(), summaries), summaries };
}

/**
 * Đường ghi dài hạn: phần hội thoại chưa chưng cất → distill → embed → pgvector. Cursor ở Redis
 * (nhiều worker process cùng phòng vẫn không chưng cất trùng phần đã xong).
 */
export function buildMemoryWriter(store: MemoryStore, spec: DistillSpec): MemoryWriter {
  return new TurnoverMemoryWriter(store, buildDistiller(spec), new RedisDistillCursor(commandOf(redis)));
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
export {
  RedisHistoryStore,
  parseHistoryEntry,
  HISTORY_WINDOW_TURNS,
  HISTORY_BUFFER_TURNS,
} from "./session.ts";
export { RedisDedupe } from "./dedupe.ts";
export { RedisTurnMarker } from "./turn-marker.ts";
export { LlmDistiller, parseFacts, renderTranscript } from "./distiller.ts";
export {
  MemoryWriterRegistry,
  RedisDistillCursor,
  TurnoverMemoryWriter,
  toDistillTurns,
  DISTILL_MIN_PENDING,
  DISTILL_WINDOW_TURNS,
} from "./memory-writer.ts";
export {
  LlmCompactor,
  RedisSummaryStore,
  COMPACT_TRIGGER_CHARS,
  COMPACT_MIN_ENTRIES,
  KEEP_RECENT_ENTRIES,
  SUMMARY_MAX_CHARS,
} from "./compactor.ts";
export type {
  CompactPolicy,
  ConversationCompactor,
  SummaryReader,
  SummaryStore,
} from "./compactor.ts";
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
