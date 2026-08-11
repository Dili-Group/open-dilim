// turn-marker.ts — vạch "tin hội thoại mới nhất của phòng", trên Redis.
//
// Dùng cho đúng một việc: worker bỏ lượt đã lỗi thời khi người dùng gõ liền mấy tin (xem
// worker/burst.ts). Giá trị là EVENT TIME (ms) chứ không phải msgId — so được thứ tự, và mọi kiểu
// hỏng (vạch chưa kịp nâng, nâng tới trễ, đọc ra rác) đều rơi về "không ai bị bỏ".
//
// SET trần, KHÔNG so cũ-mới trước khi ghi: hai process cùng nhận tin một phòng có thể ghi lộn thứ
// tự, nhưng vạch tụt lại chỉ làm gom hụt (mỗi tin một lượt như cũ), không làm mất tin.

import type { RedisCommand } from "../redis/types.ts";
import type { TurnMarker } from "../message-ingest/deps.ts";

const KEY_PREFIX = "dilim:last-turn:";

/** Vạch chỉ có nghĩa trong đúng cửa sổ burst (vài giây). TTL chỉ để key tự dọn. */
const TTL_SEC = 60 * 60;

function key(channel: string, conversationId: string): string {
  return `${KEY_PREFIX}${channel}:${conversationId}`;
}

/**
 * MỘT instance, hai góc nhìn (như broker): `mark` cho ingest (port `TurnMarker`), `latestTs` cho
 * worker (port `LatestTurnReader` — khớp theo cấu trúc, kiểm ở chỗ wiring bootstrap).
 */
export class RedisTurnMarker implements TurnMarker {
  constructor(private readonly send: RedisCommand) {}

  async mark(channel: string, conversationId: string, ts: number): Promise<void> {
    await this.send("SET", [key(channel, conversationId), String(ts), "EX", String(TTL_SEC)]);
  }

  async latestTs(channel: string, conversationId: string): Promise<number | undefined> {
    const reply = await this.send("GET", [key(channel, conversationId)]);
    if (typeof reply !== "string") return undefined;
    const ts = Number(reply);
    return Number.isFinite(ts) ? ts : undefined;
  }
}
