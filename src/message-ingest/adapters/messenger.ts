// messenger.ts — parse webhook Messenger (Facebook Page), Graph API v26.0. Thuần, không I/O.
//
// Shape:
//   { object:"page", entry:[{ id:<page id>, time, messaging:[<event>] }] }
//   event tin nhắn : { sender:{id:<PSID>}, recipient:{id:<page id>}, timestamp,
//                      message:{ mid, text?, attachments?:[{ type, payload:{ url } }],
//                                quick_reply?:{ payload }, is_echo? } }
//   event postback : { sender, recipient, timestamp, postback:{ mid, title, payload } }
//   Còn lại (delivery, read, reaction, optin…) không mang tin → rơi.
//
// `is_echo` = tin PAGE gửi đi vọng lại webhook (sender là page) → rơi, nếu không agent tự trả lời
// chính mình. Messenger chỉ có chat 1-1 với page: isGroup=false, addressedToAgent=true.
//
// Chữ ký: header `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(rawBody, appSecret)>`.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { MessengerChannelConfig } from "../../config.ts";
import type { Ingestor, ParsedMessage } from "../ingestor.ts";
import { isDocAttachment, isRecord, readHttpUrl, readString, readTs } from "./payload.ts";

const PAGE_OBJECT = "page";
const SIGNATURE_HEADER = "x-hub-signature-256";
const SIGNATURE_PREFIX = "sha256=";
const HANDSHAKE_MODE = "subscribe";

export class MessengerIngestor implements Ingestor {
  constructor(
    readonly channel: string,
    private readonly config: MessengerChannelConfig,
  ) {}

  verify(headers: Headers, rawBody: string): boolean {
    const provided = headers.get(SIGNATURE_HEADER);
    if (provided === null || !provided.startsWith(SIGNATURE_PREFIX)) return false;
    const expected = createHmac("sha256", this.config.appSecret).update(rawBody, "utf8").digest("hex");
    // timingSafeEqual ném nếu khác độ dài → so length trước (chữ ký sai độ dài = fail).
    const a = Buffer.from(provided.slice(SIGNATURE_PREFIX.length).trim().toLowerCase(), "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parse(payload: unknown): ParsedMessage[] {
    return parseMessengerPayload(this.channel, this.config.agentUid, payload);
  }

  /** Meta gửi GET `hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` lúc đăng ký webhook. */
  handshake(params: URLSearchParams): string | null {
    if (params.get("hub.mode") !== HANDSHAKE_MODE) return null;
    if (params.get("hub.verify_token") !== this.config.verifyToken) return null;
    return params.get("hub.challenge");
  }
}

/**
 * 1 webhook gói nhiều entry, mỗi entry nhiều event → phẳng thành mảng tin. Shape lạ → [].
 * Tin không gửi tới đúng `pageId` → bỏ: một app Meta có thể gắn nhiều page vào chung webhook,
 * phục vụ nhầm page là trả lời khách của người khác.
 */
export function parseMessengerPayload(
  channel: string,
  pageId: string,
  payload: unknown,
): ParsedMessage[] {
  if (!isRecord(payload) || payload.object !== PAGE_OBJECT) return [];
  if (!Array.isArray(payload.entry)) return [];

  const out: ParsedMessage[] = [];
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.messaging)) continue;
    for (const event of entry.messaging) {
      const msg = parseEvent(channel, pageId, event);
      if (msg !== null) out.push(msg);
    }
  }
  return out;
}

function parseEvent(channel: string, pageId: string, event: unknown): ParsedMessage | null {
  if (!isRecord(event) || !isRecord(event.sender) || !isRecord(event.recipient)) return null;
  const senderId = readString(event.sender.id);
  if (senderId === null) return null;
  if (readString(event.recipient.id) !== pageId) return null;

  const content = readMessage(event.message) ?? readPostback(event.postback);
  if (content === null) return null;

  return {
    channel,
    msgId: content.msgId,
    // Chat 1-1: "phòng" chính là PSID người gửi. PSID riêng theo từng page — cùng người, page khác
    // là id khác.
    conversationId: senderId,
    senderId,
    ...(content.imageUrl === undefined ? {} : { imageUrl: content.imageUrl }),
    ...(content.fileUrl === undefined ? {} : { fileUrl: content.fileUrl }),
    // Webhook không kèm tên (phải gọi User Profile API riêng) → agent gọi theo vai.
    isGroup: false,
    addressedToAgent: true,
    text: content.text,
    mentions: [],
    ts: readTs(event.timestamp),
  };
}

interface Content {
  readonly msgId: string;
  readonly text: string;
  readonly imageUrl?: string;
  readonly fileUrl?: string;
}

function readMessage(message: unknown): Content | null {
  if (!isRecord(message) || message.is_echo === true) return null;
  const msgId = readString(message.mid);
  if (msgId === null) return null;

  const imageUrl = readAttachmentUrl(message.attachments, "image");
  const fileUrl = readAttachmentUrl(message.attachments, "file");
  return {
    msgId,
    text: typeof message.text === "string" ? message.text : "",
    ...(imageUrl === undefined ? {} : { imageUrl }),
    // Messenger không gửi tên file → chỉ đoán được định dạng qua đuôi trên đường dẫn.
    ...(fileUrl === undefined || !isDocAttachment(fileUrl, undefined) ? {} : { fileUrl }),
  };
}

/**
 * Bấm nút (Get Started, menu, button template) → coi như khách gõ đúng chữ trên nút. `payload` là
 * mã do mình đặt, không phải lời khách, nên không đưa vào text.
 */
function readPostback(postback: unknown): Content | null {
  if (!isRecord(postback)) return null;
  const msgId = readString(postback.mid);
  const title = readString(postback.title);
  if (msgId === null || title === null) return null;
  return { msgId, text: title };
}

/** Envelope mang tối đa MỘT ảnh / MỘT file → lấy cái đầu tiên đúng loại. */
function readAttachmentUrl(attachments: unknown, type: "image" | "file"): string | undefined {
  if (!Array.isArray(attachments)) return undefined;
  for (const item of attachments) {
    if (!isRecord(item) || item.type !== type || !isRecord(item.payload)) continue;
    const url = readHttpUrl(item.payload.url);
    if (url !== undefined) return url;
  }
  return undefined;
}
