// store.ts — đợt phát tin trên Postgres (`announcements` + `announcement_deliveries`).
// Query qua tagged template `sql` → auto-parameterize.
//
// HAI cơ chế chống gửi trùng, cả hai nằm trong DB chứ không trong process:
//   1. `create` dựa UNIQUE (announcement_id, channel, group_id) → lượt tool retry không nhân đôi row.
//   2. `claim` là compare-and-swap trên `next_attempt_at` → hai instance cùng tick chỉ một cái
//      thấy row trả về. Không có lock nào hết hạn giữa chừng để mà gửi đôi.

import { sql } from "../db/client.ts";
import { AnnouncementStatus as AnnouncementState, DeliveryStatus } from "../db/schema.ts";
import type {
  ApproveInput,
  ApproverRoom,
  ApproverRoomLookup,
  AnnouncementStatus,
  AnnouncementStore,
  AwaitingApproval,
  ClaimDeliveryInput,
  CreateAnnouncementInput,
  Delivery,
  FailDeliveryInput,
  FailedDelivery,
  RejectInput,
} from "./types.ts";

/**
 * Trần lượt gửi mỗi tick. Chặn một tick bị dồn (instance vừa lên sau khi down) chiếm egress quá
 * lâu — phần còn lại vẫn tới hạn nên tick sau lấy tiếp. Nhỏ hơn trần của việc-treo vì mỗi lượt ở
 * đây là một lần gọi bridge Zalo thật, không phải một lệnh Redis.
 */
const MAX_SEND_PER_TICK = 30;

export class SqlAnnouncementStore implements AnnouncementStore {
  /**
   * MỘT câu lệnh, không cần transaction: CTE ghi bản gốc rồi INSERT ... SELECT nhân ra N row từ
   * `unnest` ba mảng song song. Một statement là một transaction ngầm → không có cửa sổ nào tồn
   * tại bản gốc mà chưa có row nhận.
   *
   * Caller PHẢI chặn `rooms` rỗng trước: CTE ghi-dữ-liệu vẫn chạy dù outer query không ra row nào,
   * nên gọi với mảng rỗng sẽ đẻ một đợt phát mồ côi không ai nhận (xem service.ts).
   */
  async create(input: CreateAnnouncementInput): Promise<string> {
    const channels = input.rooms.map((room) => room.channel);
    const groupIds = input.rooms.map((room) => room.groupId);
    const customerIds = input.rooms.map((room) => room.customerId);

    // Mảng PHẢI bind qua `sql.array(x, "TEXT")`, KHÔNG phải `${x}::text[]`.
    // Bun.sql (1.3.11) serialize mảng JS trần thành chuỗi nối dấu phẩy `zalo,zalo` — Postgres
    // đọc ra "malformed array literal" vì thiếu `{}`. Còn `sql.array(x)::text[]` (có cast thừa)
    // thì bọc thêm nháy kép vào từng phần tử → channel lưu thành `"zalo"`, sai âm thầm.
    // `sql.array(x, "TEXT")` đã mang sẵn kiểu phần tử nên bỏ hẳn cast.

    // `next_attempt_at` để NGỎ (NULL) — row nhận sinh ra đã nằm ngoài due-index. Chỉ `approve`
    // đặt mốc. Không có tham số nào ở đây cho phép bỏ qua bước đó.
    const rows: unknown = await sql`
      WITH created AS (
        INSERT INTO announcements (kind, text, status, created_by, origin_channel, origin_conversation)
        VALUES (${input.kind}, ${input.text}, ${AnnouncementState.AwaitingApproval},
                ${input.createdBy}, ${input.origin.channel}, ${input.origin.conversationId})
        RETURNING id
      )
      INSERT INTO announcement_deliveries
        (announcement_id, channel, group_id, customer_id, status)
      SELECT created.id, target.channel, target.group_id, target.customer_id, ${DeliveryStatus.Pending}
      FROM created,
           unnest(${sql.array(channels, "TEXT")}, ${sql.array(groupIds, "TEXT")},
                  ${sql.array(customerIds, "TEXT")})
             AS target(channel, group_id, customer_id)
      ON CONFLICT (announcement_id, channel, group_id) DO NOTHING
      RETURNING announcement_id`;

    const id = firstString(rows, "announcement_id");
    // Ghi được bản gốc mà không đọc ra id thì mọi row nhận vừa tạo là mồ côi với caller: người
    // phát không soát được, poller vẫn cứ gửi. Ném lỗi để thấy ngay, đừng trả chuỗi rỗng.
    if (id === undefined) {
      throw new Error("[announcements] tạo đợt phát xong nhưng không đọc được announcement_id");
    }
    return id;
  }

