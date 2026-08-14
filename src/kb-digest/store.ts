// store.ts — SqlKbDigestStore: toàn bộ Postgres của tầng kb-digest. SqlExecutor inject → test
// bằng FakeExec, không cần DB thật. `text` chỉ ghép từ hằng schema; giá trị runtime LUÔN qua $n.

import {
  KB_DIGEST_RUN,
  KB_PROPOSAL,
  KB_REVIEW_CONFIG,
  KbDigestRunStatus,
  KbProposalStatus,
  MESSAGE_LOG,
  USER_BINDING,
} from "../db/schema.ts";
import type { SqlExecutor } from "../state/types.ts";
import type { KbDigestStore, KbLoggedMessage, KbPendingProposal, KbReviewConfig } from "./types.ts";

const KC = KB_REVIEW_CONFIG.col;
const KR = KB_DIGEST_RUN.col;
const KP = KB_PROPOSAL.col;
const ML = MESSAGE_LOG.col;
const UB = USER_BINDING.col;

/** Bảng đơn row — mọi upsert/get đều ghim vào khoá này. */
const CONFIG_ID = "main";

/** Độ dài mã ngắn đề xuất — 8 ký tự đầu uuid, cùng chuẩn với /lich (scheduler SHORT_ID_LENGTH). */
export const KB_SHORT_ID_LENGTH = 8;

export class SqlKbDigestStore implements KbDigestStore {
  constructor(private readonly exec: SqlExecutor) {}

