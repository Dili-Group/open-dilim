// router.ts — chọn Broadcaster theo channel. Tự nó LÀ Broadcaster (target đã mang `channel`) nên
// worker không phải biết có nhiều kênh: vẫn `ctx.broadcaster.send(target, text)` như trước.
//
// Khác TypingFactory (`for(channel)` rồi bind sẵn cho agent loop) vì broadcast chỉ gọi 1 lần cuối
// lượt — không có gì để bind trước.

import type { Broadcaster, BroadcastTarget, OutboundMedia } from "./types.ts";

export class BroadcastRouter implements Broadcaster {
  private readonly byChannel = new Map<string, Broadcaster>();

  /** fallback dùng cho channel chưa đăng ký (dev: console). */
  constructor(private readonly fallback: Broadcaster) {}

  register(channel: string, broadcaster: Broadcaster): this {
    this.byChannel.set(channel, broadcaster);
    return this;
  }

  send(target: BroadcastTarget, text: string): Promise<void> {
    return this.resolve(target.channel).send(target, text);
  }

  sendMedia(target: BroadcastTarget, media: OutboundMedia): Promise<void> {
    return this.resolve(target.channel).sendMedia(target, media);
  }

  private resolve(channel: string): Broadcaster {
    return this.byChannel.get(channel) ?? this.fallback;
  }
}
