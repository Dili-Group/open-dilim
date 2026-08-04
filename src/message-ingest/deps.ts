// deps.ts — PORT I/O của message-ingest (seam DI, cùng convention flash-command/types.ts).
// Ingest KHÔNG tự mở kết nối: broker/history/dedupe inject lúc wiring. Cho test (mock port)
// + tách khỏi impl broker/state (chưa xây). Contract ở đây, impl cấp nơi khởi động.

import type { Envelope, HistoryEntry } from "../types/index.ts";

/** Ingress queue. Ingest CHỈ publish; consume/ack là của worker (broker/index.ts sau này). */
export interface Broker {
  /** XADD Envelope vào ingress. Fail → throw để gateway trả 5xx (channel retry, dedupe an toàn). */
  publish(envelope: Envelope): Promise<void>;
}

/** Short-term history phòng (§7). Append MỌI tin tại ingest → thứ tự = giờ nhận. */
export interface HistoryStore {
  append(entry: HistoryEntry): Promise<void>;
}

/**
 * Chống xử lý trùng (webhook retry). `firstSee` atomic check-and-mark; `release` trả lại key
 * khi xử lý FAIL để retry làm lại (không mất tin). Dedupe authoritative vẫn nằm ở worker.
 */
export interface Dedupe {
  /** true = msgId LẦN ĐẦU (đã mark). false = trùng → bỏ qua. */
  firstSee(channel: string, msgId: string): Promise<boolean>;
  /** Gỡ mark sau khi xử lý fail → retry của channel reprocess được. */
  release(channel: string, msgId: string): Promise<void>;
}

/** Bó port cấp cho gateway. */
export interface IngestDeps {
  readonly broker: Broker;
  readonly history: HistoryStore;
  readonly dedupe: Dedupe;
}
