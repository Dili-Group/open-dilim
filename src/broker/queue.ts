// queue.ts — ingress queue trên Redis Streams + consumer group (design §3 broker).
// publish = XADD; consume = XREADGROUP; ack = XACK; retry/DLQ đi qua PEL (pending entries list).
//
// TẠI SAO PEL thay vì ack-ngay: worker chạy vài phút/message. Process chết giữa chừng thì message
// vẫn nằm PEL (chưa ack) → reclaim lại được, không mất tin. Quá `MAX_DELIVERIES` lần giao mà vẫn
// hỏng = poison message → đẩy DLQ stream, không quay vòng vô hạn.
//
// MỘT vòng đọc cho CẢ pool: N worker gọi take() → xếp waiter; pump đọc XREADGROUP với
// COUNT = số waiter rồi phát tay. Chỉ 1 lệnh BLOCK ngoài luồng tại một thời điểm → 1 connection
// blocking là đủ, và không claim nhiều hơn số worker rảnh (message thừa nằm PEL không ai chạy).

import type { Envelope } from "../types/index.ts";
import type { RedisCommand } from "../redis/types.ts";
import type { Broker } from "../message-ingest/index.ts";
import type { BrokerConsumer, Delivery } from "../worker/index.ts";
import { parseEntries, parseEnvelope, parsePending, parseReadReply, type StreamEntry } from "./resp.ts";

/** Stream ingress + DLQ + tên consumer group. Đổi = mất PEL đang chờ → coi như hằng hệ thống. */
export const INGRESS_STREAM = "dilim:ingress";
export const INGRESS_DLQ = "dilim:ingress:dlq";
export const INGRESS_GROUP = "dilim-workers";
/** Field chứa Envelope JSON trong entry. */
const DATA_FIELD = "data";

/** Trần entry giữ trong stream (trim xấp xỉ ~ để Redis khỏi quét chính xác). */
const STREAM_MAXLEN = 100_000;
/** Trần thời gian 1 lệnh XREADGROUP chờ. Cũng là trễ tối đa lúc shutdown (không huỷ được lệnh). */
const BLOCK_MS = 2_000;
/** Nghỉ giữa 2 lần quét PEL — quét mỗi vòng lặp là tốn RTT vô ích. */
const RECLAIM_INTERVAL_MS = 30_000;
/** Message pending lâu hơn ngần này = worker chết hoặc lượt xử lý hỏng → lấy lại chạy. */
const RECLAIM_MIN_IDLE_MS = 300_000;
/** Trần số entry lấy lại 1 lượt quét. */
const RECLAIM_BATCH = 32;
/** Giao quá số lần này vẫn chưa ack = poison → DLQ. */
const MAX_DELIVERIES = 3;
/** Redis chết → nghỉ trước khi thử lại, tránh vòng lặp nóng. */
const ERROR_BACKOFF_MS = 1_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Broker Redis Streams. Một instance phục vụ CẢ HAI đầu: `publish` (ingest) và `take` (worker).
 * `send` = connection chung; `blockingSend` = connection RIÊNG cho XREADGROUP BLOCK.
 */
export class RedisStreamBroker implements Broker, BrokerConsumer {
  private readonly waiters: Array<(delivery: Delivery | null) => void> = [];
  /** Đệm khi entry về mà waiter đã abort (shutdown) — giữ để không mất, chưa ack nên vẫn ở PEL. */
  private readonly buffer: Delivery[] = [];
  private pumping = false;
  private lastReclaimAt = 0;

  constructor(
    private readonly send: RedisCommand,
    private readonly blockingSend: RedisCommand,
    private readonly consumerName: string,
  ) {}

  /** Tạo consumer group nếu chưa có. `0` = đọc từ đầu stream, không bỏ backlog chưa ai đọc. */
  async ensureGroup(): Promise<void> {
    try {
      await this.send("XGROUP", ["CREATE", INGRESS_STREAM, INGRESS_GROUP, "0", "MKSTREAM"]);
    } catch (err) {
      // BUSYGROUP = đã tồn tại (lần khởi động sau) → bình thường. Lỗi khác phải nổ ra ngoài.
      if (!(err instanceof Error) || !err.message.includes("BUSYGROUP")) throw err;
    }
  }

  async publish(envelope: Envelope): Promise<void> {
    await this.send("XADD", [
      INGRESS_STREAM,
      "MAXLEN",
      "~",
      String(STREAM_MAXLEN),
      "*",
      DATA_FIELD,
      JSON.stringify(envelope),
    ]);
  }

  /** Lấy 1 message; chờ tới khi có hoặc signal abort (trả null để worker thoát vòng). */
  take(signal?: AbortSignal): Promise<Delivery | null> {
    if (signal?.aborted === true) return Promise.resolve(null);
    const buffered = this.buffer.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);

