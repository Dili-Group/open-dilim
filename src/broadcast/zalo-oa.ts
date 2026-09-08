// zalo-oa.ts — Broadcaster cho kênh Official Account: gọi thẳng Zalo Open API v3, KHÔNG qua bridge
// zca-js (bridge là của tài khoản Zalo cá nhân, OA là hệ khác hẳn).
//
// Auth: header `access_token` — lấy qua ZaloOaTokenPort (backend DILIM giữ refresh_token).
// Chỉ chat 1-1: OA không có nhóm ở luồng này → `isGroup` = true là lỗi lập trình, throw.
//
// Cửa sổ CS: tin tự do chỉ gửi được trong hạn Zalo cho phép kể từ tin cuối của khách. Agent luôn
// trả lời ngay sau tin khách nên nằm trong cửa sổ; tin chủ động ngoài cửa sổ phải đi template ZNS —
// chưa làm ở đây.

import type { Broadcaster, BroadcastTarget, OutboundMedia } from "./types.ts";
import type { ZaloOaTokenPort } from "./zalo-oa-token.ts";

const SEND_URL = "https://openapi.zalo.me/v3.0/oa/message/cs";
const ACCESS_TOKEN_HEADER = "access_token";
/** Gửi tin nặng hơn typing (gọi ra Zalo) → cho rộng, nhưng vẫn có trần để lượt hỏng không giữ slot. */
const TIMEOUT_MS = 15_000;
/** `error: 0` = thành công. Mọi giá trị khác là từ chối, kể cả HTTP 200. */
const OK_ERROR_CODE = 0;
/**
 * Mã Zalo trả khi access_token không dùng được. Cache TTL đã lo phần lớn ca hết hạn; đây là lưới
 * đỡ cho ca token chết sớm (backend refresh giữa chừng). Mã lạ → không retry, throw luôn.
 */
const TOKEN_REJECTED_CODES: ReadonlySet<number> = new Set([-216]);
const MAX_ERROR_BODY = 300;

export class ZaloOaBroadcaster implements Broadcaster {
  constructor(private readonly token: ZaloOaTokenPort) {}

  async send(target: BroadcastTarget, text: string): Promise<void> {
    // Không @mention: chat 1-1 chỉ có hai người, prefix "@Tên" chỉ làm bẩn câu trả lời.
    await this.#post(target, { text });
  }

  /**
   * Ảnh (QR chuyển khoản) gửi bằng template `media` trỏ URL — không upload trước để lấy
   * attachment_id: URL do chính hệ mình phát, thêm một vòng upload là thêm một chỗ hỏng.
   *
   * Shape template CHƯA đối chiếu response thật. Zalo từ chối → hạ xuống gửi link dạng text: khách
   * vẫn mở được QR, hơn là ném lỗi làm cả lượt thành failed sau khi họ đã nhận phần chữ.
   */
  async sendMedia(target: BroadcastTarget, media: OutboundMedia): Promise<void> {
    const mediaType = media.type === "image" ? "image" : "file";
    try {
      await this.#post(target, {
        attachment: {
          type: "template",
          payload: {
            template_type: "media",
            elements: [{ media_type: mediaType, url: media.url }],
          },
        },
      });
    } catch (err) {
      console.warn(`[broadcast:zalo-oa] gửi media hỏng, hạ xuống link text:`, err);
      const caption = media.caption === undefined ? "" : `${media.caption}\n`;
      await this.#post(target, { text: `${caption}${media.url}` });
      return;
    }
    if (media.caption !== undefined && media.caption !== "") {
      await this.#post(target, { text: media.caption });
    }
  }

  /** Gửi 1 message. Token bị từ chối → lấy token mới (bỏ cache) và thử LẠI ĐÚNG MỘT LẦN. */
  async #post(target: BroadcastTarget, message: Record<string, unknown>): Promise<void> {
    if (target.isGroup) {
      throw new Error(`[broadcast:zalo-oa] kênh OA không có nhóm (${target.conversationId})`);
    }
    const body = JSON.stringify({
      recipient: { user_id: target.conversationId },
      message,
    });

    const first = await this.#sendOnce(body, await this.token.get());
    if (first === null) return;
    if (!first.retryable) throw first.error;

    const second = await this.#sendOnce(body, await this.token.get(true));
    if (second === null) return;
    throw second.error;
  }

  /** null = gửi xong. Ngược lại trả lỗi + có đáng thử lại với token mới không. */
  async #sendOnce(
    body: string,
    accessToken: string,
  ): Promise<{ error: Error; retryable: boolean } | null> {
    const res = await fetch(SEND_URL, {
      method: "POST",
      headers: {
        [ACCESS_TOKEN_HEADER]: accessToken,
        "content-type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, MAX_ERROR_BODY);
      return {
        error: new Error(`[broadcast:zalo-oa] Zalo trả HTTP ${res.status}: ${detail}`),
        retryable: res.status === 401,
      };
    }

    // Zalo báo lỗi nghiệp vụ trong body với HTTP 200 — không đọc `error` là tưởng gửi thành công.
    const payload: unknown = await res.json().catch(() => undefined);
    const code = readErrorCode(payload);
    if (code === OK_ERROR_CODE) return null;
    if (code === null) {
      return {
        error: new Error("[broadcast:zalo-oa] response Zalo sai shape (thiếu trường `error`)"),
        retryable: false,
      };
    }
    return {
      error: new Error(`[broadcast:zalo-oa] Zalo từ chối: error=${code} ${readMessage(payload)}`),
      retryable: TOKEN_REJECTED_CODES.has(code),
    };
  }
}

function readErrorCode(payload: unknown): number | null {
  const record = asRecord(payload);
  if (record === undefined) return null;
  const code = record.error;
  return typeof code === "number" && Number.isFinite(code) ? code : null;
}

function readMessage(payload: unknown): string {
  const record = asRecord(payload);
  const message = record?.message;
  return typeof message === "string" ? message.slice(0, MAX_ERROR_BODY) : "";
}

function asRecord(x: unknown): Record<string, unknown> | undefined {
  return typeof x === "object" && x !== null && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : undefined;
}
