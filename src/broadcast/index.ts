// index.ts — điểm vào tầng broadcast. Bootstrap chọn Broadcaster (dev: console), worker gửi.

export { ConsoleBroadcaster } from "./console.ts";
export type { Broadcaster, BroadcastTarget } from "./types.ts";
