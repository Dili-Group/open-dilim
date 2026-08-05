// index.ts — type dùng chung xuyên tầng (ingest → broker → worker → broadcast).
// KHÔNG import tầng feature nào → không tạo cycle. Đây là đáy của đồ thị phụ thuộc.

/** Nguồn tin. cron KHÔNG qua gateway/ACK (scheduler dựng thẳng Envelope). */
export type MessageSource = "channel" | "cron";

/**
 * Mention entity từ payload channel (vd Zalo `mentions[]`). `uid` = id người/agent được nhắc.
 * LẤY TỪ ENTITY, không regex tên trong text (trùng tên / đổi tên → sai người).
 */
export type Mention = { uid: string };

/**
 * Bản tin đã chuẩn hóa — hợp đồng RA khỏi message-ingest, đi tiếp broker → worker → broadcast.
 * Chỉ dữ liệu chuẩn hóa: KHÔNG mang raw payload / secret. `senderId` CHƯA resolve vai — worker
 * làm ở bước AUTH (§5). `isGroup`/`addressedToAgent` chỉ đổi HÀNH VI, KHÔNG cấp quyền.
 */
export interface Envelope {
  readonly source: MessageSource;
  readonly channel: string;
  readonly msgId: string;          // idempotency + audit
  readonly conversationId: string; // phòng: key state/history/order-lock
  readonly senderId: string;       // người gửi → worker resolve vai
  readonly isGroup: boolean;
  readonly addressedToAgent: boolean; // kết quả trigger gate (§5 bước 2)
  readonly text: string;
  readonly mentions: readonly Mention[];
  readonly ts: number;             // event time (ms epoch)
}

/**
 * 1 lượt ghi vào history phòng (short-term, §7). Append MỌI tin tại ingest theo giờ nhận →
 * group đa speaker giữ đúng trình tự (không phụ thuộc lúc worker chạy).
 */
/** Ai nói lượt này: người dùng, hay chính agent (flash reply / lượt agent). Quyết định render. */
export type HistoryRole = "user" | "agent";

/**
 * senderId placeholder cho lượt agent trong history: `role="agent"` đã phân biệt vai, render lượt
 * agent bỏ qua senderId (không prefix speaker) → giá trị chỉ để lấp field bắt buộc.
 */
export const AGENT_SENDER_ID = "agent";

export interface HistoryEntry {
  readonly conversationId: string;
  readonly msgId: string;
  readonly senderId: string;
  readonly text: string;
  readonly isGroup: boolean;
  /** Người dùng gõ (ingest) hay agent trả (flash reply / lượt agent). Thiếu ở entry cũ → coi là user. */
  readonly role: HistoryRole;
  readonly ts: number;
}

/**
 * Bước trong life cycle §5 nơi lượt xử lý dừng. Có TÊN để log/audit phân biệt được hỏng ở AUTH
 * (không resolve nổi vai) với hỏng ở BROADCAST (kênh chết) — một `catch` chung nuốt hết thì hai
 * cái đó nhìn y hệt nhau.
 */
export type LifecycleStep = "auth" | "state" | "agent" | "broadcast";

/**
 * Kết quả 1 lượt worker chạy 1 Envelope (§1 "worker → emit AgentResult"). Union RỜI RẠC vì 3 kết
 * cục khác BẢN CHẤT, không phải "text + mấy cái cờ":
 *  - reply     : có text cho người dùng → broadcast (§5 bước 9).
 *  - suspended : chạm approval gate (§6) → pending_action đã lưu + yêu cầu duyệt đã phát bởi gate,
 *                worker THOÁT, lượt này KHÔNG có text trả. Chỉ mang `approvalId` — phần còn lại của
 *                pending_action nằm ở DB, không ai phía trên đọc.
 *  - failed    : lượt hỏng, KHÔNG có text hợp lệ để gửi. Lỗi là GIÁ TRỊ, không phải exception →
 *                caller buộc phải narrow union trước khi chạm `.text`.
 */
export type AgentResult =
  | { readonly status: "reply"; readonly text: string }
  | { readonly status: "suspended"; readonly approvalId: string }
  | { readonly status: "failed"; readonly step: LifecycleStep; readonly error: Error };
