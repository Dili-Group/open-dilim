// handler.ts — xử lý 1 Envelope (design §5 bước 6→9): AUTH → STATE → AGENT → BROADCAST.
// Trả AgentResult: lỗi là GIÁ TRỊ, không phải exception → caller buộc narrow union trước khi
// chạm text, và `pool.ts` biết hỏng Ở BƯỚC NÀO (một catch chung thì auth với broadcast nhìn y
// hệt nhau). Dedupe (bước 4) đã làm ở ingest (biến thể "ingest dày") nên worker không lặp lại.

import { resolveAgentType } from "../agents/router.ts";
import { startTurnTimer, type TurnTimer } from "../observability/timing.ts";
import { toTurnSpeaker } from "../agents/runtime/build-agent.ts";
import type { RootAgent } from "../agents/types.ts";
import type { TurnSpeaker } from "../context/speaker-block.ts";
import type { Identity } from "../flash-command/types.ts";
import { MemoryOwnerKind, type MemoryScope } from "../state/types.ts";
import { HISTORY_BUFFER_TURNS, HISTORY_WINDOW_TURNS } from "../state/session.ts";
import { capForChannel, type TypingTarget } from "../broadcast/index.ts";
import { extractQrMedia } from "../broadcast/qr.ts";
import type { PendingNotice } from "../context/pending-block.ts";
import {
  AGENT_SENDER_ID,
  type AgentResult,
  type Envelope,
  type HistoryEntry,
  type LifecycleStep,
} from "../types/index.ts";
import { checkDailyBudget } from "../usage/gate.ts";
import { UsageMeter } from "../usage/meter.ts";
import type { WorkerContext } from "./types.ts";

