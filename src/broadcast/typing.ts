// typing.ts — hợp đồng "đang gõ". Song song Broadcaster nhưng KHÁC bản chất: broadcast gửi
// KẾT QUẢ (1 lần, phải tới); typing gửi TÍN HIỆU tiến trình (nhiều nhịp, best-effort). Vì thế
// tách interface riêng — hỏng typing KHÔNG được tính là hỏng lượt.

export interface TypingTarget {
  readonly channel: string;
  readonly conversationId: string;
  readonly isGroup: boolean;
}

/**
 * Gửi 1 nhịp "agent đang xử lý" tới hội thoại. Mỗi kênh (Zalo/Messenger/web) tự map sang API
 * riêng của nó (Zalo: sendTypingEvent...). Best-effort: impl KHÔNG throw ra ngoài cho tín hiệu
 * cosmetic — caller (loop) vẫn bọc phòng hờ.
 */
export interface TypingSender {
  typing(target: TypingTarget): Promise<void>;
}