  async getConfig(): Promise<KbReviewConfig | undefined> {
    const rows = asRows(
      await this.exec.query(
        `SELECT ${KC.channel}, ${KC.conversationId}, ${KC.runTime}, ${KC.enabled}
           FROM ${KB_REVIEW_CONFIG.table} WHERE ${KC.id} = $1`,
        [CONFIG_ID],
      ),
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const channel = str(row[KC.channel]);
    const conversationId = str(row[KC.conversationId]);
    const runTime = str(row[KC.runTime]);
    if (channel === undefined || conversationId === undefined || runTime === undefined) {
      return undefined;
    }
    return { channel, conversationId, runTime, enabled: row[KC.enabled] === true };
  }

  async upsertConfig(p: {
    channel: string;
    conversationId: string;
    runTime: string;
    createdBy: string;
  }): Promise<void> {
    await this.exec.query(
      `INSERT INTO ${KB_REVIEW_CONFIG.table}
         (${KC.id}, ${KC.channel}, ${KC.conversationId}, ${KC.runTime}, ${KC.enabled}, ${KC.createdBy})
       VALUES ($1, $2, $3, $4, true, $5)
       ON CONFLICT (${KC.id}) DO UPDATE SET
         ${KC.channel} = EXCLUDED.${KC.channel},
         ${KC.conversationId} = EXCLUDED.${KC.conversationId},
         ${KC.runTime} = EXCLUDED.${KC.runTime},
         ${KC.enabled} = true,
         ${KC.createdBy} = EXCLUDED.${KC.createdBy},
         ${KC.updatedAt} = now()`,
      [CONFIG_ID, p.channel, p.conversationId, p.runTime, p.createdBy],
    );
  }

  async staffActiveGroups(p: {
    channel: string;
    startMs: number;
    endMs: number;
    excludeConversationId: string;
  }): Promise<string[]> {
    // JOIN lõi của tính năng: group có ít nhất MỘT tin của nhân viên active trong ngày.
    // user_binding PK (channel, sender_id) → mỗi tin một probe index; dải ts ăn BRIN.
    const rows = asRows(
      await this.exec.query(
        `SELECT DISTINCT ml.${ML.conversationId} AS conversation_id
           FROM ${MESSAGE_LOG.table} ml
           JOIN ${USER_BINDING.table} ub
             ON ub.${UB.channel} = ml.${ML.channel}
            AND ub.${UB.senderId} = ml.${ML.senderId}
            AND ub.${UB.revokedAt} IS NULL
          WHERE ml.${ML.channel} = $1
            AND ml.${ML.isGroup}
            AND ml.${ML.ts} >= $2 AND ml.${ML.ts} < $3
            AND ml.${ML.conversationId} <> $4`,
        [p.channel, p.startMs, p.endMs, p.excludeConversationId],
      ),
    );
    return rows.map((row) => str(row.conversation_id)).filter((id): id is string => id !== undefined);
  }

  async messagesForDay(p: {
    channel: string;
    conversationId: string;
    startMs: number;
    endMs: number;
  }): Promise<KbLoggedMessage[]> {
    const rows = asRows(
      await this.exec.query(
        `SELECT ${ML.senderId}, ${ML.senderName}, ${ML.text}, ${ML.ts}
           FROM ${MESSAGE_LOG.table}
          WHERE ${ML.channel} = $1 AND ${ML.conversationId} = $2
            AND ${ML.ts} >= $3 AND ${ML.ts} < $4
          ORDER BY ${ML.ts} ASC`,
        [p.channel, p.conversationId, p.startMs, p.endMs],
      ),
    );
    const messages: KbLoggedMessage[] = [];
    for (const row of rows) {
      const senderId = str(row[ML.senderId]);
      const text = str(row[ML.text]);
      const ts = num(row[ML.ts]);
      if (senderId === undefined || text === undefined || ts === undefined) continue;
      const senderName = str(row[ML.senderName]);
      messages.push({ senderId, text, ts, ...(senderName === undefined ? {} : { senderName }) });
    }
    return messages;
  }

  async claimRun(day: string, conversationId: string): Promise<boolean> {
    const rows = asRows(
      await this.exec.query(
        `INSERT INTO ${KB_DIGEST_RUN.table} (${KR.day}, ${KR.conversationId}, ${KR.status})
         VALUES ($1, $2, $3)
         ON CONFLICT (${KR.day}, ${KR.conversationId}) DO NOTHING
         RETURNING ${KR.conversationId}`,
        [day, conversationId, KbDigestRunStatus.Running],
      ),
    );
    return rows.length > 0;
  }

  async finishRun(day: string, conversationId: string, status: KbDigestRunStatus): Promise<void> {
    await this.exec.query(
      `UPDATE ${KB_DIGEST_RUN.table}
          SET ${KR.status} = $3, ${KR.finishedAt} = now()
        WHERE ${KR.day} = $1 AND ${KR.conversationId} = $2`,
      [day, conversationId, status],
    );
  }

  async insertProposals(p: {
    day: string;
    channel: string;
    conversationId: string;
    facts: readonly string[];
  }): Promise<string[]> {
    // Tuần tự cho đơn giản: mỗi ngày mỗi group vài fact, không đáng bó batch.
    const ids: string[] = [];
    for (const fact of p.facts) {
      const rows = asRows(
        await this.exec.query(
          `INSERT INTO ${KB_PROPOSAL.table}
             (${KP.day}, ${KP.channel}, ${KP.conversationId}, ${KP.factText})
           VALUES ($1, $2, $3, $4)
           RETURNING ${KP.id}`,
          [p.day, p.channel, p.conversationId, fact],
        ),
      );
      const id = str(rows[0]?.[KP.id]);
      if (id === undefined) throw new Error("insert kb_proposal không trả id");
      ids.push(id);
    }
    return ids;
  }

  async listPending(): Promise<KbPendingProposal[]> {
    const rows = asRows(
      await this.exec.query(
        `SELECT ${KP.id}, ${KP.day}, ${KP.factText}, ${KP.createdAt}
           FROM ${KB_PROPOSAL.table} WHERE ${KP.status} = $1
          ORDER BY ${KP.createdAt} ASC`,
        [KbProposalStatus.Pending],
      ),
    );
    const items: KbPendingProposal[] = [];
    for (const row of rows) {
      const id = str(row[KP.id]);
      const factText = str(row[KP.factText]);
      if (id === undefined || factText === undefined) continue;
      items.push({
        id,
        factText,
        day: dayStr(row[KP.day]),
        createdAt: row[KP.createdAt] instanceof Date ? (row[KP.createdAt] as Date) : new Date(0),
      });
    }
    return items;
  }

  async findPendingByShortId(
    shortId: string,
  ): Promise<{ kind: "found"; id: string; factText: string } | { kind: "not_found" } | { kind: "ambiguous" }> {
    // Prefix trên uuid dạng text; chỉ trong pending nên quét index partial là đủ nhỏ.
    const rows = asRows(
      await this.exec.query(
        `SELECT ${KP.id}, ${KP.factText}
           FROM ${KB_PROPOSAL.table}
          WHERE ${KP.status} = $1 AND left(${KP.id}::text, ${KB_SHORT_ID_LENGTH}) = $2
          LIMIT 2`,
        [KbProposalStatus.Pending, shortId.toLowerCase()],
      ),
    );
    if (rows.length === 0) return { kind: "not_found" };
    if (rows.length > 1) return { kind: "ambiguous" };
    const id = str(rows[0]?.[KP.id]);
    const factText = str(rows[0]?.[KP.factText]);
    if (id === undefined || factText === undefined) return { kind: "not_found" };
    return { kind: "found", id, factText };
  }

  async decide(id: string, status: KbProposalStatus, decidedBy: string): Promise<boolean> {
    // Chỉ quyết được row còn pending — hai người duyệt cùng lúc thì một người thắng, một người
    // nhận "đã quyết rồi", không ghi đè quyết định của nhau.
    const rows = asRows(
      await this.exec.query(
        `UPDATE ${KB_PROPOSAL.table}
            SET ${KP.status} = $2, ${KP.decidedBy} = $3, ${KP.decidedAt} = now()
          WHERE ${KP.id} = $1 AND ${KP.status} = $4
          RETURNING ${KP.id}`,
        [id, status, decidedBy, KbProposalStatus.Pending],
      ),
    );
    return rows.length > 0;
  }
}

// ── narrow row untrusted (Bun.sql trả unknown) ──────────────────────────────

function asRows(result: unknown): Record<string, unknown>[] {
  if (!Array.isArray(result)) return [];
  return result.filter(
    (row): row is Record<string, unknown> => typeof row === "object" && row !== null,
  );
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // ts bigint: Bun có thể trả string/bigint tuỳ giá trị — nhận cả hai, vẫn là số nguyên ms.
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value !== "" && !Number.isNaN(Number(value))) return Number(value);
  return undefined;
}

/** Cột date: Bun trả Date hoặc string tuỳ driver — chuẩn về 'YYYY-MM-DD'. */
function dayStr(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return "";
}
