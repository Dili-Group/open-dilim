// handler.ts — xử lý 1 Envelope (design §5 bước 6→9): AUTH → STATE → AGENT → BROADCAST.
// Cô lập lỗi per-request: 1 message lỗi KHÔNG làm rớt worker (CLAUDE.md). Dedupe (bước 4) đã
// làm ở ingest (biến thể "ingest dày") nên worker không lặp lại.

import type { Envelope } from "../types/index.ts";
import type { WorkerContext } from "./types.ts";

// N turn history nạp vào context mỗi lần chạy agent.
const HISTORY_LIMIT = 20;

export async function handleEnvelope(
  ctx: WorkerContext,
  envelope: Envelope,
  signal?: AbortSignal,
): Promise<void> {
  try {
    // 6. AUTH — vai luôn resolve từ senderId server-side (group → groupId = conversationId).
    const identity = await ctx.identity.resolve({
      channel: envelope.channel,
      senderId: envelope.senderId,
      groupId: envelope.isGroup ? envelope.conversationId : undefined,
    });

    // 7. STATE — nạp history phòng (đã gồm chính message này do ingest append trước khi publish).
    const history = await ctx.history.recent(envelope.conversationId, HISTORY_LIMIT);
    if (history.length === 0) {
      // Không có gì để trả lời (không kỳ vọng xảy ra vì ingest append trước publish).
      console.warn(`[worker] history rỗng cho ${envelope.conversationId}, bỏ qua`);
      return;
    }

    // 8. AGENT — agentType chưa map theo vai ở slice này → default agent.
    const reply = await ctx.agents.resolve().run({ identity, history, signal });
    if (reply === "") return;

    // 9. BROADCAST — direct → DM; group → topic phòng, @ lại người hỏi.
    await ctx.broadcaster.send(
      {
        channel: envelope.channel,
        conversationId: envelope.conversationId,
        isGroup: envelope.isGroup,
        replyToSenderId: envelope.senderId,
      },
      reply,
    );
  } catch (err) {
    console.error(`[worker] xử lý msg ${envelope.msgId} lỗi:`, err);
  }
}