export async function handleEnvelope(
  ctx: WorkerContext,
  envelope: Envelope,
  signal?: AbortSignal,
): Promise<AgentResult> {
  // Con trỏ bước: một catch duy nhất nhưng vẫn biết hỏng ở đâu.
  let step: LifecycleStep = "auth";
  const timer = startTurnTimer();
  // Khai NGOÀI try để `finally` ghi được sổ kể cả khi lượt hỏng giữa chừng: model đã sinh token
  // ở những vòng chạy xong thì tiền vẫn mất, không ghi là hụt đúng vào lúc hệ đang trục trặc.
  const meter = new UsageMeter();
  // Cũng khai ngoài try: `finally` cần agentType để ghi sổ. Chỉ là tra Map, không I/O, không throw.
  const agent = ctx.agents.resolve(resolveAgentType(envelope.channel));
  try {
    // Envelope `distill` KHÔNG phải tin nhắn: bỏ qua AUTH/flash/agent, chỉ chưng cất rồi thoát.
    // Nằm trước AUTH vì không có ai "gõ" lượt này — resolve vai chỉ tốn I/O.
    if (envelope.source === "distill") {
      step = "state";
      const distilled = await distillOnly(ctx, envelope, signal);
      timer.lap("distill-only");
      return distilled;
    }

    // 6. AUTH — vai luôn resolve từ senderId server-side (group → groupId = conversationId).
    const identity = await ctx.identity.resolve({
      channel: envelope.channel,
      senderId: envelope.senderId,
      groupId: envelope.isGroup ? envelope.conversationId : undefined,
    });
    timer.lap("auth");

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
      jobs: ctx.jobs,
      announce: ctx.announceApprovals,
      // `/muc-sudung` tra sổ chi phí của CHÍNH phòng này, theo trần của agent phục vụ nó.
      conversationId: envelope.conversationId,
      agentType: agent.agentType,
      usage: ctx.usage,
      // `/mcp` soát tool ngoài — chỉ đọc tình trạng, không phải đường gọi tool.
      mcp: ctx.mcp,
      // `/kiemduyet-kb`, `/duyet-kb`… — cửa kiểm duyệt knowledge base, chỉ flash command cầm.
      kb: ctx.kbReview,
    });
    timer.lap("flash");
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
          replyToSenderName: envelope.senderName,
        },
        capForChannel(envelope.channel, flash.reply),
      );
      timer.lap("broadcast");
      return { status: "reply", text: flash.reply };
    }

    // 6c. BLOCK — nhóm đã /block: agent im lặng. Kiểm SAU flash để /unlock gõ được từ chính nhóm
    // đang bị chặn. Tin vẫn nằm history (ingest đã ghi) nên bật lại là có đủ ngữ cảnh.
    if (envelope.isGroup) {
      const blocked = await ctx.identityRepo.isGroupBlocked({
        channel: envelope.channel,
        groupId: envelope.conversationId,
      });
      if (blocked) return { status: "ignored", reason: "group_blocked" };
    }

    // 6d. NGÂN SÁCH — phòng đã tiêu quá trần ngày thì im lặng, KHÔNG chạy LLM. Đặt trước bước
    // STATE để một phòng bị chặn không còn tốn I/O nào nữa.
    //
    // Trần khai theo agent — nhóm đại lý và nhóm kho không chung mức (usage/budget.ts).
    if (ctx.usage !== undefined) {
      const decision = await checkDailyBudget({
        usage: ctx.usage.port,
        conversationId: envelope.conversationId,
        agentType: agent.agentType,
        usdVndRate: ctx.usage.usdVndRate,
        enforce: ctx.usage.enforce,
      });
      timer.lap("budget");
      if (!decision.allowed) {
        // eslint-disable-next-line no-console
        console.log(
          `[usage] phòng ${envelope.conversationId} (${agent.agentType}) vượt ngưỡng: ` +
            `${Math.round(decision.spentVnd)}đ / ${decision.limitVnd}đ — bỏ lượt`,
        );
        // Lượt proactive: không ai gọi agent — báo "hết ngân sách" vào phòng là spam. Im lặng
        // bỏ (verify của phễu đã chặn trước khi vào hàng chờ; đây là backstop khi ngân sách
        // cạn giữa lúc chờ và lúc nhặt).
        if (envelope.source === "proactive") {
          return { status: "ignored", reason: "budget_proactive" };
        }
        step = "broadcast";
        return await noticeBudgetExceeded(ctx, envelope, timer);
      }
    }

    // 7. STATE — nạp history phòng (đã gồm chính message này do ingest append trước khi publish).
    step = "state";
    const history = await ctx.history.recent(envelope.conversationId, HISTORY_WINDOW_TURNS);
    timer.lap("history");
    if (history.length === 0) {
      // Rỗng = bất thường (ingest append TRƯỚC publish) → thành kết quả có vết, không im lặng.
      return {
        status: "failed",
        step,
        error: new Error(`history rỗng: ${envelope.conversationId}`),
      };
    }

    // 8. AGENT — mỗi channel là một cửa vào riêng → một root agent riêng (agents/router.ts).
    // Channel chưa map → resolveAgentType trả undefined → registry rơi về default agent.
    // (`agent` đã resolve ở bước 6d để tra trần ngân sách.)
    step = "agent";
    // Tra chủ phòng MỘT LẦN: vừa là chủ sở hữu trí nhớ, vừa là phạm vi dữ liệu của tool nghiệp vụ.
    const roomCustomerId = await resolveRoomCustomer(ctx, envelope, agent);
    const memoryScope = resolveMemoryScope(envelope, agent, roomCustomerId);
    // Bản tóm phần đã trôi khỏi cửa sổ 20 tin. Đọc hỏng → chạy không có nó, không giết lượt.
    const summary = await readSummary(ctx, envelope.conversationId);
    const pending = await readPendingNotices(ctx, envelope);
    const onStep = buildTypingPulse(ctx, envelope);
    const onAnnounce = buildAnnouncer(ctx, envelope);
    const speakers = await resolveSpeakers(ctx, envelope, identity, history);
    // Bốn lượt I/O trên còn chạy NỐI TIẾP (chủ phòng → bản tóm → việc treo → vai người nói). Con số
    // `ctx=` là cái để quyết có đáng gộp Promise.all hay không — đo trước, tối ưu sau.
    timer.lap("ctx");
    const result = await agent.run({
      identity,
      speakers,
      history,
      summary,
      memoryScope,
      roomCustomerId,
      // Việc treo liên nhóm (§6) thuộc về NHÓM → chỉ cấp khi lượt này thật sự ở trong nhóm.
      room: envelope.isGroup
        ? { channel: envelope.channel, groupId: envelope.conversationId }
        : undefined,
      pending,
      proactive: envelope.source === "proactive",
      onStep,
      onAnnounce,
      meter,
      signal,
    });
    timer.lap("agent");
    // suspended (§6): gate đã lưu pending + tự phát yêu cầu duyệt tới NGƯỜI DUYỆT (có thể ở phòng
    // khác) → worker thoát, không broadcast gì thêm. failed: không có text hợp lệ để gửi.
    if (result.status !== "reply" || result.text === "") return result;

    // 9. BROADCAST — direct → DM user; group → topic phòng, @ lại người hỏi.
    // Cap ở đây chứ không ở agent: trần là ràng buộc CỦA KÊNH, agent không cần biết.
    // Link QR chuyển khoản trong câu trả lời → rút khỏi text, gửi thành ẢNH sau text: đại lý
    // quét ngay trong chat thay vì bấm link. Text đi trước để ảnh có ngữ cảnh (số tiền, nội dung CK).
    step = "broadcast";
    const { text: replyText, media: qrMedia } = extractQrMedia(result.text);
    const target = {
      channel: envelope.channel,
      conversationId: envelope.conversationId,
      isGroup: envelope.isGroup,
      replyToSenderId: envelope.senderId,
      replyToSenderName: envelope.senderName,
    };
    if (replyText !== "") {
      await ctx.broadcaster.send(target, capForChannel(envelope.channel, replyText));
    }
    for (const media of qrMedia) {
      // Tuần tự, không Promise.all: giữ thứ tự hiển thị text → QR trên Zalo.
      await ctx.broadcaster.sendMedia(target, media);
    }
    timer.lap("broadcast");

    // 10. GHI NHỚ — reply agent vào buffer ngắn hạn, rồi đường dài hạn (agent vừa trả lời = đổi
    // người nói, writer tự quyết phần chưa chưng cất đã đủ dài chưa). Sau broadcast: khách đã nhận câu trả lời, hỏng ở đây chỉ
    // mất trí nhớ chứ không được biến lượt thành failed. Nhớ text ĐÃ RÚT link — history phải khớp
    // cái đã gửi, đừng để model học lại thói dán link từ chính history của mình.
    const remembered = replyText === "" ? result.text : replyText;
    await rememberTurn(ctx, envelope, agent, remembered, history, memoryScope, timer, signal);
    return result;
  } catch (err) {
    return { status: "failed", step, error: err instanceof Error ? err : new Error(String(err)) };
  } finally {
    await recordUsage(ctx, envelope, agent.agentType, meter);
    // Vết THỜI GIAN của lượt (chỉ số, không nội dung). In cả khi lượt hỏng/bị bỏ: một lượt chết ở
    // giây thứ 60 mà không có dòng này thì không biết nó chết vì LLM lặng hay vì Postgres treo.
    // eslint-disable-next-line no-console
    console.log(`[worker] lượt ${envelope.msgId} phòng ${envelope.conversationId} ${timer.summary()}`);
  }
}

