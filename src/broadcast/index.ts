// index.ts — điểm vào tầng broadcast. Bootstrap chọn Broadcaster (dev: console), worker gửi.

export { ConsoleBroadcaster } from "./console.ts";
export { ZaloBroadcaster } from "./zalo.ts";
export { ZaloOaBroadcaster } from "./zalo-oa.ts";
export { MessengerBroadcaster } from "./messenger.ts";
export { MessengerTypingSender } from "./messenger-typing.ts";
export { ZaloOaTokenSource } from "./zalo-oa-token.ts";
export type { ZaloOaTokenConfig, ZaloOaTokenPort } from "./zalo-oa-token.ts";
export { BroadcastRouter } from "./router.ts";
export type { Broadcaster, BroadcastTarget, OutboundMedia } from "./types.ts";
export { capForChannel } from "./limits.ts";
export { extractQrMedia } from "./qr.ts";
export { ConsoleTypingSender } from "./typing-console.ts";
export { ZaloTypingSender } from "./zalo-typing.ts";
export { TypingFactory } from "./typing-factory.ts";
export type { TypingSender, TypingTarget } from "./typing.ts";
