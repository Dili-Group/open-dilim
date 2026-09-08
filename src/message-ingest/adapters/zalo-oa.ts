// zalo-oa.ts — adapter Zalo Official Account. KHÁC HẲN chat cá nhân (adapters/zalo.ts): shape
// payload khác, chữ ký khác, không có nhóm. Hai adapter riêng, không nới cái nào để nuốt cả hai.
//
// Shape thật (đối chiếu payload production):
//   { event_name, app_id, sender:{ id, admin_id? }, recipient:{ id },
//     message:{ msg_id, text?, attachments? }, timestamp, user_id_by_app }
//   Tin KHÁCH gửi : sender.id = uid khách,  recipient.id = id OA.
//   Tin OA gửi    : event_name "oa_*", sender.id = id OA, sender.admin_id = admin bấm gửi,
//                   recipient.id = uid khách. Tin này VỌNG LẠI webhook → phải rơi hết, nếu không
//                   agent tự trả lời chính mình.
//   `user_id_by_app` = id khách theo từng app. KHÔNG dùng: định danh phòng/khách đi theo
//   `sender.id` để trùng khoá với các kênh Zalo khác (user_binding/group_map lưu uid đó).
//
// v1 chỉ có chat 1-1 (OA nhóm — GMF — là luồng riêng, chưa làm): isGroup=false,
// addressedToAgent=true. Không có mention nên `isAddressed` của ingestor.ts không dùng ở đây.

import { createHash, timingSafeEqual } from "node:crypto";
import type { ZaloOaChannelConfig } from "../../config.ts";
import type { Ingestor, ParsedMessage } from "../ingestor.ts";
import { isRecord, readHttpUrl, readString, readTs } from "./payload.ts";

/** Header chữ ký. Giá trị dạng `mac=<hex>` — phần sau dấu `=` mới là chữ ký. */
const SIGNATURE_HEADER = "x-zevent-signature";
const MAC_PREFIX = "mac=";

/**
 * Event MANG TIN NHẮN của khách. ALLOWLIST, không phải blocklist: `follow`, `user_seen_message`,
 * `user_received_message`, mọi `oa_*`… đều rơi ở đây. Event lạ Zalo thêm sau này cũng rơi — im
 * lặng bỏ một loại tin mới thì sửa được, còn nhận nhầm tin của chính OA thì thành vòng lặp.
 */
const MESSAGE_EVENTS: ReadonlySet<string> = new Set([
  "user_send_text",
  "user_send_image",
  "user_send_link",
  "user_send_sticker",
  "user_send_gif",
  "user_send_file",
  "user_send_audio",
  "user_send_video",
]);

export class ZaloOaIngestor implements Ingestor {
  constructor(
    readonly channel: string,
    private readonly config: ZaloOaChannelConfig,
  ) {}

  /**
   * Chữ ký OA: `mac = SHA256(appId + rawBody + timestamp + oaSecretKey)`, hex thường. Là SHA256
   * TRẦN chứ không phải HMAC như chat cá nhân — secret nằm trong chuỗi được băm.
   *
   * Phải tự `JSON.parse` ở đây vì `timestamp` là thành phần của chuỗi ký mà gateway thì chỉ parse
   * SAU khi verify. Body hỏng → false (fail-closed), gateway trả 401 thay vì 400: chưa xác thực
   * thì chưa có gì để nói là "payload sai".
   *
   * KHÔNG kiểm độ trễ `timestamp`: chống replay đã do dedupe theo `msgId` lo (gateway.ts).
   */
  verify(headers: Headers, rawBody: string): boolean {
    const provided = headers.get(SIGNATURE_HEADER);
    if (provided === null || !provided.startsWith(MAC_PREFIX)) return false;

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return false;
    }
    if (!isRecord(body)) return false;

    const appId = readString(body.app_id);
    const timestamp = readString(body.timestamp);
    if (appId === null || timestamp === null) return false;
    // app_id lạ = webhook của ứng dụng khác trỏ nhầm vào path này.
    if (appId !== this.config.appId) return false;

    const expected = createHash("sha256")
      .update(appId + rawBody + timestamp + this.config.oaSecretKey, "utf8")
      .digest("hex");

    // timingSafeEqual ném nếu khác độ dài → so length trước (chữ ký sai độ dài = fail).
    const a = Buffer.from(provided.slice(MAC_PREFIX.length).trim(), "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** OA gửi 1 event mỗi request; vẫn nhận mảng để đúng hợp đồng `Ingestor`. */
  parse(payload: unknown): ParsedMessage[] {
    const events = Array.isArray(payload) ? payload : [payload];
    const out: ParsedMessage[] = [];
    for (const event of events) {
      const msg = this.#parseOne(event);
      if (msg !== null) out.push(msg);
    }
    return out;
  }

  #parseOne(event: unknown): ParsedMessage | null {
    if (!isRecord(event)) return null;

    const eventName = readString(event.event_name);
    if (eventName === null || !MESSAGE_EVENTS.has(eventName)) return null;

    if (!isRecord(event.sender) || !isRecord(event.recipient) || !isRecord(event.message)) {
      return null;
    }
    const senderId = readString(event.sender.id);
    const oaId = readString(event.recipient.id);
    const msgId = readString(event.message.msg_id);
    if (senderId === null || oaId === null || msgId === null) return null;

    // Tin không gửi tới OA của kênh này → bỏ. Nhiều OA có thể trỏ nhầm chung một path webhook,
    // phục vụ nhầm tài khoản là trả lời khách của người khác.
    if (oaId !== this.config.agentUid) return null;

    const imageUrl = readImageUrl(event.message.attachments);

    return {
      channel: this.channel,
      msgId,
      // Chat 1-1: "phòng" chính là người gửi (khoá state/history/order-lock).
      conversationId: senderId,
      senderId,
      ...(imageUrl === undefined ? {} : { imageUrl }),
      // Webhook OA KHÔNG kèm tên hiển thị (phải gọi API profile riêng) → agent gọi theo vai.
      isGroup: false,
      addressedToAgent: true,
      text: typeof event.message.text === "string" ? event.message.text : "",
      mentions: [],
      ts: readTs(event.timestamp),
    };
  }
}

/**
 * Ảnh đính kèm: `message.attachments[]` dạng `{ type, payload:{ url, thumbnail } }`. Chỉ lấy
 * `type === "image"` — v1 chỉ đọc được ảnh, nhận file/video vào đây là hứa suông với model.
 * Envelope mang tối đa MỘT ảnh nên lấy cái đầu tiên.
 *
 * Shape này CHƯA đối chiếu payload thật (mới có mẫu `user_send_text`). Khác shape → không match →
 * coi như tin không ảnh; text vẫn vào history, không rớt tin.
 */
function readImageUrl(attachments: unknown): string | undefined {
  if (!Array.isArray(attachments)) return undefined;
  for (const item of attachments) {
    if (!isRecord(item) || item.type !== "image") continue;
    if (!isRecord(item.payload)) continue;
    const url = readHttpUrl(item.payload.url);
    if (url !== undefined) return url;
  }
  return undefined;
}