/** Câu báo hết hạn mức. Không nêu số tiền: đó là chi phí vận hành, không phải việc của phòng. */
const BUDGET_NOTICE =
  "Hôm nay phòng mình đã dùng hết hạn mức trò chuyện với trợ lý rồi ạ. " +
  "Hạn mức mở lại lúc 00:00, cần thêm thì nhắn người quản trị giúp em nhé.";

/**
 * Phòng vượt trần: nói thẳng là hết hạn mức thay vì im lặng. Im lặng trông như agent hỏng, người
 * ta gõ lại mãi mà không hiểu vì sao.
 *
 * Báo ở MỌI tin bị chặn (không chống lặp): tin nào cũng đáng được trả lời, kể cả trả lời "hôm nay
 * hết rồi". Vẫn rẻ — nhánh này không chạm LLM.
 */
async function noticeBudgetExceeded(
  ctx: WorkerContext,
  envelope: Envelope,
  timer: TurnTimer,
): Promise<AgentResult> {
  await ctx.historyWriter.append({
    conversationId: envelope.conversationId,
    msgId: `${envelope.msgId}#budget`,
    senderId: AGENT_SENDER_ID,
    text: BUDGET_NOTICE,
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
      replyToSenderName: envelope.senderName,
    },
    capForChannel(envelope.channel, BUDGET_NOTICE),
  );
  timer.lap("broadcast");
  return { status: "reply", text: BUDGET_NOTICE };
}

/**
 * Ghi token đã tiêu của lượt vào sổ cái. Chạy trong `finally` → phải đúng ba tính chất:
 *
 *  1. KHÔNG throw. Lượt đã trả lời xong (hoặc đã hỏng vì lý do khác); ném thêm lỗi ở đây chỉ
 *     nuốt mất kết quả/lỗi thật của lượt.
 *  2. Bỏ qua khi meter rỗng — flash command, nhóm bị block, lượt vượt trần đều không chạm LLM.
 *  3. Idempotent theo msgId (store lo) vì broker giao lại lượt là chuyện bình thường.
 */
