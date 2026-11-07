// gateway.ts — INGRESS: nhận webhook, verify, parse, gate, ghi history, push broker, ACK.
// Đồng bộ + nhanh + KHÔNG chạm LLM/AUTH nặng. Mọi I/O đi qua port (deps).
//
// Luồng 1 event (§5 bước 1–3, biến thể "ingest dày"):
//   dedupe.firstSee → (trùng: bỏ) → history.append (MỌI tin) → addressed? broker.publish
//   fail giữa chừng → dedupe.release (retry reprocess) → 5xx cho channel retry.

import { timingSafeEqual } from "node:crypto";
import { captureError } from "../observability/sentry.ts";
import type { Envelope, HistoryEntry } from "../types/index.ts";
import { isRecord } from "./adapters/payload.ts";
import type { IngestDeps } from "./deps.ts";
import type { ChannelFactory } from "./factory.ts";
import { isSupersedable, type Ingestor, type ParsedMessage } from "./ingestor.ts";

const WEBHOOK_PREFIX = "/webhook/";
const SETTING_SEGMENT = "setting";
const BEARER_PREFIX = "Bearer ";

/** Gateway = closure ôm factory + deps. Channel-agnostic. `handle` test được không cần mở port. */
export function createGateway(factory: ChannelFactory, deps: IngestDeps) {
  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const route = routeFromPath(url.pathname);
    if (route === null) return json(404, { error: "not_found" });
    const { channel } = route;

    // Adapter chỉ register khi kênh đã cấu hình → miss = kênh lạ HOẶC chưa bật. 404 cả hai.
    const ingestor = factory.get(channel);
    if (ingestor === undefined) return json(404, { error: "unknown_channel" });

    if (route.isSetting) return handleSetting(req, channel, ingestor);

    if (req.method === "GET" && ingestor.handshake !== undefined) {
      const challenge = ingestor.handshake(url.searchParams);
      return challenge === null
        ? json(403, { error: "handshake_rejected" })
        : new Response(challenge, { status: 200 });
    }
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

    const rawBody = await req.text();
    if (!ingestor.verify(req.headers, rawBody)) {
      return json(401, { error: "invalid_signature" });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json(400, { error: "invalid_json" });
    }

    let messages: ParsedMessage[];
    try {
      messages = ingestor.parse(payload);
    } catch (err) {
      console.error(`[ingest:${channel}] parse lỗi:`, err);
      captureError(err, "ingest.parse", { channel });
      return json(400, { error: "unparseable_payload" });
    }

    // Cô lập per-event: 1 event lỗi không làm rớt các event khác trong cùng webhook.
    let anyFailed = false;
    for (const msg of messages) {
      const ok = await processMessage(deps, msg);
      if (!ok) anyFailed = true;
    }

    // Fail downstream → 5xx để channel retry (đã release dedupe, retry an toàn).
    return anyFailed ? json(500, { error: "ingest_failed" }) : json(200, { ok: true });
  }

  /**
   * `POST /webhook/:channel/setting` — bật/tắt trả lời theo thread. KHÁC webhook: người gọi là hệ
   * thống của mình chứ không phải platform, nên không có chữ ký platform để verify → Bearer token.
   * Thiếu token/store hoặc adapter không opt-in → 404 như kênh chưa bật (mặc định đóng).
   */
  async function handleSetting(
    req: Request,
    channel: string,
    ingestor: Ingestor,
  ): Promise<Response> {
    const { settings, settingsToken } = deps;
    if (ingestor.supportsThreadSettings !== true || settings === undefined || settingsToken === undefined) {
      return json(404, { error: "not_found" });
    }
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
    if (!hasBearerToken(req.headers, settingsToken)) return json(401, { error: "unauthorized" });

    let body: unknown;
    try {
      body = JSON.parse(await req.text());
    } catch {
      return json(400, { error: "invalid_json" });
    }
    const parsed = parseSettingBody(body);
    if (parsed === null) return json(400, { error: "invalid_setting_body" });

    try {
      await settings.setReplyEnabled(channel, parsed.threadId, parsed.enabled);
    } catch (err) {
      console.error(`[ingest:${channel}] lưu setting thread lỗi:`, err);
      captureError(err, "ingest.setting", { channel });
      return json(500, { error: "setting_failed" });
    }
    return json(200, { ok: true, threadId: parsed.threadId, setting: { enabled: parsed.enabled } });
  }

  return { handle };
}

