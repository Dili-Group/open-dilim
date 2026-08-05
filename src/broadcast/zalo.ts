// zalo.ts — Broadcaster thật cho kênh Zalo: POST /send lên bridge nội bộ (cùng bridge với typing).
// Map BroadcastTarget → body bridge: threadId = conversationId (adapter ingest đã set group→idTo,
// direct→uidFrom), threadType = isGroup ? "group" : "user".
//
// KHÁC ZaloTypingSender: gửi hỏng phải THROW. Typing là tín hiệu cosmetic nên nuốt được, còn đây
// là câu trả lời — nuốt lỗi = người dùng ngồi chờ mãi mà worker báo "xong".

import type { ZaloBridgeConfig } from "../config.ts";
import type { Broadcaster, BroadcastTarget } from "./types.ts";

// Header auth service-to-service với bridge. Sai/thiếu → bridge trả 401.
const BRIDGE_AUTH_HEADER = "x-dilim-zalo-bridge";
const SEND_PATH = "/send";
// Gửi tin nặng hơn typing (bridge phải gọi Zalo) → cho rộng hơn, nhưng vẫn có trần để lượt hỏng
// không giữ worker slot vô hạn.
const TIMEOUT_MS = 15_000;

export class ZaloBroadcaster implements Broadcaster {
  private readonly endpoint: string;
  private readonly secret: string;

  constructor(config: ZaloBridgeConfig) {
    this.endpoint = `${config.baseUrl.replace(/\/$/, "")}${SEND_PATH}`;
    this.secret = config.secret;
  }

  async send(target: BroadcastTarget, text: string): Promise<void> {
    const threadType = target.isGroup ? "group" : "user";
    // mentions/quote bỏ trống: mention chỉ highlight khi offset trỏ đúng token "@Tên hiển thị",
    // mà Envelope không mang tên hiển thị của người gửi. Sai offset thì Zalo gửi text trơn và
    // KHÔNG báo lỗi → thà gửi text trơn có chủ đích còn hơn đoán offset.
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        [BRIDGE_AUTH_HEADER]: this.secret,
        "content-type": "application/json",
      },
      body: JSON.stringify({ threadId: target.conversationId, threadType, message: text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // Body lỗi của bridge là `{ ok:false, error }` — kèm vào message để log biết Zalo từ chối
      // vì gì. Đọc hỏng cũng không được che mất status.
      const detail = await res.text().catch(() => "");
      throw new Error(
        `[broadcast:zalo] bridge trả ${res.status} (${threadType}/${target.conversationId})${
          detail === "" ? "" : `: ${detail}`
        }`,
      );
    }
  }
}
