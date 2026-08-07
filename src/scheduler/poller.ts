// poller.ts — vòng tick: quét job tới hạn → giành (CAS) → bắn → tính lịch kế tiếp.
//
// MISS-FIRE (§8): instance down qua giờ chạy → lên lại thấy `next_run_at < now` → bắn BÙ ĐÚNG
// MỘT LẦN rồi nhảy tới mốc kế tiếp tính từ BÂY GIỜ. Không replay mọi lần lỡ: mười cái báo cáo
// cuối ngày dội vào nhóm lúc 8h sáng còn tệ hơn mất chín cái.
//
// Cô lập lỗi theo job: cron expr hỏng / Redis chớp / phòng lạ chỉ giết đúng job đó, tick vẫn
// chạy tiếp các job còn lại.

import { nextRunAfter } from "./schedule.ts";
import { fireJob } from "./fire.ts";
import type { SchedulerDeps, SchedulerJob } from "./types.ts";

/** Nhịp quét. Lịch nhỏ nhất của cron là phút → 30s là đủ dày để không trễ quá 1 phút. */
export const DEFAULT_TICK_MS = 30_000;

export interface RunningScheduler {
  /** Dừng nhận tick mới + chờ tick đang chạy xong (không cắt giữa lúc đang bắn). */
  stop(): Promise<void>;
}

/** Chạy 1 lượt quét. Export riêng để test gọi thẳng, không phải chờ timer. */
export async function tick(deps: SchedulerDeps, nowMs: number): Promise<void> {
  const jobs = await deps.repo.due(new Date(nowMs));
  for (const job of jobs) {
    try {
      await runJob(deps, job, nowMs);
    } catch (err) {
      console.error(`[scheduler] job ${job.id} lỗi:`, err);
    }
  }
}

async function runJob(deps: SchedulerDeps, job: SchedulerJob, nowMs: number): Promise<void> {
  // Cron hỏng → throw ở đây, TRƯỚC claim: job giữ nguyên lịch cũ và kêu lại mỗi tick cho tới khi
  // người sửa expr. Nuốt lỗi rồi tắt job là mất báo cáo mà không ai biết.
  const next = new Date(nextRunAfter(job.schedule, nowMs));
  const scheduled = job.nextRunAt;

  // Job mới thêm (chưa có lịch): chỉ đặt mốc đầu tiên. Bắn ngay lúc thêm là bắn sai giờ.
  if (scheduled === undefined) {
    await deps.repo.claim({ id: job.id, expected: undefined, next });
    return;
  }

  // Giành TRƯỚC khi bắn: thua thì instance khác đang bắn, tick này im lặng rút.
  const claimed = await deps.repo.claim({
    id: job.id,
    expected: scheduled,
    next,
    ran: new Date(nowMs),
  });
  if (!claimed) return;

  await fireJob(deps, job, scheduled.getTime());
}

/** Khởi động vòng tick. Tick chạy tuần tự — tick sau chờ tick trước xong (không chồng lượt). */
export function startScheduler(deps: SchedulerDeps, tickMs: number = DEFAULT_TICK_MS): RunningScheduler {
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();

  const timer = setInterval(() => {
    if (stopped) return;
    inFlight = inFlight.then(async () => {
      if (stopped) return;
      try {
        await tick(deps, Date.now());
      } catch (err) {
        // Postgres chết → tick sau thử lại. Không để một tick hỏng giết cả process.
        console.error("[scheduler] tick lỗi:", err);
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
