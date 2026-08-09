// poller.ts — nhịp trông MỌI việc đang treo: đóng cái quá hạn, nhắc lại cái còn kịp.
//
// ĐÓNG TRƯỚC, NHẮC SAU. Đảo lại thì một việc vừa hết hạn còn kịp ăn thêm một tin nhắc rồi mới bị
// đóng — bên kia bị hỏi về việc hệ thống đã bỏ.
//
// Hết hạn KHÔNG báo cho ai: quá hạn thì việc đã sang tay người thật, thêm một tin tự động chỉ làm
// nhiễu. Vẫn log số lượng để soát.
//
// Cô lập lỗi theo việc: một nhóm lạ / Redis chớp chỉ giết đúng việc đó, tick vẫn chạy tiếp.

import { captureError } from "../observability/sentry.ts";
import { dispatchAsk } from "./engine.ts";
import { nextRemindAt } from "./schedule.ts";
import type { WorkflowRegistry } from "./registry.ts";
import type { PendingRequest, WorkflowDeps } from "./types.ts";

/** Nhịp quét. Mốc nhắc tính theo giờ nên 1 phút là quá đủ độ mịn. */
export const DEFAULT_TICK_MS = 60_000;

/**
 * Số việc nhắc song song trong một batch. Store đã chặn trần mỗi tick (`MAX_REMIND_PER_TICK`),
 * batch ở đây chỉ để 100 việc không phải xếp hàng tuần tự — nhưng vẫn không thả hết một lượt,
 * tránh mở quá nhiều kết nối Postgres / lượt broadcast cùng lúc.
 */
export const REMIND_BATCH_SIZE = 10;

export interface RunningWorkflowPoller {
  /** Dừng nhận tick mới + chờ tick đang chạy xong (không cắt giữa lúc đang bắn). */
  stop(): Promise<void>;
}

/** Chạy 1 lượt quét. Export riêng để test gọi thẳng, không phải chờ timer. */
export async function tick(
  deps: WorkflowDeps,
  registry: WorkflowRegistry,
  nowMs: number,
): Promise<void> {
  const now = new Date(nowMs);

  const expired = await deps.store.expireDue(now);
  if (expired > 0) console.warn(`[workflows] đóng ${expired} việc quá hạn chờ trả lời.`);

  const due = await deps.store.dueForRemind(now);

  // Batch tuần tự, trong batch chạy song song. `remindSafely` không bao giờ reject nên một việc
  // hỏng không kéo cả batch xuống — batch sau vẫn chạy.
  for (let start = 0; start < due.length; start += REMIND_BATCH_SIZE) {
    const batch = due.slice(start, start + REMIND_BATCH_SIZE);
    await Promise.all(batch.map((request) => remindSafely(deps, registry, request, nowMs)));
  }
}

/** Bọc `remind` để lỗi cô lập theo việc (Promise.all không được thấy reject). */
async function remindSafely(
  deps: WorkflowDeps,
  registry: WorkflowRegistry,
  request: PendingRequest,
  nowMs: number,
): Promise<void> {
  try {
    await remind(deps, registry, request, nowMs);
  } catch (err) {
    console.error(`[workflows] nhắc việc ${request.id} lỗi:`, err);
    captureError(err, "workflows.remind", { requestId: request.id, workflow: request.workflow });
  }
}

/**
 * Nhắc một việc: GIÀNH trước, bắn sau. Thua CAS = instance khác đang nhắc → rút im lặng.
 *
 * `claimRemind` cũng là chỗ tăng `askCount`, nên mốc nhắc kế tiếp và msgId dedupe của lượt hỏi
 * luôn đi cùng nhau — không có đường nào bắn hai lần cùng một msgId.
 */
async function remind(
  deps: WorkflowDeps,
  registry: WorkflowRegistry,
  request: PendingRequest,
  nowMs: number,
): Promise<void> {
  const expected = request.nextRemindAt;
  // Việc treo mà không có mốc nhắc = row hỏng (sửa tay DB). Bỏ qua, không đoán mốc mới.
  if (expected === undefined) return;

  // Slug lạ (def bị gỡ khỏi registry mà việc còn treo) → không biết soạn câu gì, không biết nhắc
  // theo nhịp nào. Kêu lên rồi bỏ qua: việc vẫn tự hết hạn theo `expires_at`.
  const def = registry.resolve(request.workflow);
  if (def === undefined) {
    console.error(`[workflows] việc ${request.id} thuộc workflow lạ "${request.workflow}" — bỏ nhắc.`);
    return;
  }

  const next = nextRemindAt(def, nowMs);
  // def đổi sang không-nhắc trong lúc việc đang treo → thôi nhắc, để nó chờ hết hạn.
  if (next === undefined) return;

  const claimed = await deps.store.claimRemind({ id: request.id, expected, next });
  if (!claimed) return;

  // askCount trong DB vừa +1; bản trong tay còn là số cũ → cộng bù để msgId khớp lần hỏi này.
  await dispatchAsk(deps, def, { ...request, askCount: request.askCount + 1 }, nowMs, true);
}

/** Khởi động vòng tick. Tick chạy tuần tự — tick sau chờ tick trước xong (không chồng lượt). */
export function startWorkflowPoller(
  deps: WorkflowDeps,
  registry: WorkflowRegistry,
  tickMs: number = DEFAULT_TICK_MS,
): RunningWorkflowPoller {
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();

  const timer = setInterval(() => {
    if (stopped) return;
    inFlight = inFlight.then(async () => {
      if (stopped) return;
      try {
        await tick(deps, registry, Date.now());
      } catch (err) {
        // Postgres chết → tick sau thử lại. Không để một tick hỏng giết cả process.
        console.error("[workflows] tick lỗi:", err);
        captureError(err, "workflows.tick");
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
