// handler.ts — xử lý 1 Envelope (design §5 bước 6→9): AUTH → STATE → AGENT → BROADCAST.
// Trả AgentResult: lỗi là GIÁ TRỊ, không phải exception → caller buộc narrow union trước khi
// chạm text, và `pool.ts` biết hỏng Ở BƯỚC NÀO (một catch chung thì auth với broadcast nhìn y
// hệt nhau). Dedupe (bước 4) đã làm ở ingest (biến thể "ingest dày") nên worker không lặp lại.

import type { MemoryScope } from "../state/types.ts";
import { toDistillTurns } from "../state/memory-writer.ts";
import { capForChannel, type TypingTarget } from "../broadcast/index.ts";
import {
  AGENT_SENDER_ID,
  type AgentResult,
  type Envelope,
  type HistoryEntry,
  type LifecycleStep,
} from "../types/index.ts";
import type { WorkerContext } from "./types.ts";

// N turn history nạp vào context mỗi lần chạy agent.
const HISTORY_LIMIT = 20;

export async function handleEnvelope(
  ctx: WorkerContext,
  envelope: Envelope,
  signal?: AbortSignal,
): Promise<AgentResult> {
  // Con trỏ bước: một catch duy nhất nhưng vẫn biết hỏng ở đâu.
  let step: LifecycleStep = "auth";
  try {
    // 6. AUTH — vai luôn resolve từ senderId server-side (group → groupId = conversationId).
    const identity = await ctx.identity.resolve({
      channel: envelope.channel,
      senderId: envelope.senderId,
      groupId: envelope.isGroup ? envelope.conversationId : undefined,
    });

    // 6b. FLASH — tin `/lệnh` chạy side-effect (bind/gán/gỡ), KHÔNG qua LLM. dispatch trả null nếu
    // không phải lệnh → rơi xuống agent. Có kết quả (kể cả lỗi tên/quyền/handler — luôn có reply):
    // broadcast reply + lưu history (lượt agent) rồi thoát, không nạp history/chạy LLM.
    const flash = await ctx.flash.dispatch(envelope.text, {
      identity,
      channel: envelope.channel,
      groupId: envelope.isGroup ? envelope.conversationId : undefined,
      mentions: envelope.mentions,
      repo: ctx.identityRepo,
      ops: ctx.ops,
    });
    if (flash !== null) {
      step = "broadcast";
      await ctx.historyWriter.append({
        conversationId: envelope.conversationId,
        msgId: `${envelope.msgId}#flash`,
        senderId: AGENT_SENDER_ID,
        text: flash.reply,
        isGroup: envelope.isGroup,
        role: "agent",
        ts: Date.now(),
      });
      await ctx.broadcaster.send(
        {
          channel: envelope.channel,
          conversationId: envelope.conversationId,
          isGroup: envelope.isGroup,
          replyToSenderId: envelope.senderId,
        },
        capForChannel(envelope.channel, flash.reply),
      );
      return { status: "reply", text: flash.reply };
    }

    // 7. STATE — nạp history phòng (đã gồm chính message này do ingest append trước khi publish).
    step = "state";
    const history = await ctx.history.recent(envelope.conversationId, HISTORY_LIMIT);
    if (history.length === 0) {
      // Rỗng = bất thường (ingest append TRƯỚC publish) → thành kết quả có vết, không im lặng.
      return {
        status: "failed",
        step,
        error: new Error(`history rỗng: ${envelope.conversationId}`),
      };
    }

    // 8. AGENT — agentType chưa map theo vai ở slice này → default agent.
    step = "agent";
    const memoryScope = await resolveMemoryScope(ctx, envelope);
    const onStep = buildTypingPulse(ctx, envelope);
    const result = await ctx.agents.resolve().run({ identity, history, memoryScope, onStep, signal });
    // suspended (§6): gate đã lưu pending + tự phát yêu cầu duyệt tới NGƯỜI DUYỆT (có thể ở phòng
    // khác) → worker thoát, không broadcast gì thêm. failed: không có text hợp lệ để gửi.
    if (result.status !== "reply" || result.text === "") return result;

    // 9. BROADCAST — direct → DM user; group → topic phòng, @ lại người hỏi.
    // Cap ở đây chứ không ở agent: trần là ràng buộc CỦA KÊNH, agent không cần biết.
    step = "broadcast";
    await ctx.broadcaster.send(
      {
        channel: envelope.channel,
        conversationId: envelope.conversationId,
        isGroup: envelope.isGroup,
        replyToSenderId: envelope.senderId,
      },
      capForChannel(envelope.channel, result.text),
    );

    // 10. GHI NHỚ — reply agent vào buffer ngắn hạn, rồi đường dài hạn (distill theo lô, tự quyết
    // định lượt này có chạy hay không). Sau broadcast: khách đã nhận câu trả lời, hỏng ở đây chỉ
    // mất trí nhớ chứ không được biến lượt thành failed.
    await rememberTurn(ctx, envelope, result.text, history, memoryScope, signal);
    return result;
  } catch (err) {
    return { status: "failed", step, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Đóng lượt: lưu reply agent vào history phòng (lượt sau thấy chính mình đã trả gì) rồi đẩy cả
 * cửa sổ hội thoại sang đường ghi dài hạn. Cả hai đều best-effort — lỗi log rồi thôi, vì reply đã
 * gửi đi và distill chỉ là việc nền.
 */
async function rememberTurn(
  ctx: WorkerContext,
  envelope: Envelope,
  replyText: string,
  history: readonly HistoryEntry[],
  memoryScope: MemoryScope | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const reply: HistoryEntry = {
    conversationId: envelope.conversationId,
    msgId: `${envelope.msgId}#agent`,
    senderId: AGENT_SENDER_ID,
    text: replyText,
    isGroup: envelope.isGroup,
    role: "agent",
    ts: Date.now(),
  };
  try {
    await ctx.historyWriter.append(reply);
  } catch (err) {
    console.error("[worker] lưu reply vào history lỗi:", err);
  }

  // Chưa bind phòng (không có scope) hoặc chưa bật memory dài hạn → không có chỗ ghi, bỏ qua.
  if (memoryScope === undefined || ctx.memoryWriter === undefined) return;
  try {
    await ctx.memoryWriter.afterTurn(
      memoryScope,
      toDistillTurns([...history, reply]),
      envelope.msgId,
      signal,
    );
  } catch (err) {
    console.error("[worker] ghi trí nhớ dài hạn lỗi:", err);
  }
}

/**
 * Nhịp "đang xử lý" bind sẵn target của lượt: agent chỉ gọi () => Promise, không biết channel/
 * conversationId. Sender chọn theo channel; kênh chưa có adapter → noop (factory tự fallback).
 */
function buildTypingPulse(ctx: WorkerContext, envelope: Envelope): () => Promise<void> {
  const sender = ctx.typing.for(envelope.channel);
  const target: TypingTarget = {
    channel: envelope.channel,
    conversationId: envelope.conversationId,
    isGroup: envelope.isGroup,
  };
  return () => sender.typing(target);
}

/**
 * MemoryScope của lượt = (khách sở hữu PHÒNG, kênh, phòng) — KHÔNG lấy customerId từ Identity
 * người gõ: nhân viên gõ trong phòng khách X thì Identity không mang X, mà fact vẫn là của X.
 *
 * undefined khi: chat 1-1, hoặc nhóm chưa `/ketnoi-dilim` (group_map chưa bật). Chưa kết nối thì
 * không biết fact thuộc về khách nào → không đọc, không ghi. Không có rổ chung để đoán vào.
 */
async function resolveMemoryScope(
  ctx: WorkerContext,
  envelope: Envelope,
): Promise<MemoryScope | undefined> {
  if (ctx.groupCustomer === undefined || !envelope.isGroup) return undefined;
  const customerId = await ctx.groupCustomer.customerIdOf({
    channel: envelope.channel,
    groupId: envelope.conversationId,
  });
  if (customerId === undefined) return undefined;
  return { customerId, channel: envelope.channel, conversationId: envelope.conversationId };
}
