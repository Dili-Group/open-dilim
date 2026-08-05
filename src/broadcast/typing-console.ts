// typing-console.ts — TypingSender dev: in nhịp "đang gõ" ra stdout thay vì gọi API kênh thật.
// Sender thật per-channel (Zalo/Messenger/web) là adapter riêng sau này, đăng ký vào TypingFactory.

import type { TypingSender, TypingTarget } from "./typing.ts";

export class ConsoleTypingSender implements TypingSender {
  typing(target: TypingTarget): Promise<void> {
    console.log(`[typing:${target.channel}/${target.conversationId}] …đang xử lý`);
    return Promise.resolve();
  }
}
