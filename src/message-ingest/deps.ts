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

/**
 * Vạch "ai vừa nói trong phòng này". Ingest là nơi DUY NHẤT thấy mọi tin (tin không nhắm agent
 * không bao giờ tới worker), nên phát hiện đổi người nói phải nằm ở đây.
 *
 * `swap` đổi chỗ nguyên tử: ghi người vừa nói, trả về người nói TRƯỚC đó. Một lượt đi-về Redis,
 * và hai process cùng nhận tin của một phòng không cùng đọc ra một giá trị cũ.
 */
export interface SpeakerTracker {
  /** Trả senderId của tin liền trước trong phòng. undefined = tin đầu (hoặc vạch đã hết hạn). */
  swap(channel: string, conversationId: string, senderId: string): Promise<string | undefined>;
}

/**
 * Vạch "tin hội thoại mới nhất của phòng" (EVENT TIME, ms). Ingest nâng vạch mỗi tin nhắm agent;
 * worker soi lại để bỏ lượt đã lỗi thời khi người dùng gõ liền mấy tin — xem `worker/burst.ts`.
 *
 * Chỉ nâng cho tin `isSupersedable` (xem `ingestor.ts`): một `/lệnh` đè lên tin thường là nuốt câu
 * hỏi của khách.
 */
export interface TurnMarker {
  mark(channel: string, conversationId: string, ts: number): Promise<void>;
}

/** Bó port cấp cho gateway. */
export interface IngestDeps {
  readonly broker: Broker;
  readonly history: HistoryStore;
  readonly dedupe: Dedupe;
  /**
   * undefined = không gom tin gửi liên tiếp → mỗi tin một lượt agent (hành vi cũ).
   * Không chặn boot: thiếu cổng này agent vẫn trả lời đủ, chỉ trả lời rời từng tin.
   */
  readonly turns?: TurnMarker;
  /**
   * undefined = không theo dõi đổi người nói → chỉ chưng cất ở cuối lượt agent (hành vi cũ).
   * Không chặn boot: thiếu cổng này agent vẫn chạy, chỉ kém dữ liệu về nhóm chưa bind.
   */
  readonly speakers?: SpeakerTracker;
}