async function recordUsage(
  ctx: WorkerContext,
  envelope: Envelope,
  agentType: string,
  meter: UsageMeter,
): Promise<void> {
  if (ctx.usage === undefined || meter.isEmpty()) return;
  try {
    await ctx.usage.port.record({
      conversationId: envelope.conversationId,
      agentType,
      msgId: envelope.msgId,
      usage: meter.total(),
    });
  } catch (err) {
    console.error("[usage] ghi sổ chi phí lỗi (bỏ qua):", err);
  }
}

/**
 * Lượt CHỈ chưng cất (envelope `distill` do ingest đẩy khi thấy đổi người nói). Không LLM hội
 * thoại, không broadcast, không đụng history — chỉ đọc buffer rồi gọi đường ghi dài hạn.
 *
 * Agent chọn theo channel (router, không tốn lượt LLM) vì writer gắn với `memorySpec` của agent:
 * phòng đại lý chưng cất bằng prompt khác phòng nội bộ.
 *
 * Mọi nhánh "không có gì để làm" trả `ignored` chứ không `failed`: pool sẽ ack, không retry một
 * việc nền không bao giờ thành công.
 */
async function distillOnly(
  ctx: WorkerContext,
  envelope: Envelope,
  signal?: AbortSignal,
): Promise<AgentResult> {
  if (ctx.memoryWriters === undefined) return { status: "ignored", reason: "memory_off" };

  const agent = ctx.agents.resolve(resolveAgentType(envelope.channel));
  const writer = ctx.memoryWriters.for(agent.agentType);
  if (writer === undefined) return { status: "ignored", reason: "no_memory_writer" };

  const roomCustomerId = await resolveRoomCustomer(ctx, envelope, agent);
  const scope = resolveMemoryScope(envelope, agent, roomCustomerId);
  if (scope === undefined) return { status: "ignored", reason: "no_memory_scope" };

  const entries = await ctx.history.recent(envelope.conversationId, HISTORY_BUFFER_TURNS);
  if (entries.length === 0) return { status: "ignored", reason: "history_rong" };

  const written = await writer.afterTurn(scope, entries, signal);
  return { status: "ignored", reason: `distill:${written}` };
}

/**
 * Vai + tên của MỌI người có tin trong cửa sổ history, theo senderId. Bước AUTH chỉ resolve NGƯỜI
 * GÕ lượt này, nhưng prefix từng tin phải mang vai của chính người viết tin đó: nhóm đại lý có cả
 * nhân viên DiLiM lẫn người của đại lý, model đọc nhầm vai là trả lời sai kiểu và xưng hô sai người.
 *
 * Best-effort: resolver hỏng cho một người → bỏ người đó khỏi map (tin của họ in vai `?`), KHÔNG
 * giết lượt. Người gõ lượt này dùng lại `identity` đã resolve ở bước AUTH, không tra hai lần.
 * Các người còn lại tra song song và gần như luôn trúng cache Redis 8h (CachedIdentityResolver).
 */
async function resolveSpeakers(
  ctx: WorkerContext,
  envelope: Envelope,
  identity: Identity,
  history: readonly HistoryEntry[],
): Promise<ReadonlyMap<string, TurnSpeaker>> {
  const speakers = new Map<string, TurnSpeaker>([[envelope.senderId, toTurnSpeaker(identity)]]);
  const others = new Set<string>();
  for (const entry of history) {
    if (entry.role === "agent" || entry.senderId === envelope.senderId) continue;
    if (entry.senderId === AGENT_SENDER_ID || entry.senderId === "") continue;
    others.add(entry.senderId);
  }

  const groupId = envelope.isGroup ? envelope.conversationId : undefined;
  const resolved = await Promise.all(
    [...others].map(async (senderId) => {
      try {
        const other = await ctx.identity.resolve({ channel: envelope.channel, senderId, groupId });
        return [senderId, toTurnSpeaker(other)] as const;
      } catch (err) {
        console.error("[worker] resolve vai người trong history lỗi:", err);
        return null;
      }
    }),
  );
  for (const pair of resolved) {
    if (pair !== null) speakers.set(pair[0], pair[1]);
  }
  return speakers;
}

/**
 * Đóng lượt: lưu reply agent vào history phòng (lượt sau thấy chính mình đã trả gì) rồi đẩy cả
 * cửa sổ hội thoại sang đường ghi dài hạn. Cả hai đều best-effort — lỗi log rồi thôi, vì reply đã
 * gửi đi và distill chỉ là việc nền.
 */