  async find(announcementId: string): Promise<AwaitingApproval | undefined> {
    const rows: unknown = await sql`SELECT a.id, a.kind, a.text, a.created_by, a.created_at,
                                           count(d.id) AS room_count
                                    FROM announcements a
                                    LEFT JOIN announcement_deliveries d ON d.announcement_id = a.id
                                    WHERE a.id = ${announcementId}
                                    GROUP BY a.id`;
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    return toAwaiting(rows[0]);
  }

  /**
   * Gật + mở khoá trong MỘT câu lệnh. Tách hai lệnh thì có cửa sổ mà đợt đã Approved nhưng row
   * nhận vẫn NULL — poller không thấy gì và tin không bao giờ đi, im lặng.
   *
   * `WHERE status = AwaitingApproval` là hàng rào chống duyệt hai lần: instance khác vừa duyệt
   * xong thì UPDATE này không khớp row nào, caller thấy undefined và không báo kết quả lần hai.
   *
   * Nhóm bị `/block` GIỮA lúc chốt và lúc duyệt thì bỏ qua: chặn nhóm là quyết định vận hành,
   * duyệt tin không được đi vòng qua nó. Row đó ở lại Pending với `next_attempt_at` NULL.
   */
  async approve({ announcementId, approvedBy, firstAttemptAt }: ApproveInput): Promise<number | undefined> {
    const rows: unknown = await sql`
      WITH gated AS (
        UPDATE announcements
        SET status = ${AnnouncementState.Approved}, approved_by = ${approvedBy}, approved_at = now()
        WHERE id = ${announcementId} AND status = ${AnnouncementState.AwaitingApproval}
        RETURNING id
      )
      UPDATE announcement_deliveries d
      SET next_attempt_at = ${firstAttemptAt}
      FROM gated
      WHERE d.announcement_id = gated.id
        AND d.status = ${DeliveryStatus.Pending}
        AND NOT EXISTS (
          SELECT 1 FROM group_block gb
          WHERE gb.channel = d.channel AND gb.group_id = d.group_id
        )
      RETURNING d.id`;
    if (!Array.isArray(rows)) return undefined;
    // Mảng rỗng có HAI nghĩa và phải phân biệt: đợt không còn chờ duyệt (CTE không ra row) hay
    // đợt được duyệt nhưng mọi nhóm đều đang bị chặn. Hỏi lại trạng thái để không báo nhầm.
    if (rows.length === 0) {
      const state = await this.stateOf(announcementId);
      return state === AnnouncementState.Approved ? 0 : undefined;
    }
    return rows.length;
  }

  async reject({ announcementId, rejectedBy, reason }: RejectInput): Promise<boolean> {
    const rows: unknown = await sql`UPDATE announcements
                                    SET status = ${AnnouncementState.Rejected},
                                        approved_by = ${rejectedBy},
                                        approved_at = now(),
                                        reject_reason = ${reason}
                                    WHERE id = ${announcementId}
                                      AND status = ${AnnouncementState.AwaitingApproval}
                                    RETURNING id`;
    return Array.isArray(rows) && rows.length > 0;
  }

  async listAwaiting(limit: number): Promise<readonly AwaitingApproval[]> {
    const rows: unknown = await sql`SELECT a.id, a.kind, a.text, a.created_by, a.created_at,
                                           count(d.id) AS room_count
                                    FROM announcements a
                                    LEFT JOIN announcement_deliveries d ON d.announcement_id = a.id
                                    WHERE a.status = ${AnnouncementState.AwaitingApproval}
                                    GROUP BY a.id
                                    ORDER BY a.created_at ASC
                                    LIMIT ${limit}`;
    if (!Array.isArray(rows)) return [];
    const out: AwaitingApproval[] = [];
    for (const row of rows) {
      const item = toAwaiting(row);
      if (item !== undefined) out.push(item);
    }
    return out;
  }

  async originOf(announcementId: string): Promise<ApproverRoom | undefined> {
    const rows: unknown = await sql`SELECT origin_channel, origin_conversation
                                    FROM announcements WHERE id = ${announcementId}`;
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const record = asRecord(rows[0]);
    if (record === undefined) return undefined;
    const channel = readString(record, "origin_channel");
    const conversationId = readString(record, "origin_conversation");
    return channel === undefined || conversationId === undefined
      ? undefined
      : { channel, conversationId };
  }

  private async stateOf(announcementId: string): Promise<number | undefined> {
    const rows: unknown = await sql`SELECT status FROM announcements WHERE id = ${announcementId}`;
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const record = asRecord(rows[0]);
    return record === undefined ? undefined : readInteger(record, "status");
  }

