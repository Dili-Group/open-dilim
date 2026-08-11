// zalo.ts — adapter Zalo. Payload là untrusted → narrow từng field, KHÔNG tin blind.
//
// Shape thật (webhook Zalo chat): { msgId, uidFrom, idTo, msgType, content, mentions[], ts, ... }.
//   uidFrom = người gửi.  idTo = đích (group id, hoặc = agentUid khi direct).
//   content = string (text/command) hoặc object (chat.photo → chưa lấy text).
//   imageUrl / fileUrl = link CDN của ảnh đính kèm (tối đa MỘT file mỗi tin).
//   mentions[] = [{ uid, pos, len, type }] → chỉ cần uid.
// isGroup = idTo !== agentUid: group gửi tới id nhóm; direct gửi thẳng tới agent.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ZaloChannelConfig } from "../../config.ts";
import type { Mention } from "../../types/index.ts";
import { isAddressed, type Ingestor, type ParsedMessage } from "../ingestor.ts";

// Header mang chữ ký webhook. LƯU Ý: tên header + cách Zalo compose chuỗi ký PHẢI xác nhận lại
// với payload/tài liệu Zalo thật trước prod. Cơ chế (HMAC-SHA256 rawBody, so timing-safe) đúng;
// phần cần chốt là input ký. Verify FAIL-CLOSED: thiếu/sai chữ ký → false.
const SIGNATURE_HEADER = "x-zevent-signature";

/** Trần tên hiển thị: tên do người dùng tự đặt, đi vào prefix của MỌI tin trong prompt. */
const MAX_SENDER_NAME_CHARS = 40;

export class ZaloIngestor implements Ingestor {
  /**
   * Tên kênh do WIRING cấp, không hard-code: nhiều tài khoản Zalo = nhiều kênh, mỗi kênh một
   * agentUid/secret riêng và một root agent riêng (agents/router.ts).
   */
  constructor(
    readonly channel: string,
    private readonly config: ZaloChannelConfig,
  ) {}

  verify(headers: Headers, rawBody: string): boolean {
    const provided = headers.get(SIGNATURE_HEADER);
    if (provided === null || provided === "") return false;

    const expected = createHmac("sha256", this.config.webhookSecret)
      .update(rawBody)
      .digest("hex");

    // timingSafeEqual ném nếu khác độ dài → so length trước (chữ ký sai độ dài = fail).
    const a = Buffer.from(provided.trim(), "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parse(payload: unknown): ParsedMessage[] {
    // 1 webhook có thể là 1 event (object) hoặc mảng event.
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

    const msgId = readString(event.msgId);
    const senderId = readString(event.uidFrom);
    const idTo = readString(event.idTo);
    if (msgId === null || senderId === null || idTo === null) return null;

    const isGroup = idTo !== this.config.agentUid;
    const conversationId = isGroup ? idTo : senderId;
    const text = readText(event.content);
    const mentions = readMentions(event.mentions);
    const imageUrl = readImageUrl(event);

    return {
      channel: this.channel,
      msgId,
      conversationId,
      senderId,
      ...(imageUrl === undefined ? {} : { imageUrl }),
      // senderName = tên hiển thị Zalo. Không phải event nào cũng có → thiếu thì bỏ hẳn field.
      ...(readName(event.senderName) ?? {}),
      isGroup,
      addressedToAgent: isAddressed(isGroup, text, mentions, this.config.agentUid),
      text,
      mentions,
      ts: readTs(event.ts),
    };
  }
}

/**
 * Tên hiển thị người gửi. Người dùng tự đặt → cắt trần độ dài (tên rác dài đi vào MỌI tin của
 * prompt) và bỏ khoảng trắng thừa. Không phải chuỗi / rỗng → undefined (gọi theo vai).
 */
function readName(raw: unknown): { senderName: string } | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.trim().slice(0, MAX_SENDER_NAME_CHARS);
  return name === "" ? undefined : { senderName: name };
}

/** content = string (text/command) → lấy thẳng; object (photo/...) → chưa trích text, "". */
function readText(content: unknown): string {
  return typeof content === "string" ? content : "";
}

/**
 * Đuôi file coi là ẢNH khi link đến từ `fileUrl` (field chung cho mọi loại đính kèm).
 * Đúng bộ định dạng con đọc ảnh nhận được (vision/image-vision.ts) — nhận rộng hơn ở đây là hứa
 * với model một thứ mà tới lúc tải mới báo không đọc được.
 */
const IMAGE_EXTENSION = /\.(jpe?g|png|webp|heic|heif)$/i;

/** Trần độ dài URL nhận vào — link CDN thật ngắn hơn nhiều; dài hơn là rác/nhồi prompt. */
const MAX_IMAGE_URL_CHARS = 2048;

/**
 * Ký tự URL hợp lệ KHÔNG cần tới (đã encode được), nhưng lại bẻ được prompt: link ảnh in ra NGOÀI
 * cặp thẻ dữ liệu của lượt (context/assembler.ts) nên một dấu `]` hay `<` trong tên file là đóng
 * được ô hệ thống rồi viết tiếp như hệ thống. Chặn tại cửa vào thay vì cắt gọt lúc render.
 */
const UNSAFE_URL_CHARS = /[<>[\]\s"'`\\]/;

/**
 * Ảnh đính kèm: `imageUrl` là ảnh sẵn; `fileUrl` là field chung mọi loại file nên CHỈ nhận khi đuôi
 * là ảnh — v1 chỉ đọc được ảnh, nhận PDF vào đây là hứa suông với model.
 *
 * Chỉ nhận http(s) tuyệt đối: `file://`, `data:` và đường dẫn tương đối không phải link CDN. Host
 * KHÔNG duyệt ở đây — allowlist nằm ở lúc tải (vision/image-vision.ts), chỗ duy nhất thật sự gọi ra
 * ngoài; chặn hai nơi bằng hai danh sách là sớm muộn lệch nhau.
 */
function readImageUrl(event: Record<string, unknown>): string | undefined {
  const direct = readHttpUrl(event.imageUrl);
  if (direct !== undefined) return direct;

  const file = readHttpUrl(event.fileUrl);
  if (file === undefined) return undefined;
  return IMAGE_EXTENSION.test(new URL(file).pathname) ? file : undefined;
}

function readHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (value === "" || value.length > MAX_IMAGE_URL_CHARS) return undefined;
  if (UNSAFE_URL_CHARS.test(value)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:" ? value : undefined;
}

/** mentions[] → chỉ giữ uid (entity), bỏ pos/len/type. Bỏ entry thiếu uid. */
function readMentions(raw: unknown): Mention[] {
  if (!Array.isArray(raw)) return [];
  const out: Mention[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const uid = readString(item.uid);
    if (uid !== null) out.push({ uid });
  }
  return out;
}

/** ts Zalo là ms epoch dạng string/number. Không parse được → now (đừng rớt tin vì ts xấu). */
function readTs(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return Date.now();
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** String không rỗng → giá trị; còn lại → null. Id/msgId số cũng ép về string. */
function readString(x: unknown): string | null {
  if (typeof x === "string") return x.length > 0 ? x : null;
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  return null;
}