async function rememberTurn(
  ctx: WorkerContext,
  envelope: Envelope,
  agent: RootAgent,
  replyText: string,
  history: readonly HistoryEntry[],
  memoryScope: MemoryScope | undefined,
  timer: TurnTimer,
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

  // Nén ngắn hạn TRƯỚC đường dài hạn, và KHÔNG phụ thuộc memoryScope: phòng chưa bind không
  // distill được nhưng vẫn phải giữ được mạch hội thoại.
  const window = [...history, reply];
  if (ctx.compactor !== undefined) {
    try {
      // Đọc LẠI buffer rộng thay vì tái dùng `window`: compactor cần cả phần đã trôi khỏi cửa sổ
      // agent, mà `window` chỉ dôi ra đúng 1 entry so với cửa sổ đó. Một lượt đọc Redis thêm,
      // nằm sau broadcast nên không ai chờ.
      const buffered = await ctx.history.recent(envelope.conversationId, HISTORY_BUFFER_TURNS);
      await ctx.compactor.afterTurn(envelope.conversationId, buffered, signal);
    } catch (err) {
      console.error("[worker] nén hội thoại lỗi:", err);
    }
    // Cả nén và chưng cất đều là lượt LLM, chạy SAU broadcast nhưng vẫn trong khoá phòng → tin kế
    // của phòng phải chờ. Đo tách hai khâu để biết cái nào đáng đẩy ra ngoài lượt.
    timer.lap("compact");
  }

  // Chưa bind phòng (không có scope) hoặc chưa bật memory dài hạn → không có chỗ ghi, bỏ qua.
  if (memoryScope === undefined || ctx.memoryWriters === undefined) return;
  // Writer THEO agent: agent này nhớ gì do `memorySpec` của nó quyết. Không có writer khớp →
  // bỏ ghi, KHÔNG mượn writer của agent khác (chưng cất sai prompt còn tệ hơn không nhớ).
  const writer = ctx.memoryWriters.for(agent.agentType);
  if (writer === undefined) return;
  try {
    await writer.afterTurn(memoryScope, window, signal);
  } catch (err) {
    console.error("[worker] ghi trí nhớ dài hạn lỗi:", err);
  }
  timer.lap("distill");
}

/**
 * Bản tóm hội thoại cũ cho lượt này. Best-effort: chưa nối tầng nén, hoặc Redis hỏng → chạy bằng
 * cửa sổ history thôi. Thiếu ngữ cảnh cũ tệ hơn có, nhưng vẫn tốt hơn là hỏng cả lượt.
 */
async function readSummary(ctx: WorkerContext, conversationId: string): Promise<string | undefined> {
  if (ctx.summaries === undefined) return undefined;
  try {
    return await ctx.summaries.get(conversationId);
  } catch (err) {
    console.error("[worker] đọc bản tóm hội thoại lỗi:", err);
    return undefined;
  }
}

/**
 * Việc nhóm này đang được hỏi mà chưa trả lời (§6), rút gọn cho khối ngữ cảnh.
 *
 * Best-effort: chưa nối tầng workflows, hoặc Postgres chớp → lượt chạy không có khối đó. Thà
 * thiếu khối còn hơn chết cả lượt vì một truy vấn phụ.
 *
 * Việc KHÔNG có khoá (`subject`) bị bỏ: model trả lời bằng cách truyền khoá lại, không có khoá
 * thì không có gì cho nó chép. Slug lạ (def đã gỡ) cũng bỏ — không biết in nhãn gì.
 */
async function readPendingNotices(
  ctx: WorkerContext,
  envelope: Envelope,
): Promise<readonly PendingNotice[] | undefined> {
  if (ctx.workflow === undefined || !envelope.isGroup) return undefined;
  try {
    const room = { channel: envelope.channel, groupId: envelope.conversationId };
    const requests = await ctx.workflow.openForTarget(room);
    if (requests.length === 0) return undefined;
    const defs = new Map(ctx.workflow.catalog().map((def) => [def.name, def]));
    return requests.flatMap((request) => {
      const def = defs.get(request.workflow);
      if (def === undefined || request.subject === undefined) return [];
      return [
        {
          workflow: def.name,
          subject: request.subject,
          subjectLabel: def.subjectLabel,
          answerLabel: def.answerLabel,
        },
      ];
    });
  } catch (err) {
    console.error("[worker] đọc việc đang chờ lỗi:", err);
    return undefined;
  }
}

/**
 * Nhịp "đang xử lý" bind sẵn target của lượt: agent chỉ gọi () => Promise, không biết channel/
 * conversationId. Sender chọn theo channel; kênh chưa có adapter → noop (factory tự fallback).
 */
