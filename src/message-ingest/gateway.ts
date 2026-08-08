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
import type { ParsedMessage } from "./ingestor.ts";

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
      if (envelope.addressedToAgent) await deps.broker.publish(envelope);
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

function toHistoryEntry(e: Envelope): HistoryEntry {
  return {
    conversationId: e.conversationId,
    msgId: e.msgId,
    senderId: e.senderId,
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
