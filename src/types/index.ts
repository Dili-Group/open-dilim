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
export interface HistoryEntry {
  readonly conversationId: string;
  readonly msgId: string;
  readonly senderId: string;
  readonly text: string;
  readonly isGroup: boolean;
  readonly ts: number;
}
