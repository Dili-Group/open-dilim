// session.ts — NGẮN HẠN (§7): buffer N turn gần nhất mỗi phòng trên Redis.
//
// Vì sao Redis chứ không Postgres: đọc mỗi lượt agent, ghi mỗi tin nhắn, dữ liệu hết hạn được
// (mất buffer = mất ngữ cảnh ngắn, không mất sự thật — trí nhớ dài hạn nằm ở pgvector).
// LIST + LTRIM giữ ĐÚNG thứ tự append (giờ nhận) mà không cần sort; TTL tự dọn phòng nguội.

import type { HistoryEntry, HistoryRole } from "../types/index.ts";
import type { HistoryStore } from "../message-ingest/index.ts";
import type { HistoryReader } from "../worker/index.ts";
import type { RedisCommand } from "../redis/types.ts";

const KEY_PREFIX = "dilim:hist:";

/**
 * Cửa sổ verbatim agent đọc mỗi lượt. Ở ĐÂY (chứ không ở worker) vì compactor phải giữ nguyên
 * đúng chừng này entry cuối — hai bên lệch nhau là tin rơi vào khe giữa: agent không còn thấy
 * mà compactor cũng chưa nén.
 */
export const HISTORY_WINDOW_TURNS = 20;

/**
 * Trần turn giữ mỗi phòng. Rộng gấp đôi cửa sổ đọc: 20 entry dư là kho cho compactor gom lô
 * (nén sau mỗi ~10 tin trôi ra), không phải biên an toàn suông.
 */
export const HISTORY_BUFFER_TURNS = 40;
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
  const { conversationId, msgId, senderId, senderName, text, imageUrl, isGroup, ts, role } = raw;
  if (typeof conversationId !== "string" || conversationId === "") return null;
  if (typeof msgId !== "string" || typeof senderId !== "string" || typeof text !== "string") {
    return null;
  }
  if (typeof isGroup !== "boolean") return null;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  // Back-compat: entry cũ chưa có `role` → coi là lượt người dùng (giá trị lạ cũng về "user").
  const historyRole: HistoryRole = role === "agent" ? "agent" : "user";
  // Back-compat: entry ghi trước khi có senderName, hoặc channel không gửi tên → bỏ field.
  const name = typeof senderName === "string" && senderName !== "" ? { senderName } : {};
  // Back-compat: entry ghi trước khi có ảnh đính kèm, hoặc tin không kèm ảnh → bỏ field.
  const image = typeof imageUrl === "string" && imageUrl !== "" ? { imageUrl } : {};
  return {
    conversationId,
    msgId,
    senderId,
    ...name,
    text,
    ...image,
    isGroup,
    role: historyRole,
    ts,
  };
}

/** History phòng trên Redis. Ingest ghi (append), worker đọc (recent) — cùng 1 key. */
export class RedisHistoryStore implements HistoryStore, HistoryReader {
  constructor(private readonly send: RedisCommand) {}

  async append(entry: HistoryEntry): Promise<void> {
    const key = historyKey(entry.conversationId);
    await this.send("RPUSH", [key, JSON.stringify(entry)]);
    // Cắt đuôi + gia hạn TTL sau MỖI tin: phòng đang nói chuyện thì không bao giờ hết hạn.
    await this.send("LTRIM", [key, String(-HISTORY_BUFFER_TURNS), "-1"]);
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
