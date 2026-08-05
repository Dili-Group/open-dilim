// index.ts — điểm vào tầng broadcast. Bootstrap chọn Broadcaster (dev: console), worker gửi.

export { ConsoleBroadcaster } from "./console.ts";
export { ZaloBroadcaster } from "./zalo.ts";
export { BroadcastRouter } from "./router.ts";
export type { Broadcaster, BroadcastTarget } from "./types.ts";
export { capForChannel } from "./limits.ts";
export { ConsoleTypingSender } from "./typing-console.ts";
export { ZaloTypingSender } from "./zalo-typing.ts";
export { TypingFactory } from "./typing-factory.ts";
export type { TypingSender, TypingTarget } from "./typing.ts";
