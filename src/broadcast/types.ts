// types.ts — hợp đồng egress. Worker emit kết quả → Broadcaster gửi ngược về kênh
// (design §broadcast). Direct → DM; group → topic phòng, @ lại người hỏi.

export interface BroadcastTarget {
  readonly channel: string;
  readonly conversationId: string;
  readonly isGroup: boolean;
  /** senderId người vừa hỏi — group thì @ lại họ. */
  readonly replyToSenderId: string;
}

export interface Broadcaster {
  send(target: BroadcastTarget, text: string): Promise<void>;
}
