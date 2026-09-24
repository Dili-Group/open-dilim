// messenger.ts — Broadcaster cho kênh Facebook Page: gọi Send API của Graph API v26.0.
//
// Auth: Page Access Token (env, dài hạn) qua header Authorization — không nhét vào query để URL
// lỡ lọt vào log lỗi cũng không kèm token. KHÔNG BAO GIỜ log giá trị token.
// Chỉ chat 1-1: Messenger không có nhóm ở luồng này → `isGroup` = true là lỗi lập trình, throw.
//
// Cửa sổ 24h: `messaging_type: RESPONSE` chỉ hợp lệ trong 24h kể từ tin cuối của khách. Agent luôn
// trả lời ngay sau tin khách nên nằm trong cửa sổ; tin chủ động ngoài cửa sổ cần message tag —
// chưa làm ở đây.

import type { Broadcaster, BroadcastTarget, OutboundMedia } from "./types.ts";

const SEND_URL = "https://graph.facebook.com/v26.0/me/messages";
/** Gửi tin gọi ra Meta → cho rộng, nhưng vẫn có trần để lượt hỏng không giữ slot. */
const TIMEOUT_MS = 15_000;
const MAX_ERROR_BODY = 300;

export class MessengerBroadcaster implements Broadcaster {
  constructor(private readonly pageAccessToken: string) {}

  async send(target: BroadcastTarget, text: string): Promise<void> {
    await this.#post(target, { text });
  }

  /**
   * Ảnh (QR chuyển khoản) gửi bằng attachment trỏ URL — Meta tự tải về. Meta từ chối (URL không
   * tải được) → hạ xuống gửi link dạng text: khách vẫn mở được, hơn là làm cả lượt thành failed
   * sau khi họ đã nhận phần chữ.
   */
  async sendMedia(target: BroadcastTarget, media: OutboundMedia): Promise<void> {
    try {
      await this.#post(target, {
        attachment: { type: media.type, payload: { url: media.url, is_reusable: false } },
      });
    } catch (err) {
      console.warn(`[broadcast:messenger] gửi media hỏng, hạ xuống link text:`, err);
      const caption = media.caption === undefined ? "" : `${media.caption}\n`;
      await this.#post(target, { text: `${caption}${media.url}` });
      return;
    }
    if (media.caption !== undefined && media.caption !== "") {
      await this.#post(target, { text: media.caption });
    }
  }

  async #post(target: BroadcastTarget, message: Record<string, unknown>): Promise<void> {
    if (target.isGroup) {
      throw new Error(`[broadcast:messenger] kênh Messenger không có nhóm (${target.conversationId})`);
    }
    await callSendApi(this.pageAccessToken, {
      recipient: { id: target.conversationId },
      messaging_type: "RESPONSE",
      message,
    });
  }
}

/**
 * Một lời gọi Send API. Không 2xx → throw kèm mã lỗi Meta. Không retry: Page Access Token là
 * token tĩnh — bị từ chối (code 190) thì gọi lại cũng vậy, phải thay token trong env.
 * Dùng chung cho typing (`sender_action`) — cùng endpoint, cùng auth.
 */
export async function callSendApi(
  pageAccessToken: string,
  body: Record<string, unknown>,
  timeoutMs = TIMEOUT_MS,
): Promise<void> {
  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${pageAccessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.ok) return;
  const detail = (await res.text().catch(() => "")).slice(0, MAX_ERROR_BODY);
  throw new Error(`[broadcast:messenger] Meta trả HTTP ${res.status}: ${detail}`);
}