  async dueForSend(now: Date): Promise<readonly Delivery[]> {
    // Join lấy luôn `text`: poller gửi NGUYÊN VĂN bản gốc, không dựng lại câu từ mảnh nào khác.
    const rows: unknown = await sql`SELECT d.id, d.announcement_id, d.channel, d.group_id,
                                           d.customer_id, d.attempts, d.next_attempt_at, a.text
                                    FROM announcement_deliveries d
                                    JOIN announcements a ON a.id = d.announcement_id
                                    WHERE a.status = ${AnnouncementState.Approved}
                                      AND d.status = ${DeliveryStatus.Pending}
                                      AND d.next_attempt_at IS NOT NULL
                                      AND d.next_attempt_at <= ${now}
                                    ORDER BY d.next_attempt_at ASC
                                    LIMIT ${MAX_SEND_PER_TICK}`;
    if (!Array.isArray(rows)) return [];
    const out: Delivery[] = [];
    for (const row of rows) {
      const delivery = toDelivery(row);
      if (delivery === undefined) continue;
      out.push(delivery);
    }
    return out;
  }

  /**
   * Giành lượt gửi + đẩy mốc thử kế trong CÙNG một UPDATE. Tách hai lệnh thì có cửa sổ mà lượt
   * đã giành vẫn còn `next_attempt_at` cũ → instance khác nhặt lại và gửi lần hai.
   */
  async claim({ id, expected, next }: ClaimDeliveryInput): Promise<boolean> {
    const rows: unknown = await sql`UPDATE announcement_deliveries
                                    SET next_attempt_at = ${next},
                                        attempts        = attempts + 1
                                    WHERE id = ${id}
                                      AND status = ${DeliveryStatus.Pending}
                                      AND next_attempt_at = ${expected}
                                    RETURNING id`;
    return Array.isArray(rows) && rows.length > 0;
  }

  async markSent(id: string, sentAt: Date): Promise<void> {
    // `next_attempt_at = NULL` để row rơi khỏi due-index — gửi xong là thôi, không chờ tick nào nữa.
    await sql`UPDATE announcement_deliveries
              SET status = ${DeliveryStatus.Sent}, sent_at = ${sentAt}, next_attempt_at = NULL,
                  last_error = NULL
              WHERE id = ${id} AND status = ${DeliveryStatus.Pending}`;
  }

  async markFailed({ id, reason, giveUp }: FailDeliveryInput): Promise<void> {
    // Còn lượt thử → giữ Pending và giữ nguyên `next_attempt_at` mà `claim` vừa đẩy: lý do hỏng
    // được ghi lại nhưng row vẫn nằm trong hàng đợi. Hết lượt → Failed + rơi khỏi due-index.
    if (giveUp) {
      await sql`UPDATE announcement_deliveries
                SET status = ${DeliveryStatus.Failed}, last_error = ${reason}, next_attempt_at = NULL
                WHERE id = ${id} AND status = ${DeliveryStatus.Pending}`;
      return;
    }
    await sql`UPDATE announcement_deliveries
              SET last_error = ${reason}
              WHERE id = ${id} AND status = ${DeliveryStatus.Pending}`;
  }

  async status(announcementId: string): Promise<AnnouncementStatus | undefined> {
    // Trạng thái ĐỢT đọc riêng: đợt bị từ chối có 0 row gửi, và người hỏi phải thấy "bị từ chối"
    // chứ không phải "0/45 nhóm nhận" — hai thứ đó dẫn tới hai hành động khác nhau.
    const headRows: unknown = await sql`SELECT status, reject_reason
                                        FROM announcements WHERE id = ${announcementId}`;
    if (!Array.isArray(headRows) || headRows.length === 0) return undefined;
    const head = asRecord(headRows[0]);
    const stateCode = head === undefined ? undefined : readInteger(head, "status");
    if (stateCode === undefined || !ANNOUNCEMENT_STATES.includes(stateCode)) return undefined;
    const state = stateCode as AnnouncementStatus["state"];
    const rejectReason = head === undefined ? undefined : readString(head, "reject_reason");

    const rows: unknown = await sql`SELECT status, group_id, customer_id, last_error
                                    FROM announcement_deliveries
                                    WHERE announcement_id = ${announcementId}`;
    if (!Array.isArray(rows)) return undefined;

    let sent = 0;
    let pending = 0;
    const failed: FailedDelivery[] = [];
    for (const row of rows) {
      const record = asRecord(row);
      if (record === undefined) continue;
      const status = readInteger(record, "status");
      if (status === DeliveryStatus.Sent) {
        sent += 1;
        continue;
      }
      if (status === DeliveryStatus.Pending) {
        pending += 1;
        continue;
      }
      failed.push({
        groupId: readString(record, "group_id") ?? "(không rõ)",
        customerId: readString(record, "customer_id") ?? "(không rõ)",
        reason: readString(record, "last_error") ?? "(không rõ lý do)",
      });
    }
    return { announcementId, state, total: rows.length, sent, pending, failed, rejectReason };
  }

