// index.ts — phễu PROACTIVE: nhặt câu hỏi trong nhóm không mention agent mà không ai trả lời.
//
// Bốn tầng, mỗi tầng rẻ hơn tầng sau và lọc phần lớn phần còn lại:
//   TẦNG 0 (gate.ts, tại ingest)  — regex intent + guard tin của chính agent. 0 token.
//   TẦNG 1 (poller.ts, sau waitMs) — có NGƯỜI KHÁC đáp rồi thì đứng ngoài. 0 token.
//   TẦNG 2 (poller.ts, seam)       — classifier model rẻ, CHƯA NỐI thì cho qua.
//   TẦNG 3 (poller.ts → broker)    — Envelope `proactive` đánh thức đúng agent của channel.
//
// Agent nào dùng phễu = agent đó khai `proactive` trên RootAgentProfile (mặc định đóng).

export { passesProactiveGate, type ProactiveGateInput } from "./gate.ts";
export { ProactiveIngest, type ProactiveIngestDeps } from "./ingest.ts";
export {
  RedisProactivePending,
  parsePendingQuestion,
  type PendingQuestion,
  type ProactivePendingStore,
} from "./pending.ts";
export {
  proactiveTick,
  startProactivePoller,
  type ProactivePollerDeps,
  type RunningProactivePoller,
} from "./poller.ts";
export { proactiveSpecFor } from "./spec.ts";
export { buildProactiveVerify, type ProactiveVerify, type ProactiveVerifyDeps } from "./verify.ts";
