// typing-factory.ts — chọn TypingSender theo channel (idiom giống AgentRegistry: map + fallback).
// Worker cầm factory, `for(channel)` ra sender đúng kênh mỗi lượt. Kênh chưa có adapter → fallback
// noop: typing là best-effort, thiếu sender KHÔNG phải lỗi, chỉ là không có nhịp báo.

import type { TypingSender } from "./typing.ts";

const NOOP_SENDER: TypingSender = { typing: () => Promise.resolve() };

export class TypingFactory {
  private readonly byChannel = new Map<string, TypingSender>();

  /** fallback dùng cho channel chưa đăng ký; mặc định noop (không nhịp, không lỗi). */
  constructor(private readonly fallback: TypingSender = NOOP_SENDER) {}

  register(channel: string, sender: TypingSender): this {
    this.byChannel.set(channel, sender);
    return this;
  }

  for(channel: string): TypingSender {
    return this.byChannel.get(channel) ?? this.fallback;
  }
}
