// session.ts — NGẮN HẠN (§7): buffer N turn gần nhất mỗi phòng trên Redis.
//
// Vì sao Redis chứ không Postgres: đọc mỗi lượt agent, ghi mỗi tin nhắn, dữ liệu hết hạn được
// (mất buffer = mất ngữ cảnh ngắn, không mất sự thật — trí nhớ dài hạn nằm ở pgvector).
// LIST + LTRIM giữ ĐÚNG thứ tự append (giờ nhận) mà không cần sort; TTL tự dọn phòng nguội.

import type { HistoryEntry } from "../types/index.ts";
import type { HistoryStore } from "../message-ingest/index.ts";
import type { HistoryReader } from "../worker/index.ts";
import type { RedisCommand } from "../redis/types.ts";

const KEY_PREFIX = "dilim:hist:";
/** Trần turn giữ mỗi phòng. Worker chỉ đọc ~20 turn; phần dư là biên an toàn cho compaction sau. */
const MAX_TURNS = 200;
/** Phòng im lặng quá hạn này thì buffer tự hết — hội thoại cũ không còn là ngữ cảnh đúng nữa. */
const TTL_SEC = 7 * 24 * 60 * 60;

function historyKey(conversationId: string): string {
  return `${KEY_PREFIX}${conversationId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Entry đọc từ Redis là untrusted (đổi schema, ghi tay) → sai kiểu trả null để caller bỏ qua. */
export function parseHistoryEntry(json: string): HistoryEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const { conversationId, msgId, senderId, text, isGroup, ts } = raw;
  if (typeof conversationId !== "string" || conversationId === "") return null;
  if (typeof msgId !== "string" || typeof senderId !== "string" || typeof text !== "string") {
    return null;
  }
  if (typeof isGroup !== "boolean") return null;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  return { conversationId, msgId, senderId, text, isGroup, ts };
}

/** History phòng trên Redis. Ingest ghi (append), worker đọc (recent) — cùng 1 key. */
export class RedisHistoryStore implements HistoryStore, HistoryReader {
  constructor(private readonly send: RedisCommand) {}

  async append(entry: HistoryEntry): Promise<void> {
    const key = historyKey(entry.conversationId);
    await this.send("RPUSH", [key, JSON.stringify(entry)]);
    // Cắt đuôi + gia hạn TTL sau MỖI tin: phòng đang nói chuyện thì không bao giờ hết hạn.
    await this.send("LTRIM", [key, String(-MAX_TURNS), "-1"]);
    await this.send("EXPIRE", [key, String(TTL_SEC)]);
  }

  /** N turn gần nhất, đúng thứ tự thời gian. Entry hỏng bị bỏ qua (log), không làm chết lượt. */
  async recent(conversationId: string, limit: number): Promise<HistoryEntry[]> {
    if (limit <= 0) return [];
    const raw = await this.send("LRANGE", [historyKey(conversationId), String(-limit), "-1"]);
    if (!Array.isArray(raw)) return [];
    const entries: HistoryEntry[] = [];
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const entry = parseHistoryEntry(item);
      if (entry === null) {
        console.warn(`[state] bỏ qua history entry hỏng ở phòng ${conversationId}`);
        continue;
      }
      entries.push(entry);
    }
    return entries;
  }
}