    const pending = new Promise<Delivery | null>((resolve) => {
      const settle = (delivery: Delivery | null): void => {
        signal?.removeEventListener("abort", onAbort);
        resolve(delivery);
      };
      const onAbort = (): void => {
        const index = this.waiters.indexOf(settle);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(null);
      };
      this.waiters.push(settle);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    void this.pump();
    return pending;
  }

  /**
   * Vòng đọc duy nhất: chạy khi còn waiter, dừng khi hết. Lỗi Redis KHÔNG làm waiter nhận null
   * (worker sẽ tưởng shutdown mà thoát) — log, nghỉ, thử lại.
   */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiters.length > 0) {
        try {
          const want = this.waiters.length;
          const reclaimed = await this.reclaimStale(want);
          const batch = reclaimed.length > 0 ? reclaimed : await this.readNew(want);
          for (const entry of batch) await this.deliver(entry);
        } catch (err) {
          console.error("[broker] đọc ingress lỗi, thử lại:", err);
          await delay(ERROR_BACKOFF_MS);
        }
      }
    } finally {
      // Không có await giữa lúc điều kiện while thành false và dòng này → không có take() nào
      // chen vào mà mất pump. (JS single-thread: take() đẩy waiter rồi gọi pump() đồng bộ.)
      this.pumping = false;
    }
  }

  private async readNew(count: number): Promise<StreamEntry[]> {
    const raw = await this.blockingSend("XREADGROUP", [
      "GROUP",
      INGRESS_GROUP,
      this.consumerName,
      "COUNT",
      String(count),
      "BLOCK",
      String(BLOCK_MS),
      "STREAMS",
      INGRESS_STREAM,
      ">",
    ]);
    return parseReadReply(raw, DATA_FIELD);
  }

  /** Payload hỏng thì không worker nào chữa được → DLQ ngay, đừng giao cho agent. */
  private async deliver(entry: StreamEntry): Promise<void> {
    const envelope = parseEnvelope(entry.data);
    if (envelope === null) {
      console.error(`[broker] entry ${entry.id} payload không hợp lệ → DLQ`);
      await this.deadLetter(entry.id, entry.data);
      return;
    }
    const delivery = this.makeDelivery(entry.id, envelope);
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter(delivery);
    else this.buffer.push(delivery);
  }

  private makeDelivery(id: string, envelope: Envelope): Delivery {
    return {
      envelope,
      ack: async () => {
        await this.send("XACK", [INGRESS_STREAM, INGRESS_GROUP, id]);
        await this.send("XDEL", [INGRESS_STREAM, id]);
      },
      // Không ack: entry ở lại PEL → reclaimStale() lấy lại sau RECLAIM_MIN_IDLE_MS.
      retryLater: () => Promise.resolve(),
    };
  }

  /**
   * Lấy lại message pending quá lâu (worker chết, hoặc lượt trước trả failed nên không ack).
   * Quá MAX_DELIVERIES lần giao → DLQ. Throttle theo RECLAIM_INTERVAL_MS.
   */
  private async reclaimStale(limit: number): Promise<StreamEntry[]> {
    const now = Date.now();
    if (now - this.lastReclaimAt < RECLAIM_INTERVAL_MS) return [];
    this.lastReclaimAt = now;

    const pending = parsePending(
      await this.send("XPENDING", [
        INGRESS_STREAM,
        INGRESS_GROUP,
        "IDLE",
        String(RECLAIM_MIN_IDLE_MS),
        "-",
        "+",
        String(Math.min(limit, RECLAIM_BATCH)),
      ]),
    );
    if (pending.length === 0) return [];

    const retryIds: string[] = [];
    for (const entry of pending) {
      if (entry.deliveries >= MAX_DELIVERIES) {
        console.error(`[broker] entry ${entry.id} giao ${entry.deliveries} lần vẫn hỏng → DLQ`);
        await this.deadLetterById(entry.id);
      } else {
        retryIds.push(entry.id);
      }
    }
    if (retryIds.length === 0) return [];

    // XCLAIM đổi chủ sang consumer này (tăng delivery count) và trả kèm payload.
    const claimed = await this.send("XCLAIM", [
      INGRESS_STREAM,
      INGRESS_GROUP,
      this.consumerName,
      String(RECLAIM_MIN_IDLE_MS),
      ...retryIds,
    ]);
    return parseEntries(claimed, DATA_FIELD);
  }

  private async deadLetterById(id: string): Promise<void> {
    const found = parseEntries(await this.send("XRANGE", [INGRESS_STREAM, id, id]), DATA_FIELD);
    await this.deadLetter(id, found[0]?.data ?? "");
  }

  /** Chuyển sang DLQ rồi mới ack+xoá: mất điện giữa chừng thì entry vẫn còn ở PEL, không bốc hơi. */
  private async deadLetter(id: string, data: string): Promise<void> {
    await this.send("XADD", [INGRESS_DLQ, "*", DATA_FIELD, data, "srcId", id]);
    await this.send("XACK", [INGRESS_STREAM, INGRESS_GROUP, id]);
    await this.send("XDEL", [INGRESS_STREAM, id]);
  }
}