/** Bearer token, so timing-safe. Sai độ dài = fail (timingSafeEqual ném nếu khác độ dài). */
function hasBearerToken(headers: Headers, expected: string): boolean {
  const header = headers.get("authorization");
  if (header === null || !header.startsWith(BEARER_PREFIX)) return false;
  const a = Buffer.from(header.slice(BEARER_PREFIX.length).trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Body `{ threadId: string, setting: { enabled: boolean } }`. Sai shape → null. */
function parseSettingBody(body: unknown): { threadId: string; enabled: boolean } | null {
  if (!isRecord(body)) return null;
  const { threadId, setting } = body;
  if (typeof threadId !== "string" || threadId.trim() === "") return null;
  if (!isRecord(setting) || typeof setting.enabled !== "boolean") return null;
  return { threadId: threadId.trim(), enabled: setting.enabled };
}

/** true = xử lý xong (kể cả trùng bị bỏ). false = fail downstream → caller trả 5xx. */
async function processMessage(deps: IngestDeps, msg: ParsedMessage): Promise<boolean> {
  // addressedToAgent adapter đã quyết (trigger gate platform-specific).
  const envelope: Envelope = { ...msg, source: "channel" };

  try {
    // Atomic check-and-mark: retry trùng msgId bị chặn ở đây.
    const first = await deps.dedupe.firstSee(msg.channel, msg.msgId);
    if (!first) return true;

    try {
      // MỌI tin vào history (đúng thứ tự giờ nhận); chỉ tin nhắm agent mới vào queue.
      await deps.history.append(toHistoryEntry(envelope));
      // Thread bị tắt reply: tin vẫn vào history (bật lại thì agent còn ngữ cảnh) nhưng không vào queue.
      if (envelope.addressedToAgent && (await isReplyEnabled(deps, envelope))) {
        await deps.broker.publish(envelope);
        await markLatestTurn(deps, envelope);
      }
      await trackSpeakerTurnover(deps, envelope);
      await logMessage(deps, envelope);
      await considerProactive(deps, envelope);
    } catch (err) {
      // Trả lại mark để retry của channel reprocess (không mất tin).
      await deps.dedupe.release(msg.channel, msg.msgId);
      throw err;
    }
    return true;
  } catch (err) {
    console.error(`[ingest:${msg.channel}] xử lý msg ${msg.msgId} lỗi:`, err);
    captureError(err, "ingest.process", { channel: msg.channel, msgId: msg.msgId });
    return false;
  }
}

async function isReplyEnabled(deps: IngestDeps, envelope: Envelope): Promise<boolean> {
  if (deps.settings === undefined) return true;
  return deps.settings.isReplyEnabled(envelope.channel, envelope.conversationId);
}

/**
 * Nâng vạch "tin mới nhất của phòng" để worker gom được tin gửi liên tiếp (worker/burst.ts).
 * Chỉ tin ĐÃ vào queue và được phép gom: tin không nhắm agent không có lượt nào để đè, còn `/lệnh`
 * đè lên tin thường là nuốt câu hỏi của khách.
 *
 * Best-effort: hỏng thì log rồi thôi. Vạch không nâng được = không ai bị bỏ = mỗi tin một lượt như
 * cũ. Throw ở đây sẽ nhả dedupe và bắt kênh gửi lại nguyên tin — trả giá quá đắt cho một tối ưu.
 */
async function markLatestTurn(deps: IngestDeps, envelope: Envelope): Promise<void> {
  if (deps.turns === undefined || !isSupersedable(envelope)) return;
  try {
    await deps.turns.mark(envelope.channel, envelope.conversationId, envelope.ts);
  } catch (err) {
    console.error(`[ingest:${envelope.channel}] nâng vạch tin mới nhất lỗi:`, err);
  }
}

/**
 * Ghi raw log bền cho knowledge base — MỌI tin, kể cả tin không nhắm agent. Ingest là nơi duy
 * nhất thấy đủ mọi tin nên hook nằm ở đây, không nằm ở worker.
 *
 * Best-effort: hỏng thì log rồi thôi — đây là thu thập dữ liệu kiểm duyệt, không được làm rớt
 * tin của khách (throw sẽ nhả dedupe và bắt channel gửi lại nguyên tin). Postgres sập một nhịp
 * thì mất mấy row log, không mất câu trả lời.
 */
async function logMessage(deps: IngestDeps, envelope: Envelope): Promise<void> {
  if (deps.messageLog === undefined) return;
  try {
    await deps.messageLog.append(envelope);
  } catch (err) {
    console.error(`[ingest:${envelope.channel}] ghi message_log lỗi:`, err);
    captureError(err, "ingest.message_log", { channel: envelope.channel, msgId: envelope.msgId });
  }
}

/**
 * Ghi lại người vừa nói; NGƯỜI KHÁC vừa đáp lời người trước → đẩy một envelope `distill` để worker
 * chưng cất phòng này. Đây là chỗ duy nhất thấy được nhịp đó: tin không nhắm agent không bao giờ
 * tới worker, mà phần lớn cuộc trao đổi trong nhóm là loại tin đó.
 *
 * Tin NHẮM agent thì không đẩy: cuối lượt agent đã tự chưng cất (agent trả lời cũng là một người
 * khác vừa lên tiếng) — đẩy thêm ở đây là chạy distill hai lần cho cùng một nhịp.
 *
 * Best-effort: hỏng thì log rồi thôi. Đây là việc thu thập dữ liệu, không được làm rớt tin của
 * khách (throw ở đây sẽ nhả dedupe và bắt channel gửi lại nguyên tin).
 */
async function trackSpeakerTurnover(deps: IngestDeps, envelope: Envelope): Promise<void> {
  if (deps.speakers === undefined) return;
  try {
    const previous = await deps.speakers.swap(
      envelope.channel,
      envelope.conversationId,
      envelope.senderId,
    );
    if (envelope.addressedToAgent) return;
    if (previous === undefined || previous === envelope.senderId) return;
    await deps.broker.publish(distillEnvelope(envelope));
  } catch (err) {
    console.error(`[ingest:${envelope.channel}] theo dõi đổi người nói lỗi:`, err);
  }
}

/**
 * Đầu vào phễu proactive: tin group không nhắm agent → xét đặt lịch nhặt nếu không ai trả lời
 * (src/proactive/). Chỉ gọi cho đúng loại tin đó — tin nhắm agent đã có lượt riêng.
 *
 * Best-effort: hỏng thì log rồi thôi — mất một cơ hội chủ động giúp, không được làm rớt tin
 * (throw ở đây sẽ nhả dedupe và bắt channel gửi lại nguyên tin).
 */
async function considerProactive(deps: IngestDeps, envelope: Envelope): Promise<void> {
  if (deps.proactive === undefined || envelope.addressedToAgent || !envelope.isGroup) return;
  try {
    await deps.proactive.consider(envelope);
  } catch (err) {
    console.error(`[ingest:${envelope.channel}] xét phễu proactive lỗi:`, err);
    captureError(err, "ingest.proactive", { channel: envelope.channel, msgId: envelope.msgId });
  }
}

/**
 * Envelope KHÔNG mang tin nhắn: chỉ nói "phòng này vừa có nhịp trao đổi trọn, chưng cất đi".
 * `msgId` neo vào tin kích hoạt để dedupe của broker/worker vẫn có khoá idempotent thật.
 */
function distillEnvelope(trigger: Envelope): Envelope {
  return {
    source: "distill",
    channel: trigger.channel,
    msgId: `distill:${trigger.msgId}`,
    conversationId: trigger.conversationId,
    senderId: trigger.senderId,
    isGroup: trigger.isGroup,
    addressedToAgent: false,
    text: "",
    mentions: [],
    ts: trigger.ts,
  };
}

function toHistoryEntry(e: Envelope): HistoryEntry {
  return {
    conversationId: e.conversationId,
    msgId: e.msgId,
    senderId: e.senderId,
    ...(e.senderName === undefined ? {} : { senderName: e.senderName }),
    text: e.text,
    // Ảnh chỉ là con trỏ (link CDN) — giữ theo tin để lượt sau agent còn gọi `xem_anh` lại được.
    ...(e?.imageUrl === undefined ? {} : { imageUrl: e.imageUrl }),
    ...(e?.fileUrl === undefined ? {} : { fileUrl: e.fileUrl }),
    ...(e?.fileName === undefined ? {} : { fileName: e.fileName }),
    isGroup: e.isGroup,
    role: "user",
    ts: e.ts,
  };
}

/** Tách `/webhook/:channel` hoặc `/webhook/:channel/setting`. Path khác → null. */
function routeFromPath(pathname: string): { channel: string; isSetting: boolean } | null {
  if (!pathname.startsWith(WEBHOOK_PREFIX)) return null;
  const [channel, extra, ...rest] = pathname.slice(WEBHOOK_PREFIX.length).split("/");
  if (channel === undefined || channel === "" || rest.length > 0) return null;
  if (extra === undefined) return { channel, isSetting: false };
  return extra === SETTING_SEGMENT ? { channel, isSetting: true } : null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
