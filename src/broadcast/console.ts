// console.ts — Broadcaster dev: in reply ra stdout thay vì gửi kênh thật. Egress thật (Zalo/
// Messenger/web) là adapter riêng sau này. Chỉ dùng local để thấy agent chạy end-to-end.

import type { Broadcaster, BroadcastTarget } from "./types.ts";

export class ConsoleBroadcaster implements Broadcaster {
  send(target: BroadcastTarget, text: string): Promise<void> {
    const at = target.isGroup ? `@${target.replyToSenderId} ` : "";
    console.log(`[broadcast:${target.channel}/${target.conversationId}] ${at}${text}`);
    return Promise.resolve();
  }
}
