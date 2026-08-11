// types.ts — port worker cần từ nơi khởi động (bootstrap). Broker/history đọc qua port này,
// không bind impl in-mem/Redis. Đổi hạ tầng chỉ sửa bootstrap.

import type { Envelope, HistoryEntry } from "../types/index.ts";
import type { GroupCustomerLookup, IdentityResolver } from "../auth/types.ts";
import type { MemoryWriterLookup } from "../state/types.ts";
import type { ConversationCompactor, SummaryReader } from "../state/compactor.ts";
import type { AgentRegistry } from "../agents/registry.ts";
import type { Broadcaster } from "../broadcast/types.ts";
import type { TypingFactory } from "../broadcast/typing-factory.ts";
import type { FlashRegistry } from "../flash-command/registry.ts";
import type { AnnounceApprovalPort } from "../announcements/types.ts";
import type { IdentityRepo, OpsPort } from "../flash-command/types.ts";
import type { JobAdmin } from "../scheduler/types.ts";
import type { WorkflowPort } from "../workflows/service.ts";

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

/**
 * Đầu ĐỌC của vạch "tin hội thoại mới nhất phòng" (đầu ghi = `TurnMarker` của message-ingest, cùng
 * một instance). Pool soi vạch để bỏ lượt đã lỗi thời — xem `burst.ts`.
 */
export interface LatestTurnReader {
  /** Event time (ms) của tin mới nhất. undefined = chưa có vạch (hoặc đã hết hạn). */
  latestTs(channel: string, conversationId: string): Promise<number | undefined>;
}

/** Đọc history phòng (STATE bước 7). */
export interface HistoryReader {
  recent(conversationId: string, limit: number): Promise<HistoryEntry[]>;
}

/** Ghi history phòng — flash reply append lượt agent. CÙNG instance với HistoryReader (append+recent). */
export interface HistoryWriter {
  append(entry: HistoryEntry): Promise<void>;
}

/** Service 1 worker cần để xử lý 1 envelope. */
export interface WorkerContext {
  readonly history: HistoryReader;
  /** Ghi flash reply vào history (lượt agent). CÙNG instance với `history`. */
  readonly historyWriter: HistoryWriter;
  readonly identity: IdentityResolver;
  /** Nhận diện + chạy flash command (`/lệnh`) TRƯỚC agent — side-effect, không qua LLM. */
  readonly flash: FlashRegistry;
  /** Port ghi định danh (user_binding/group_map/group_member) cho flash command. */
  readonly identityRepo: IdentityRepo;
  /** Port hệ vận hành (verify token, tra đại lý) cho flash command. */
  readonly ops: OpsPort;
  /** Port quản job cron của phòng (`/lich`) — flash command dùng, agent KHÔNG chạm. */
  readonly jobs: JobAdmin;
  /**
   * Cửa duyệt tin phát toàn hệ đại lý (`/duyet-thongbao`) — flash command dùng, agent KHÔNG chạm.
   * undefined = chưa wiring → lệnh duyệt trả lỗi, không mặc định cho qua.
   */
  readonly announceApprovals?: AnnounceApprovalPort;
  /**
   * Tra chủ sở hữu phòng để dựng MemoryScope (memory thuộc PHÒNG, không thuộc người gõ).
   * undefined = chưa nối tầng memory → lượt chạy không có trí nhớ dài hạn, không phải lỗi.
   */
  readonly groupCustomer?: GroupCustomerLookup;
  /**
   * Đường ghi trí nhớ dài hạn sau lượt (distill theo lô → embed → pgvector), TRA THEO AGENT vừa
   * chạy: mỗi agent chưng cất bằng `memorySpec` của nó.
   * undefined = chạy không có trí nhớ dài hạn (thiếu GEMINI_API_KEY), không phải lỗi.
   */
  readonly memoryWriters?: MemoryWriterLookup;
  /**
   * Nén hội thoại ngắn hạn: đọc bản tóm ở bước STATE, nén lại sau lượt. Theo conversationId nên
   * chạy cho MỌI phòng — kể cả phòng chưa bind (không có MemoryScope, không distill được).
   * undefined = chạy không có nén, phần trôi khỏi cửa sổ mất luôn.
   */
  readonly compactor?: ConversationCompactor;
  readonly summaries?: SummaryReader;
  readonly agents: AgentRegistry;
  readonly broadcaster: Broadcaster;
  /** Chọn TypingSender theo channel để phát nhịp "đang xử lý" mỗi bước agent. */
  readonly typing: TypingFactory;
  /**
   * Việc treo chờ nhóm này trả lời (§6) — worker nạp vào ngữ cảnh MỖI lượt của nhóm, để câu trả
   * lời đến sau 1-2 ngày vẫn khớp được việc (cửa sổ history đã trôi mất câu hỏi từ lâu).
   * undefined = chưa nối tầng workflows → lượt chạy không có khối đó, không phải lỗi.
   */
  readonly workflow?: WorkflowPort;
}

/** Bó đầy đủ để start pool: context + nguồn queue + số worker. */
export interface WorkerPoolDeps extends WorkerContext {
  readonly broker: BrokerConsumer;
  readonly workerCount: number;
  /** Deadline một lượt (ms). Quá hạn → abort signal của lượt → handleEnvelope trả `failed`. */
  readonly turnTimeoutMs: number;
  /**
   * Vạch tin mới nhất phòng — pool soi để gom tin gửi liên tiếp thành một lượt (`burst.ts`).
   * undefined = mỗi tin một lượt agent (hành vi cũ), không chặn boot.
   */
  readonly turns?: LatestTurnReader;
  /** Cửa sổ chờ tin kế (ms). undefined = `BURST_WINDOW_MS`. */
  readonly burstWindowMs?: number;
}
