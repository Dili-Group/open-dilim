// index.ts — điểm vào tầng announcements. Bootstrap dựng service + poller, tool gọi qua
// AnnouncePort. Vì sao không dùng workflows/: xem đầu types.ts.

export { AnnouncementService, DRAFT_TTL_SEC } from "./service.ts";
export { SqlAnnouncementStore } from "./store.ts";
export { SqlDealerRoomLookup } from "./rooms.ts";
export { RedisDraftStore } from "./drafts.ts";
export { startAnnouncementPoller, MAX_ATTEMPTS } from "./poller.ts";
export { AnnouncementKind } from "./types.ts";
export type {
  AnnouncePort,
  AnnouncementDeps,
  AnnouncementStatus,
  DealerRoom,
  DraftOutcome,
  QueueOutcome,
} from "./types.ts";
