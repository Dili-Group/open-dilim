// pending.ts — hàng chờ "câu hỏi chưa ai trả lời" của phễu proactive, trên Redis (sống qua
// restart, rẻ hơn nhiều so với dựng job scheduler Postgres cho một mốc chờ vài phút).
//
// HAI cấu trúc cùng khoá member: ZSET giữ GIỜ ĐẾN HẠN, HASH giữ payload câu hỏi. Member theo
// (channel, phòng, người hỏi) — người đó gõ thêm tin trúng trigger thì ZADD/HSET đè lên: đồng
// hồ chờ reset và câu MỚI NHẤT thắng (họ còn đang gõ tiếp thì chưa phải lúc nhảy vào).
//
// Claim khi đến hạn bằng ZREM: trả 1 nghĩa là instance NÀY gỡ được member → mình xử lý; trả 0
// nghĩa là instance khác vừa nhanh tay hơn → rút im lặng. Cùng kiểu giành-trước-bắn của scheduler.

import type { RedisCommand } from "../redis/types.ts";

const DUE_KEY = "dilim:proactive:due";
const PENDING_KEY = "dilim:proactive:pending";
/** Trần member lấy mỗi tick — phễu bình thường chỉ vài câu/giờ, trăm là đã bất thường. */
const CLAIM_BATCH = 100;

/** Câu hỏi đang chờ. Giữ đủ để tầng 2 classify + tầng 3 dựng Envelope, không giữ raw payload. */
export interface PendingQuestion {
  readonly channel: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly senderName?: string;
  readonly msgId: string;
  readonly text: string;
  /** Event time (ms) của tin gốc — tầng 1 so với history để biết có ai đáp SAU câu hỏi chưa. */
  readonly ts: number;
}

export interface ProactivePendingStore {
  /** Đặt/đè lịch chờ cho (phòng, người hỏi). fireAtMs = giờ được phép nhặt. */
  schedule(question: PendingQuestion, fireAtMs: number): Promise<void>;
  /** Gỡ và trả các câu đã đến hạn mà instance này giành được. Payload hỏng thì bỏ qua (đã gỡ). */
  claimDue(nowMs: number): Promise<PendingQuestion[]>;
}

function memberKey(q: Pick<PendingQuestion, "channel" | "conversationId" | "senderId">): string {
  return `${q.channel}|${q.conversationId}|${q.senderId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Payload đọc lại từ Redis là untrusted (đổi schema giữa deploy) → sai kiểu trả null, bỏ qua. */
export function parsePendingQuestion(json: string): PendingQuestion | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const { channel, conversationId, senderId, senderName, msgId, text, ts } = raw;
  if (typeof channel !== "string" || channel === "") return null;
  if (typeof conversationId !== "string" || conversationId === "") return null;
  if (typeof senderId !== "string" || typeof msgId !== "string" || typeof text !== "string") {
    return null;
  }
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  const name = typeof senderName === "string" && senderName !== "" ? { senderName } : {};
  return { channel, conversationId, senderId, ...name, msgId, text, ts };
}

export class RedisProactivePending implements ProactivePendingStore {
  constructor(private readonly send: RedisCommand) {}

  async schedule(question: PendingQuestion, fireAtMs: number): Promise<void> {
    const member = memberKey(question);
    await this.send("HSET", [PENDING_KEY, member, JSON.stringify(question)]);
    await this.send("ZADD", [DUE_KEY, String(fireAtMs), member]);
  }

  async claimDue(nowMs: number): Promise<PendingQuestion[]> {
    const due = await this.send("ZRANGEBYSCORE", [
      DUE_KEY,
      "-inf",
      String(nowMs),
      "LIMIT",
      "0",
      String(CLAIM_BATCH),
    ]);
    if (!Array.isArray(due)) return [];

    const claimed: PendingQuestion[] = [];
    for (const member of due) {
      if (typeof member !== "string") continue;
      // ZREM = giành: instance khác đã gỡ (trả 0) thì câu này của họ.
      const removed = await this.send("ZREM", [DUE_KEY, member]);
      if (removed !== 1) continue;
      const json = await this.send("HGET", [PENDING_KEY, member]);
      await this.send("HDEL", [PENDING_KEY, member]);
      if (typeof json !== "string") continue;
      const question = parsePendingQuestion(json);
      if (question !== null) claimed.push(question);
    }
    return claimed;
  }
}