/**
 * Gửi tin "đang làm việc X" giữa lượt (agent gọi khi chạm tool chậm — xem `Tool.announce`).
 *
 * KHÔNG ghi vào history: đây là câu trấn an cố định, không mang dữ kiện. Ghi vào thì mỗi lượt tra
 * cứu đẻ thêm một lượt agent rỗng trong cửa sổ 20 tin và trong lô chưng cất trí nhớ.
 */
function buildAnnouncer(ctx: WorkerContext, envelope: Envelope): (text: string) => Promise<void> {
  const target = {
    channel: envelope.channel,
    conversationId: envelope.conversationId,
    isGroup: envelope.isGroup,
    replyToSenderId: envelope.senderId,
    replyToSenderName: envelope.senderName,
  };
  return (text: string) => ctx.broadcaster.send(target, capForChannel(envelope.channel, text));
}

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
 * Đại lý sở hữu PHÒNG này (nhóm đã `/ketnoi-daily`). Một lượt tra dùng cho hai việc: chủ sở hữu
 * trí nhớ (resolveMemoryScope) và phạm vi dữ liệu của tool nghiệp vụ (ToolContext.roomCustomerId).
 *
 * Chat 1-1 / chưa nối tầng auth-group → undefined: không có phòng thì không có chủ phòng.
 * Agent `directOnly` cũng bỏ qua: nó không phục vụ phòng, tra chỉ tốn một lượt I/O vô ích.
 */
async function resolveRoomCustomer(
  ctx: WorkerContext,
  envelope: Envelope,
  agent: RootAgent,
): Promise<string | undefined> {
  if (agent.directOnly || ctx.groupCustomer === undefined || !envelope.isGroup) return undefined;
  return ctx.groupCustomer.customerIdOf({
    channel: envelope.channel,
    groupId: envelope.conversationId,
  });
}

/**
 * Ai sở hữu fact của lượt này:
 *
 * ```
 * agent directOnly + chat 1-1   → owner = NGƯỜI GÕ (trợ lý riêng: fact là của chính họ)
 * agent directOnly + nhóm       → undefined (agent 1-1 lạc vào nhóm: không rõ fact của ai)
 * nhóm đã /ketnoi-daily         → owner = KHÁCH sở hữu phòng
 * nhóm CHƯA bind                → owner = CHÍNH PHÒNG (thu thập đặc trưng + vấn đề của nhóm)
 * chat 1-1, agent không directOnly → undefined
 * ```
 *
 * Scope phòng KHÔNG lấy customerId từ Identity người gõ: nhân viên gõ trong phòng khách X thì
 * Identity không mang X, mà fact vẫn là của X.
 *
 * Nhóm chưa bind ghi vào không gian `room` chứ KHÔNG mượn tạm một customerId: hai không gian định
 * danh khác nhau, trộn vào là fact của phòng lạ lọt sang khách thật. Hệ quả đã biết: phòng bind
 * SAU sẽ không recall lại được fact ghi lúc còn `room` (khác owner) — cần một bước chuyển chủ nếu
 * muốn giữ, chưa làm.
 *
 * Chat 1-1 với agent KHÔNG directOnly vẫn không nhớ: chỉ trợ lý riêng mới có trí nhớ cá nhân
 * (agent đại lý DM riêng vẫn là chuyện của phòng, không của người).
 */
function resolveMemoryScope(
  envelope: Envelope,
  agent: RootAgent,
  roomCustomerId: string | undefined,
): MemoryScope | undefined {
  if (agent.directOnly) {
    if (envelope.isGroup) return undefined;
    return {
      ownerKind: MemoryOwnerKind.User,
      ownerId: envelope.senderId,
      channel: envelope.channel,
      conversationId: envelope.conversationId,
    };
  }

  if (roomCustomerId !== undefined) {
    return {
      ownerKind: MemoryOwnerKind.Customer,
      ownerId: roomCustomerId,
      channel: envelope.channel,
      conversationId: envelope.conversationId,
    };
  }

  // Nhóm chưa bind: vẫn nhớ, nhưng nhớ theo PHÒNG. Chat 1-1 (agent không directOnly) thì thôi —
  // không có phòng nào để quy fact về.
  if (!envelope.isGroup) return undefined;
  return {
    ownerKind: MemoryOwnerKind.Room,
    ownerId: envelope.conversationId,
    channel: envelope.channel,
    conversationId: envelope.conversationId,
  };
}
