// index.ts — điểm vào tầng state/memory dài hạn. Bootstrap gọi builder để dựng store + distiller,
// share cho worker (recall ở bước STATE, distill sau turn).

import { sql } from "../db/client.ts";
import { buildEmbedder, buildMemoryLlmProvider } from "../llm/index.ts";
import { PgMemoryStore } from "./memory.ts";
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

/** Distiller chạy trên con nhẹ (CONFIG.memoryModel), theo policy `spec` của agent gọi. */
export function buildDistiller(spec: DistillSpec): Distiller {
  return new LlmDistiller(buildMemoryLlmProvider(), spec);
}

export { PgMemoryStore } from "./memory.ts";
export { LlmDistiller, parseFacts, renderTranscript } from "./distiller.ts";
export { toVectorLiteral, DEDUP_COSINE_DISTANCE } from "./vector.ts";
export { MemoryType, MEMORY_TYPE_VALUES } from "./types.ts";
export { customerSupportSpec } from "./specs.ts";
export type {
  MemoryScope,
  MemoryStore,
  Distiller,
  DistillSpec,
  DistilledFact,
  RecalledFact,
  DistillTurn,
  SqlExecutor,
} from "./types.ts";
