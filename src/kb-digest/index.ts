// index.ts — điểm vào tầng kb-digest. Bootstrap dựng store/extractor/service rồi start poller;
// flash-command chỉ cầm KbReviewPort.

export { SqlKbDigestStore, KB_SHORT_ID_LENGTH } from "./store.ts";
export { KbDigestExtractor, parseExtraction, renderDayTranscript, TRANSCRIPT_MAX_CHARS } from "./extractor.ts";
export { KbDigestService, KbReviewService, renderDigest } from "./service.ts";
export { startKbDigestPoller, tick } from "./poller.ts";
export {
  vnDateOf,
  vnDayBounds,
  vnMinutesOfDay,
  vnClock,
  parseRunTime,
  formatRunTime,
} from "./time.ts";
export { KB_SCAN_CHANNEL } from "./types.ts";
export type {
  KbDecision,
  KbDigestExtraction,
  KbDigestStore,
  KbLoggedMessage,
  KbPendingProposal,
  KbReviewConfig,
  KbReviewPort,
} from "./types.ts";
