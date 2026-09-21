// poller.ts — vòng tick của phễu proactive: câu hỏi đến hạn chờ → TẦNG 1 (đã có ai đáp chưa?)
// → trần tần suất → TẦNG 2 (phán quyết có kiểu; chưa nối thì KHÔNG nhặt) → TẦNG 3 publish Envelope
// `proactive` vào đúng queue tin thường. Worker/agent xử lý phần còn lại, poller không gọi LLM
// trả lời — nó chỉ quyết "có đáng đánh thức agent không".
//
// Cùng khung chạy với scheduler/poller.ts: tick tuần tự, lỗi cô lập per-câu, stop chờ tick xong.

import { captureError } from "../observability/sentry.ts";
import { HISTORY_WINDOW_TURNS } from "../state/session.ts";
import type { Broker } from "../message-ingest/deps.ts";
import type { HistoryReader } from "../worker/index.ts";
import type { ProactiveSpec } from "../agents/types.ts";
import type { ProactiveJudgeSpec } from "./buckets.ts";
import type { HistoryEntry } from "../types/index.ts";
import type { RedisCommand } from "../redis/types.ts";
import type { Envelope } from "../types/index.ts";
import type { PendingQuestion, ProactivePendingStore } from "./pending.ts";

const RATE_KEY_PREFIX = "dilim:proactive:rate:";
const RATE_WINDOW_SEC = 60 * 60;

export interface ProactivePollerDeps {
  readonly pending: ProactivePendingStore;
  readonly history: HistoryReader;
  readonly broker: Broker;
  readonly send: RedisCommand;
  /** Cùng hàm tra của ingest — spec đổi (agent tắt phễu) thì câu đang chờ cũng rơi theo. */
  readonly specFor: (channel: string, groupId?: string) => ProactiveSpec | undefined;
  /**
   * TẦNG 2 — cổng phán quyết (proactive/judge.ts): true = đáng đánh thức agent.
   *
   * undefined = CHƯA NỐI → KHÔNG nhặt câu nào. Đây là fail-closed có chủ đích: tầng 0 không còn
   * danh sách regex gác trước nữa, nên "chưa nối thì cho qua" sẽ thành đánh thức agent cho mọi
   * câu chưa ai đáp — đúng thứ phễu sinh ra để tránh.
   */
  readonly classify?: (input: {
    readonly question: PendingQuestion;
    readonly recent: readonly HistoryEntry[];
    /** Phần khai năng lực + ngưỡng của agent phục vụ phòng này. */
    readonly spec: ProactiveJudgeSpec;
  }) => Promise<boolean>;
}

export interface RunningProactivePoller {
  stop(): Promise<void>;
}

/** Chạy 1 lượt quét. Export riêng để test gọi thẳng, không chờ timer. */
export async function proactiveTick(deps: ProactivePollerDeps, nowMs: number): Promise<void> {
  const due = await deps.pending.claimDue(nowMs);
  for (const question of due) {
    try {
      await pickUp(deps, question);
    } catch (err) {
      console.error(`[proactive] nhặt câu hỏi ${question.msgId} lỗi:`, err);
      captureError(err, "proactive.pickup", {
        channel: question.channel,
        msgId: question.msgId,
      });
    }
  }
}

async function pickUp(deps: ProactivePollerDeps, question: PendingQuestion): Promise<void> {
  const spec = deps.specFor(question.channel, question.conversationId);
  if (spec === undefined) return;

  // TẦNG 1 — NGƯỜI KHÁC (đại lý khác, nhân viên, hay chính agent) đã lên tiếng sau câu hỏi →
  // coi như có người lo, agent đứng ngoài. Câu hỏi trôi khỏi cửa sổ history cũng rơi vào đây:
  // phòng nói chuyện dày tới mức đó thì câu hỏi hoặc đã được đáp hoặc đã nguội.
  const recent = await deps.history.recent(question.conversationId, HISTORY_WINDOW_TURNS);
  const answered = recent.some((e) => e.ts > question.ts && e.senderId !== question.senderId);
  if (answered) return;

  if (!(await underRateLimit(deps.send, spec, question))) return;

  // Cổng phán quyết dùng LẠI cửa sổ history vừa đọc ở tầng 1 — cùng một dữ kiện, đọc hai lần là
  // tốn công mà còn có thể lệch nhau giữa hai lần gọi.
  if (deps.classify === undefined) return;
  if (!(await deps.classify({ question, recent, spec: spec.judge }))) return;

  await deps.broker.publish(toProactiveEnvelope(question));
}

/**
 * INCR trước rồi so trần: hai instance cùng đếm không bao giờ cùng thấy "còn chỗ" cho cùng một
 * suất. Suất bị tầng sau loại vẫn tính — chấp nhận, trần là van an toàn chứ không phải quota.
 */
async function underRateLimit(
  send: RedisCommand,
  spec: ProactiveSpec,
  question: PendingQuestion,
): Promise<boolean> {
  const key = `${RATE_KEY_PREFIX}${question.channel}:${question.conversationId}`;
  const count = await send("INCR", [key]);
  if (count === 1) await send("EXPIRE", [key, String(RATE_WINDOW_SEC)]);
  return typeof count === "number" && count <= spec.maxPerRoomPerHour;
}

/**
 * Envelope mang NGUYÊN câu hỏi + người hỏi thật: worker AUTH đúng vai người đó, broadcast @ lại
 * đúng người đó. Tin gốc đã nằm trong history từ lúc ingest — lượt này chỉ là cú đánh thức.
 */
function toProactiveEnvelope(q: PendingQuestion): Envelope {
  return {
    source: "proactive",
    channel: q.channel,
    msgId: `proactive:${q.msgId}`,
    conversationId: q.conversationId,
    senderId: q.senderId,
    ...(q.senderName === undefined ? {} : { senderName: q.senderName }),
    isGroup: true,
    addressedToAgent: true,
    text: q.text,
    mentions: [],
    ts: q.ts,
  };
}

/** Khởi động vòng tick — cùng khung với scheduler: tuần tự, stop chờ tick đang chạy. */
export function startProactivePoller(
  deps: ProactivePollerDeps,
  tickMs: number,
): RunningProactivePoller {
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();

  const timer = setInterval(() => {
    if (stopped) return;
    inFlight = inFlight.then(async () => {
      if (stopped) return;
      try {
        await proactiveTick(deps, Date.now());
      } catch (err) {
        console.error("[proactive] tick lỗi:", err);
        captureError(err, "proactive.tick");
      }
    });
  }, tickMs);

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}
