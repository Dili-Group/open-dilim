// messenger-typing.ts — TypingSender cho kênh Facebook Page: Send API `sender_action: typing_on`.
// Meta tự tắt chấm "đang gõ" sau ~20s hoặc khi tin thật tới, nên không cần gửi `typing_off`.

import { callSendApi } from "./messenger.ts";
import type { TypingSender, TypingTarget } from "./typing.ts";

// Typing chỉ là nhịp cosmetic — Meta chậm bất thường thì abort, KHÔNG treo agent loop.
const TIMEOUT_MS = 3_000;

export class MessengerTypingSender implements TypingSender {
  constructor(private readonly pageAccessToken: string) {}

  async typing(target: TypingTarget): Promise<void> {
    // best-effort: hỏng → log warn, KHÔNG throw (hợp đồng TypingSender). Lượt trả lời không được
    // chết vì cái chấm "đang gõ".
    try {
      await callSendApi(
        this.pageAccessToken,
        { recipient: { id: target.conversationId }, sender_action: "typing_on" },
        TIMEOUT_MS,
      );
    } catch (err) {
      console.warn(`[typing:messenger] gửi hỏng (${target.conversationId}):`, err);
    }
  }
}
