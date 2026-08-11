// gateway.ts — INGRESS: nhận webhook, verify, parse, gate, ghi history, push broker, ACK.
// Đồng bộ + nhanh + KHÔNG chạm LLM/AUTH nặng. Mọi I/O đi qua port (deps).
//
// Luồng 1 event (§5 bước 1–3, biến thể "ingest dày"):
//   dedupe.firstSee → (trùng: bỏ) → history.append (MỌI tin) → addressed? broker.publish
//   fail giữa chừng → dedupe.release (retry reprocess) → 5xx cho channel retry.

import { captureError } from "../observability/sentry.ts";
import type { Envelope, HistoryEntry } from "../types/index.ts";
import type { IngestDeps } from "./deps.ts";
import type { ChannelFactory } from "./factory.ts";
import { isSupersedable, type ParsedMessage } from "./ingestor.ts";

const WEBHOOK_PREFIX = "/webhook/";

/** Gateway = closure ôm factory + deps. Channel-agnostic. `handle` test được không cần mở port. */
export function createGateway(factory: ChannelFactory, deps: IngestDeps) {
  async function handle(req: Request): Promise<Response> {
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

    const channel = channelFromPath(new URL(req.url).pathname);
    if (channel === null) return json(404, { error: "not_found" });

    // Adapter chỉ register khi kênh đã cấu hình → miss = kênh lạ HOẶC chưa bật. 404 cả hai.
    const ingestor = factory.get(channel);
    if (ingestor === undefined) return json(404, { error: "unknown_channel" });

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

  return { handle };
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
      if (envelope.addressedToAgent) {
        await deps.broker.publish(envelope);
        await markLatestTurn(deps, envelope);
      }
      await trackSpeakerTurnover(deps, envelope);
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
    isGroup: e.isGroup,
    role: "user",
    ts: e.ts,
  };
}

/** Tách channel từ `/webhook/:channel`. Path khác → null. */
function channelFromPath(pathname: string): string | null {
  if (!pathname.startsWith(WEBHOOK_PREFIX)) return null;
  const channel = pathname.slice(WEBHOOK_PREFIX.length);
  // Chỉ 1 segment (không cho /webhook/zalo/extra).
  if (channel === "" || channel.includes("/")) return null;
  return channel;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