  async latestBy(createdBy: string): Promise<string | undefined> {
    return firstString(
      await sql`SELECT id FROM announcements
                WHERE created_by = ${createdBy}
                ORDER BY created_at DESC
                LIMIT 1`,
      "id",
    );
  }
}

/**
 * Chiều ngược `user_binding`: `user_id` hệ vận hành → phòng nhắn được cho người đó, GIỚI HẠN
 * trong đúng một kênh (`channel`, thực tế là kênh vận hành).
 *
 * Khoá theo kênh chứ không lấy bind mới nhất trên kênh bất kỳ: người duyệt cũng bind ở kênh kho
 * hay kênh cá nhân, và "bind mới nhất" đổi mỗi lần họ đổi máy → yêu cầu duyệt sẽ bay sang phòng
 * khác tuỳ lịch sử bind. Đích của yêu cầu duyệt phải xác định trước, không phụ thuộc dữ liệu.
 *
 * Chat 1-1: adapter ingest đặt `conversationId` = uid người gửi, nên `sender_id` CHÍNH LÀ id
 * phòng DM. Cùng kênh vẫn có thể nhiều row (bind lại sau khi đổi máy) → lấy row mới nhất, một
 * thứ tự tường minh chứ không phụ thuộc thứ tự row trả về.
 */
export class SqlApproverRoomLookup implements ApproverRoomLookup {
  constructor(private readonly channel: string) {}

  async roomOf(userId: string): Promise<ApproverRoom | undefined> {
    const rows: unknown = await sql`SELECT channel, sender_id FROM user_binding
                                    WHERE user_id = ${userId}
                                      AND channel = ${this.channel}
                                      AND revoked_at IS NULL
                                    ORDER BY bound_at DESC
                                    LIMIT 1`;
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const record = asRecord(rows[0]);
    if (record === undefined) return undefined;
    const channel = readString(record, "channel");
    const senderId = readString(record, "sender_id");
    return channel === undefined || senderId === undefined
      ? undefined
      : { channel, conversationId: senderId };
  }
}

const ANNOUNCEMENT_STATES: readonly number[] = Object.values(AnnouncementState);

/** Row đợt chờ duyệt → AwaitingApproval. Thiếu cột bắt buộc → undefined. */
function toAwaiting(row: unknown): AwaitingApproval | undefined {
  const record = asRecord(row);
  if (record === undefined) return undefined;
  const announcementId = readString(record, "id");
  const kind = readString(record, "kind");
  const text = readString(record, "text");
  const createdBy = readString(record, "created_by");
  const createdAt = readDate(record, "created_at");
  if (
    announcementId === undefined ||
    kind === undefined ||
    text === undefined ||
    createdBy === undefined ||
    createdAt === undefined
  ) {
    return undefined;
  }
  return {
    announcementId,
    kind,
    text,
    createdBy,
    // count() của Postgres là bigint → driver trả chuỗi. readInteger nhận cả hai.
    roomCount: readInteger(record, "room_count") ?? 0,
    createdAt,
  };
}

/** Row từ DB là `unknown` → narrow từng cột. Thiếu cột bắt buộc = row hỏng, bỏ qua (log). */
function toDelivery(row: unknown): Delivery | undefined {
  const record = asRecord(row);
  if (record === undefined) return undefined;

  const id = readString(record, "id");
  const announcementId = readString(record, "announcement_id");
  const channel = readString(record, "channel");
  const groupId = readString(record, "group_id");
  const customerId = readString(record, "customer_id");
  const text = readString(record, "text");

  if (
    id === undefined ||
    announcementId === undefined ||
    channel === undefined ||
    groupId === undefined ||
    customerId === undefined ||
    text === undefined
  ) {
    console.error("[announcements] bỏ lượt gửi thiếu cột bắt buộc:", readString(record, "id") ?? "(no id)");
    return undefined;
  }

  return {
    id,
    announcementId,
    channel,
    groupId,
    customerId,
    text,
    attempts: readInteger(record, "attempts") ?? 0,
    nextAttemptAt: readDate(record, "next_attempt_at"),
  };
}

function firstString(rows: unknown, key: string): string | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const record = asRecord(rows[0]);
  return record === undefined ? undefined : readString(record, key);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === "number") return Number.isInteger(value) ? value : undefined;
  // Driver trả smallint/integer dạng chuỗi ở một số cấu hình.
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function readDate(record: Record<string, unknown>, key: string): Date | undefined {
  const value = record[key];
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}
