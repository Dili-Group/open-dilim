// index.ts — điểm vào tầng state/memory dài hạn. Bootstrap gọi builder để dựng store + distiller,
// share cho worker (recall ở bước STATE, distill sau turn).

import { sql } from "../db/client.ts";
import { commandOf, redis } from "../redis/client.ts";
import { buildEmbedder, buildMemoryLlmProvider } from "../llm/index.ts";
import { PgMemoryStore } from "./memory.ts";
import { RedisHistoryStore } from "./session.ts";
import { RedisDedupe } from "./dedupe.ts";
import { LlmDistiller } from "./distiller.ts";
import type { Distiller, DistillSpec, MemoryStore, SqlExecutor } from "./types.ts";

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

export { PgMemoryStore } from "./memory.ts";
export { RedisHistoryStore, parseHistoryEntry } from "./session.ts";
export { RedisDedupe } from "./dedupe.ts";
export { LlmDistiller, parseFacts, renderTranscript } from "./distiller.ts";
export { toVectorLiteral, DEDUP_COSINE_DISTANCE, RECALL_MAX_COSINE_DISTANCE } from "./vector.ts";
export { MemoryType, MEMORY_TYPE_VALUES } from "./types.ts";
export { customerSupportSpec } from "./specs.ts";
export type {
  MemoryScope,
  MemoryStore,
  MemoryRecall,
  Distiller,
  DistillSpec,
  DistilledFact,
  RecallOptions,
  RecalledFact,
  DistillTurn,
  SqlExecutor,
} from "./types.ts";
