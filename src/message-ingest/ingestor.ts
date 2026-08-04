// ingestor.ts — seam per-channel. Adapter sở hữu TRỌN việc platform-specific: verify chữ ký,
// parse shape, và quyết addressedToAgent (trigger gate). Gateway KHÔNG biết gì về platform.
//
// `isAddressed` = helper CHUNG cho case phổ biến (mention @agent / lệnh). Adapter gọi với
// agentUid riêng của nó — nhưng platform lạ có thể tự định nghĩa "addressed" khác (vd Telegram
// reply-to-bot) mà không phải dùng helper này.

import { parseCommand } from "../flash-command/registry.ts";
import type { Envelope, Mention } from "../types/index.ts";

/** Phần adapter parse ra. Chỉ `source` (=channel) do gateway gắn khi dựng Envelope. */
export type ParsedMessage = Omit<Envelope, "source">;

export interface Ingestor {
  readonly channel: string;
  /**
   * Verify chữ ký webhook (transport auth). false → 401, KHÔNG parse.
   * `rawBody` = body THÔ (chưa JSON.parse) để tính HMAC đúng byte.
   */
  verify(headers: Headers, rawBody: string): boolean;
  /** 1 webhook có thể gói NHIỀU event → mảng. Bỏ event không phải tin nhắn (trả []). */
  parse(payload: unknown): ParsedMessage[];
}

/**
 * Trigger gate phổ biến (§5 bước 2). Direct luôn nhắm agent. Group: chỉ khi /lệnh hoặc
 * @agent — còn lại nuốt vào history làm ngữ cảnh (chống spam + tốn LLM). Thuần, không I/O.
 */
export function isAddressed(
  isGroup: boolean,
  text: string,
  mentions: readonly Mention[],
  agentUid: string,
): boolean {
  if (!isGroup) return true;
  if (parseCommand(text) !== null) return true;
  return mentions.some((m) => m.uid === agentUid);
}
