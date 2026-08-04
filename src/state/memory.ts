// memory.ts — MemoryStore dài hạn trên Postgres+pgvector (§7). Đơn vị = 1 atomic fact (không
// chunk cơ học). Mọi query LỌC (customer_id, end_user_id) — tenancy cứng. SqlExecutor + Embedder
// inject → test không cần DB/network thật.
//
// Injection: `text` chỉ ghép từ hằng schema (tin được); giá trị runtime (scope, vector, fact)
// LUÔN qua params $n. Không nối string giá trị vào query (CLAUDE.md).

import { MEMORY } from "../db/schema.ts";
import type { Embedder } from "../llm/types.ts";
import {
  type DistilledFact,
  type MemoryScope,
  type MemoryStore,
  type RecalledFact,
  type SqlExecutor,
} from "./types.ts";
import { DEDUP_COSINE_DISTANCE, toVectorLiteral } from "./vector.ts";

const C = MEMORY.col;
const T = MEMORY.table;

export class PgMemoryStore implements MemoryStore {
  constructor(
    private readonly exec: SqlExecutor,
    private readonly embedder: Embedder,
  ) {}

  async write(
    scope: MemoryScope,
    facts: readonly DistilledFact[],
    sourceMsgId?: string,
    signal?: AbortSignal,
  ): Promise<number> {
    if (facts.length === 0) return 0;

    // Idempotency: message này đã distill rồi (retry/redelivery) → không ghi lại.
    if (sourceMsgId !== undefined && (await this.hasSource(scope, sourceMsgId))) return 0;

    const vectors = await this.embedder.embed({
      texts: facts.map((f) => f.text),
      taskType: "document",
      signal,
    });
    if (vectors.length !== facts.length) {
      throw new Error(`embed trả ${vectors.length} vector, cần ${facts.length}`);
    }

    let written = 0;
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      const vector = vectors[i];
      if (fact === undefined || vector === undefined) continue; // noUncheckedIndexedAccess
      const literal = toVectorLiteral(vector);

      // Near-dup: đã có fact gần y hệt trong scope → bỏ, tránh phình memory (recall nhiễu).
      if (await this.hasNearDuplicate(scope, literal)) continue;

      await this.exec.query(
        `INSERT INTO ${T} (${C.customerId}, ${C.endUserId}, ${C.type}, ${C.text}, ` +
          `${C.embedding}, ${C.sourceMsgId}, ${C.confidence}) ` +
          `VALUES ($1, $2, $3, $4, $5::vector, $6, $7)`,
        [scope.customerId, scope.endUserId, fact.type, fact.text, literal, sourceMsgId ?? null, fact.confidence],
      );
      written++;
    }
    return written;
  }

  async recall(
    scope: MemoryScope,
    queryText: string,
    k: number,
    signal?: AbortSignal,
  ): Promise<RecalledFact[]> {
    if (queryText.trim() === "" || k <= 0) return [];
    const [vector] = await this.embedder.embed({ texts: [queryText], taskType: "query", signal });
    if (vector === undefined) return [];

    const rows = await this.exec.query(
      `SELECT ${C.text}, ${C.type}, ${C.createdAt} FROM ${T} ` +
        `WHERE ${C.customerId} = $1 AND ${C.endUserId} = $2 ` +
        `ORDER BY ${C.embedding} <=> $3::vector LIMIT $4`,
      [scope.customerId, scope.endUserId, toVectorLiteral(vector), k],
    );
    return toRecalledFacts(rows);
  }

  async prime(scope: MemoryScope, limit: number, _signal?: AbortSignal): Promise<RecalledFact[]> {
    if (limit <= 0) return [];
    const rows = await this.exec.query(
      `SELECT ${C.text}, ${C.type}, ${C.createdAt} FROM ${T} ` +
        `WHERE ${C.customerId} = $1 AND ${C.endUserId} = $2 ` +
        `ORDER BY ${C.createdAt} DESC LIMIT $3`,
      [scope.customerId, scope.endUserId, limit],
    );
    return toRecalledFacts(rows);
  }

  private async hasSource(scope: MemoryScope, sourceMsgId: string): Promise<boolean> {
    const rows = await this.exec.query(
      `SELECT 1 FROM ${T} WHERE ${C.customerId} = $1 AND ${C.endUserId} = $2 ` +
        `AND ${C.sourceMsgId} = $3 LIMIT 1`,
      [scope.customerId, scope.endUserId, sourceMsgId],
    );
    return nonEmpty(rows);
  }

  private async hasNearDuplicate(scope: MemoryScope, vectorLiteral: string): Promise<boolean> {
    const rows = await this.exec.query(
      `SELECT 1 FROM ${T} WHERE ${C.customerId} = $1 AND ${C.endUserId} = $2 ` +
        `AND ${C.embedding} <=> $3::vector < $4 LIMIT 1`,
      [scope.customerId, scope.endUserId, vectorLiteral, DEDUP_COSINE_DISTANCE],
    );
    return nonEmpty(rows);
  }
}

/** Kết quả rows từ executor là `unknown` → narrow phòng thủ (data DB không tin blind kiểu). */
function toRecalledFacts(rows: unknown): RecalledFact[] {
  if (!Array.isArray(rows)) return [];
  const out: RecalledFact[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const text = r[C.text];
    const type = r[C.type];
    if (typeof text !== "string" || typeof type !== "string") continue;
    out.push({ text, type, createdAt: toDate(r[C.createdAt]) });
  }
  return out;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return new Date(0);
}

function nonEmpty(rows: unknown): boolean {
  return Array.isArray(rows) && rows.length > 0;
}
