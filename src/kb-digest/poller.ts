// poller.ts — nhịp chạy digest cuối ngày. Cùng khung với announcements/poller.ts: tick tuần tự
// (không chồng lượt), lỗi tick không giết process, stop() chờ tick đang chạy xong.
//
// Due = đã qua giờ `run_time` (VN) của hôm nay. runDay tự idempotent theo claim (day, group) nên
// tick sau giờ chạy chỉ tốn một query config + một query join — group nào claim rồi thì bỏ qua,
// group có nhân viên nhắn MUỘN hơn giờ chạy vẫn được digest ở tick kế (đến hết ngày).

import { captureError } from "../observability/sentry.ts";
import type { KbDigestService } from "./service.ts";
import type { KbDigestStore } from "./types.ts";
import { parseRunTime, vnDateOf, vnMinutesOfDay } from "./time.ts";

export interface RunningKbDigestPoller {
  stop(): Promise<void>;
}

/** Chạy 1 lượt quét. Export riêng để test gọi thẳng, không chờ timer. */
export async function tick(
  store: KbDigestStore,
  service: KbDigestService,
  nowMs: number,
): Promise<void> {
  const config = await store.getConfig();
  if (config === undefined || !config.enabled) return;

  const runMinutes = parseRunTime(config.runTime);
  // run_time hỏng (sửa tay DB) → coi như chưa tới giờ, log để người ta còn biết mà sửa.
  if (runMinutes === undefined) {
    console.error(`[kb-digest] run_time không parse được: ${config.runTime}`);
    return;
  }
  if (vnMinutesOfDay(nowMs) < runMinutes) return;

  await service.runDay(vnDateOf(nowMs));
}

export function startKbDigestPoller(
  store: KbDigestStore,
  service: KbDigestService,
  tickMs: number,
): RunningKbDigestPoller {
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();

  const timer = setInterval(() => {
    if (stopped) return;
    inFlight = inFlight.then(async () => {
      if (stopped) return;
      try {
        await tick(store, service, Date.now());
      } catch (err) {
        // Postgres/LLM chết → tick sau thử lại. Không để một tick hỏng giết cả process.
        console.error("[kb-digest] tick lỗi:", err);
        captureError(err, "kb-digest.tick");
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
