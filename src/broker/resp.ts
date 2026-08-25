// resp.ts — narrow reply Redis (untrusted, shape khác nhau giữa RESP2/RESP3) thành type của
// mình. Thuần, không I/O → test được không cần server.
//
// XREADGROUP: RESP2 trả mảng `[[stream, entries], ...]`, RESP3 trả map `{stream: entries}`.
// Bun dùng RESP3 nhưng client có thể đổi/downgrade → nhận CẢ HAI, đừng đoán một dạng.

import type { Envelope, MessageSource, Mention } from "../types/index.ts";

/** 1 entry trong stream: id Redis + payload JSON ở field `data`. */
export interface StreamEntry {
  readonly id: string;
  readonly data: string;
}

/** 1 dòng XPENDING: id + số lần đã giao (để quyết định retry hay DLQ). */
export interface PendingEntry {
  readonly id: string;
  readonly deliveries: number;
}

// Khai string[] (không MessageSource[]) để `includes(unknown-narrowed-string)` không cần ép kiểu.
const SOURCES: readonly string[] = ["channel", "cron", "distill", "proactive"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lấy value của 1 field trong entry (RESP2: mảng xen kẽ f,v; RESP3: map). */
function fieldValue(fields: unknown, name: string): string | undefined {
  if (Array.isArray(fields)) {
    for (let i = 0; i + 1 < fields.length; i += 2) {
      if (fields[i] !== name) continue;
      const value: unknown = fields[i + 1];
      return typeof value === "string" ? value : undefined;
    }
    return undefined;
  }
  if (isRecord(fields)) {
    const value = fields[name];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

/** Reply dạng danh sách entry (XCLAIM, XRANGE, hoặc phần entries của XREADGROUP). */
export function parseEntries(raw: unknown, field: string): StreamEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: StreamEntry[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const id: unknown = item[0];
    if (typeof id !== "string") continue;
    const data = fieldValue(item[1], field);
    if (data === undefined) continue;
    entries.push({ id, data });
  }
  return entries;
}

/** Reply XREADGROUP. null (BLOCK timeout) → rỗng, không phải lỗi. */
export function parseReadReply(raw: unknown, field: string): StreamEntry[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    // RESP2: mỗi phần tử là [streamName, entries]. Chỉ đọc 1 stream nên gộp hết.
    return raw.flatMap((stream) =>
      Array.isArray(stream) && stream.length >= 2 ? parseEntries(stream[1], field) : [],
    );
  }
  if (isRecord(raw)) return Object.values(raw).flatMap((entries) => parseEntries(entries, field));
  return [];
}

/** Reply XPENDING dạng chi tiết: `[id, consumer, idleMs, deliveries]`. */
export function parsePending(raw: unknown): PendingEntry[] {
  if (!Array.isArray(raw)) return [];
  const pending: PendingEntry[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const id: unknown = row[0];
    const deliveries: unknown = row[3];
    if (typeof id !== "string") continue;
    const count = typeof deliveries === "number" ? deliveries : Number(deliveries);
    if (!Number.isFinite(count)) continue;
    pending.push({ id, deliveries: count });
  }
  return pending;
}

function parseMentions(raw: unknown): readonly Mention[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const mentions: Mention[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.uid !== "string") return undefined;
    mentions.push({ uid: item.uid });
  }
  return mentions;
}

/**
 * Envelope từ payload stream. Dữ liệu đã qua network/lưu trữ → validate ĐỦ field, sai kiểu trả
 * null (caller đẩy DLQ) thay vì để `undefined` chui vào tận agent loop.
 */
export function parseEnvelope(json: string): Envelope | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const {
    source,
    channel,
    msgId,
    conversationId,
    senderId,
    isGroup,
    addressedToAgent,
    text,
    ts,
  } = raw;
  const mentions = parseMentions(raw.mentions);
  if (typeof source !== "string" || !SOURCES.includes(source)) return null;
  // Đã lọc qua SOURCES ở trên → ép về union là an toàn, và KHÔNG được viết dạng ternary
  // ("x === a ? a : b") vì nguồn thứ ba sẽ bị đổi thầm thành "channel".
  const messageSource = source as MessageSource;
  if (typeof channel !== "string" || channel === "") return null;
  if (typeof msgId !== "string" || msgId === "") return null;
  if (typeof conversationId !== "string" || conversationId === "") return null;
  if (typeof senderId !== "string") return null;
  if (typeof isGroup !== "boolean" || typeof addressedToAgent !== "boolean") return null;
  if (typeof text !== "string") return null;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  if (mentions === undefined) return null;
  return {
    ...raw,
    source: messageSource,
    channel,
    msgId,
    conversationId,
    senderId,
    isGroup,
    addressedToAgent,
    text,
    mentions,
    ts,
  };
}
