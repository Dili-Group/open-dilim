// index.ts — điểm vào tầng announcements. Bootstrap dựng service + poller, tool gọi qua
// AnnouncePort. Vì sao không dùng workflows/: xem đầu types.ts.
//
// CHỈ BOOTSTRAP IMPORT FILE NÀY. Barrel re-export store.ts/rooms.ts → db/client.ts → config.ts,
// mà config.ts throw ngay lúc import khi thiếu env (CI chạy `bun test` không có `.env`). Tầng
// tools/agents/worker cần hằng số hay kiểu thì import thẳng `./types.ts` (file LÁ).

export { AnnouncementService, DRAFT_TTL_SEC } from "./service.ts";
export { SqlAnnouncementStore } from "./store.ts";
export { SqlDealerRoomLookup } from "./rooms.ts";
export { RedisDraftStore } from "./drafts.ts";
export { startAnnouncementPoller } from "./poller.ts";
export { AnnouncementKind, MAX_ATTEMPTS } from "./types.ts";
export type {
  AnnouncePort,
  AnnouncementDeps,
  AnnouncementStatus,
  DealerRoom,
  DraftOutcome,
  QueueOutcome,
} from "./types.ts";
