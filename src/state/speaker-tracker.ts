// speaker-tracker.ts — vạch "ai vừa nói trong phòng", trên Redis.
//
// Dùng cho đúng một việc: ingest phát hiện ĐỔI NGƯỜI NÓI để kích hoạt chưng cất trí nhớ (một
// người nói mấy câu, người khác đáp lại = một nhịp trao đổi đã trọn). Xem message-ingest/gateway.ts
// và state/memory-writer.ts.
//
// GETSET (không phải GET rồi SET) vì hai worker/process cùng nhận tin của một phòng: đọc-rồi-ghi
// hai lệnh thì cả hai cùng thấy người cũ và cùng kích hoạt chưng cất.

import type { RedisCommand } from "../redis/types.ts";
import type { SpeakerTracker } from "../message-ingest/deps.ts";

const KEY_PREFIX = "dilim:last-speaker:";

/** Phòng im lâu thì vạch tự hết — người nói kế tiếp coi như mở nhịp mới, không phải "đổi người". */
const TTL_SEC = 24 * 60 * 60;

function key(channel: string, conversationId: string): string {
  return `${KEY_PREFIX}${channel}:${conversationId}`;
}

export class RedisSpeakerTracker implements SpeakerTracker {
  constructor(private readonly send: RedisCommand) {}

  async swap(
    channel: string,
    conversationId: string,
    senderId: string,
  ): Promise<string | undefined> {
    const redisKey = key(channel, conversationId);
    const previous = await this.send("GETSET", [redisKey, senderId]);
    // EXPIRE sau GETSET: TTL đặt lại mỗi tin, nên phòng đang nói chuyện thì vạch không rơi giữa nhịp.
    await this.send("EXPIRE", [redisKey, String(TTL_SEC)]);
    return typeof previous === "string" && previous !== "" ? previous : undefined;
  }
}
