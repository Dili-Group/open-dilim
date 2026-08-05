// dedupe.ts — chống xử lý trùng khi kênh retry webhook (§5 bước 4).
//
// SET NX = check-and-mark ATOMIC trong 1 lệnh: hai request cùng msgId vào đúng lúc thì chỉ 1 cái
// nhận true. Bản in-mem đúng nhờ JS single-thread, nhưng sai ngay khi có nhiều process → key phải
// nằm ở Redis. TTL để key không tích tụ vô hạn (retry của kênh chỉ kéo dài vài phút/giờ).

import type { Dedupe } from "../message-ingest/index.ts";
import type { RedisCommand } from "../redis/types.ts";

const KEY_PREFIX = "dilim:seen:";
/** Cửa sổ chống trùng. Đủ dài để phủ mọi retry của kênh, đủ ngắn để key tự dọn. */
const TTL_SEC = 24 * 60 * 60;

function seenKey(channel: string, msgId: string): string {
  return `${KEY_PREFIX}${channel}:${msgId}`;
}

export class RedisDedupe implements Dedupe {
  constructor(private readonly send: RedisCommand) {}

  /** true = lần đầu thấy msgId (đã mark). SET NX trả null khi key đã tồn tại → trùng. */
  async firstSee(channel: string, msgId: string): Promise<boolean> {
    const reply = await this.send("SET", [seenKey(channel, msgId), "1", "NX", "EX", String(TTL_SEC)]);
    return reply !== null && reply !== undefined;
  }

  /** Gỡ mark khi xử lý fail → retry của kênh được phép làm lại (không mất tin). */
  async release(channel: string, msgId: string): Promise<void> {
    await this.send("DEL", [seenKey(channel, msgId)]);
  }
}
