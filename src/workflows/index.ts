// index.ts — điểm lắp tầng workflows (§6: việc treo chờ người ở nhóm khác trả lời).
//
// Bootstrap dựng SqlPendingStore + registry rồi nối các port đã có sẵn (broker publish, history,
// dedupe, broadcaster) — tầng này KHÔNG tự mở kết nối nào. Tool chung (tools/impl/workflow/) gọi
// openRequest/answerRequest; poller lo phần nhắc lại và đóng quá hạn.

export { SqlPendingStore } from "./store.ts";
export { WorkflowRegistry } from "./registry.ts";
export { WorkflowService } from "./service.ts";
export type { WorkflowPort, OpenRequestInput, AnswerRequestInput } from "./service.ts";
export { buildWorkflowRegistry, ASK_ORIGIN_ORDER, needsOriginOrder } from "./defs/index.ts";
export {
  openRequest,
  answerRequest,
  dispatchAsk,
  buildAskEnvelope,
  askMsgId,
} from "./engine.ts";
export { startWorkflowPoller, tick, DEFAULT_TICK_MS } from "./poller.ts";
export {
  nextRemindAt,
  expiresAt,
  shiftIntoOfficeHours,
  OFFICE_START_HOUR,
  OFFICE_END_HOUR,
} from "./schedule.ts";
export { WORKFLOW_SENDER_ID } from "./types.ts";
export type { OpenInput, OpenOutcome, AnswerInput, AnswerOutcome } from "./engine.ts";
export type { RunningWorkflowPoller } from "./poller.ts";
export type { WorkflowDefDeps } from "./defs/index.ts";
export type {
  PendingRequest,
  PendingStore,
  RoomRef,
  TargetResolution,
  WorkflowDef,
  WorkflowDeps,
} from "./types.ts";
