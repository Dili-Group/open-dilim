// index.ts — điểm lắp tầng scheduler. Bootstrap dựng SqlJobRepo (dùng chung cho poller lẫn flash
// command `/lich`) rồi nối các port đã có sẵn từ ingest (broker publish, history, dedupe) —
// scheduler KHÔNG tự mở kết nối nào.

export { SqlJobRepo, SHORT_ID_LENGTH } from "./repo.ts";
export { startScheduler, tick, DEFAULT_TICK_MS } from "./poller.ts";
export { buildCronEnvelope, cronMsgId, fireJob } from "./fire.ts";
export { nextRunAfter, parseCron, VN_UTC_OFFSET_MINUTES } from "./schedule.ts";
export type { RunningScheduler } from "./poller.ts";
export type {
  ClaimInput,
  JobAdmin,
  JobRepo,
  JobSummary,
  SchedulerDeps,
  SchedulerJob,
} from "./types.ts";
