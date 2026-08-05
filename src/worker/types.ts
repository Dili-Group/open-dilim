// types.ts — port worker cần từ nơi khởi động (bootstrap). Broker/history đọc qua port này,
// không bind impl in-mem/Redis. Đổi hạ tầng chỉ sửa bootstrap.

import type { Envelope, HistoryEntry } from "../types/index.ts";
import type { GroupCustomerLookup, IdentityResolver } from "../auth/types.ts";
import type { AgentRegistry } from "../agents/registry.ts";
import type { Broadcaster } from "../broadcast/types.ts";
import type { TypingFactory } from "../broadcast/typing-factory.ts";

/**
 * 1 message đã giao cho worker, kèm quyền định đoạt: `ack` = xong, gỡ khỏi queue; `retryLater` =
 * để lại cho lượt sau. Cặp này là LÝ DO take() không trả thẳng Envelope — không có ack thì
 * process chết giữa lượt là mất tin, mà ack ngay lúc nhận thì lỗi tạm thời cũng mất tin.
 */
export interface Delivery {
  readonly envelope: Envelope;
  /** Xử lý xong (kể cả kết cục nghiệp vụ không trả lời) → không giao lại nữa. */
  ack(): Promise<void>;
  /** Lượt này hỏng → không ack, để broker giao lại; quá số lần cho phép thì broker đẩy DLQ. */
  retryLater(): Promise<void>;
}

/** Đầu consume của broker (worker đọc). Ing.publish nằm ở port Broker của message-ingest. */
export interface BrokerConsumer {
  take(signal?: AbortSignal): Promise<Delivery | null>;
}

/** Đọc history phòng (STATE bước 7). */
export interface HistoryReader {
  recent(conversationId: string, limit: number): Promise<HistoryEntry[]>;
}

/** Service 1 worker cần để xử lý 1 envelope. */
export interface WorkerContext {
  readonly history: HistoryReader;
  readonly identity: IdentityResolver;
  /**
   * Tra chủ sở hữu phòng để dựng MemoryScope (memory thuộc PHÒNG, không thuộc người gõ).
   * undefined = chưa nối tầng memory → lượt chạy không có trí nhớ dài hạn, không phải lỗi.
   */
  readonly groupCustomer?: GroupCustomerLookup;
  readonly agents: AgentRegistry;
  readonly broadcaster: Broadcaster;
  /** Chọn TypingSender theo channel để phát nhịp "đang xử lý" mỗi bước agent. */
  readonly typing: TypingFactory;
}

/** Bó đầy đủ để start pool: context + nguồn queue + số worker. */
export interface WorkerPoolDeps extends WorkerContext {
  readonly broker: BrokerConsumer;
  readonly workerCount: number;
}
