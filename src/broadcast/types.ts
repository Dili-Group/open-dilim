// types.ts — hợp đồng egress. Worker emit kết quả → Broadcaster gửi ngược về kênh
// (design §broadcast). Direct → DM; group → topic phòng, @ lại người hỏi.

export interface BroadcastTarget {
  readonly channel: string;
  readonly conversationId: string;
  readonly isGroup: boolean;
  /** senderId người vừa hỏi — group thì @ lại họ. */
  readonly replyToSenderId: string;
}

/** Nội dung media gửi đi — `type` quyết định endpoint bridge (ảnh vs file khác nhau). */
export interface OutboundMedia {
  readonly type: "image" | "file";
  readonly url: string;
  readonly caption?: string;
}

export interface Broadcaster {
  send(target: BroadcastTarget, text: string): Promise<void>;
  sendMedia(target: BroadcastTarget, media: OutboundMedia): Promise<void>;
}
