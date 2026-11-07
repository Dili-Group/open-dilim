// thread-settings.ts — setting theo thread, bền ở Postgres (bảng thread_settings, migration 0015).
// Satisfy structurally `ThreadSettings` (message-ingest/deps.ts).
//
// Không có row = bật (mặc định). Đọc 1 lần/tin nhắm agent theo PK nên rẻ; không cache vì tắt/bật
// phải có hiệu lực ngay ở tin kế tiếp, kể cả khi chạy nhiều process.
//
// Injection: `text` chỉ ghép từ hằng schema; giá trị runtime LUÔN qua params $n.

import { THREAD_SETTINGS } from "../db/schema.ts";
import type { SqlExecutor } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const C = THREAD_SETTINGS.col;
const T = THREAD_SETTINGS.table;

const SELECT = `SELECT ${C.replyEnabled} FROM ${T} WHERE ${C.channel} = $1 AND ${C.threadId} = $2`;

const UPSERT = `INSERT INTO ${T} (${C.channel}, ${C.threadId}, ${C.replyEnabled})
  VALUES ($1, $2, $3)
  ON CONFLICT (${C.channel}, ${C.threadId})
  DO UPDATE SET ${C.replyEnabled} = EXCLUDED.${C.replyEnabled}, ${C.updatedAt} = now()`;

export class SqlThreadSettings {
  constructor(private readonly exec: SqlExecutor) {}

  async isReplyEnabled(channel: string, threadId: string): Promise<boolean> {
    const result = await this.exec.query(SELECT, [channel, threadId]);
    const row: unknown = Array.isArray(result) ? result[0] : undefined;
    if (!isRecord(row)) return true;
    // Chỉ `false` tường minh mới tắt: giá trị lạ rơi về bật còn hơn im lặng bỏ khách.
    return row[C.replyEnabled] !== false;
  }

  async setReplyEnabled(channel: string, threadId: string, enabled: boolean): Promise<void> {
    await this.exec.query(UPSERT, [channel, threadId, enabled]);
  }
}
