// zalo-typing.ts — TypingSender thật cho kênh Zalo: POST /typing lên bridge nội bộ.
// Map TypingTarget → target bridge: threadId = conversationId (adapter đã set group→idTo,
// direct→uidFrom), threadType = isGroup ? "group" : "user".

import type { ZaloBridgeConfig } from "../config.ts";
import type { TypingSender, TypingTarget } from "./typing.ts";

// Header auth service-to-service với bridge. Sai/thiếu → bridge trả 401.
const BRIDGE_AUTH_HEADER = "x-dilim-zalo-bridge";
const TYPING_PATH = "/typing";
// Typing chỉ là nhịp cosmetic — bridge chậm bất thường thì abort, KHÔNG treo agent loop.
const TIMEOUT_MS = 3_000;

export class ZaloTypingSender implements TypingSender {
  private readonly endpoint: string;
  private readonly secret: string;

  constructor(config: ZaloBridgeConfig) {
    this.endpoint = `${config.baseUrl.replace(/\/$/, "")}${TYPING_PATH}`;
    this.secret = config.secret;
  }

  async typing(target: TypingTarget): Promise<void> {
    const threadType = target.isGroup ? "group" : "user";
    // best-effort: hỏng (network/timeout/bridge từ chối) → log warn, KHÔNG throw. Nuốt CÓ CHỦ
    // ĐÍCH ở biên impl (hợp đồng TypingSender không throw cho tín hiệu cosmetic) — lượt trả lời
    // không được chết vì cái chấm "đang gõ".
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          [BRIDGE_AUTH_HEADER]: this.secret,
          "content-type": "application/json",
        },
        body: JSON.stringify({ threadId: target.conversationId, threadType }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(
          `[typing:zalo] bridge trả ${res.status} (${threadType}/${target.conversationId})`,
        );
      }
    } catch (err) {
      console.warn(`[typing:zalo] gửi hỏng (${threadType}/${target.conversationId}):`, err);
    }
  }
}
