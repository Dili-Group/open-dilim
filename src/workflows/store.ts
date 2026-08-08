// store.ts — việc treo trên Postgres (bảng `pending_actions`, §6). Query qua tagged template
// `sql` → auto-parameterize.
//
// MỘT BẢNG CHO MỌI NGHIỆP VỤ: cột `workflow` phân loại, `state_snapshot` (jsonb) giữ phần riêng.
// Store KHÔNG đọc `state_snapshot.state` — nó chỉ chuyển tiếp cho WorkflowDef.
//
// HAI cơ chế chống trùng, cả hai nằm trong DB chứ không trong process:
//   1. `open` dựa UNIQUE partial index (workflow, subject) WHERE status = Pending → hỏi lại đúng
//      khoá đang chờ thì rơi vào ON CONFLICT, không sinh việc thứ hai.
//   2. `claimRemind` là compare-and-swap trên `next_remind_at` → hai instance cùng tick chỉ một
//      cái thấy rowCount = 1. Không có lock nào hết hạn giữa chừng để mà nhắc đôi.

import { sql } from "../db/client.ts";
import { PendingStatus } from "../db/schema.ts";
import type {
  ClaimRemindInput,
  OpenPendingInput,
  PendingRequest,
  PendingStore,
  ResolvePendingInput,
  RoomRef,
} from "./types.ts";

/**
 * Trần việc xử lý mỗi tick nhắc. Chặn một tick bị dồn (instance vừa lên sau khi down cả ngày)
 * chiếm broker quá lâu — phần còn lại vẫn tới hạn nên tick sau lấy tiếp.
 */
const MAX_REMIND_PER_TICK = 100;

/**
 * jsonb LUÔN bind qua `::text::jsonb`, KHÔNG phải `::jsonb` trần.
 *
 * `${chuỗi}::jsonb` để Postgres suy ra kiểu tham số là jsonb → Bun tự JSON-encode chuỗi ĐÃ là
 * JSON thêm một lần nữa: cột nhận về một jsonb *string scalar* `"{\"origin\":...}"`, không phải
 * object. Hậu quả im lặng: `state_snapshot -> 'origin'` ra NULL (openForOrigin không thấy gì) và
 * `state_snapshot || patch` nối hai scalar thành MẢNG hai chuỗi → row không parse được nữa.
 * Ép qua `text` trước buộc tham số đi dạng text, `::jsonb` mới thực sự PARSE nó thành object.
 */

/**
 * `approver` cho việc hỏi-cả-nhóm: ai ở trong nhóm đích cũng trả lời được, nên lưu chính nhóm
 * đó thay vì một senderId. Có tiền tố `room:` để không lẫn với approver là MỘT NGƯỜI (§6 tầng B).
 */
function roomApprover(room: RoomRef): string {
  return `room:${room.channel}:${room.groupId}`;
}

export class SqlPendingStore implements PendingStore {
  async open(input: OpenPendingInput): Promise<PendingRequest | null> {
    const id = crypto.randomUUID();
    const snapshot = JSON.stringify({
      origin: input.origin,
      state: input.state,
    });
    // ON CONFLICT phải nhắc lại vị từ của partial index, nếu không Postgres không suy ra index nào.
    // `subject IS NOT NULL` nằm trong vị từ → việc KHÔNG có khoá thì không bao giờ đụng conflict.
    const rows: unknown = await sql`
      INSERT INTO pending_actions (approval_id, conversation_id, channel, workflow, subject,
                                   state_snapshot, idempotency_key, status, approver, requester_id,
                                   ask_count, next_remind_at, expires_at)
      VALUES (${id}, ${input.target.groupId}, ${input.target.channel}, ${input.workflow},
              ${input.subject ?? null}, ${snapshot}::text::jsonb, ${`${input.workflow}:${input.subject}`},
              ${PendingStatus.Pending}, ${roomApprover(input.target)}, ${input.requesterId},
              1, ${input.nextRemindAt ?? null}, ${input.expiresAt})
      ON CONFLICT (workflow, subject)
        WHERE status = ${PendingStatus.Pending} AND subject IS NOT NULL
        DO NOTHING
      RETURNING approval_id, conversation_id, channel, workflow, subject, state_snapshot,
                status, requester_id, ask_count, next_remind_at, expires_at`;
    return first(rows) ?? null;
  }

  async findOpen(workflow: string, subject: string): Promise<PendingRequest | undefined> {
    const rows: unknown = await sql`SELECT approval_id, conversation_id, channel, workflow, subject,
                                           state_snapshot, status, requester_id, ask_count,
                                           next_remind_at, expires_at
                                    FROM pending_actions
                                    WHERE workflow = ${workflow} AND subject = ${subject}
                                      AND status = ${PendingStatus.Pending}
                                    LIMIT 1`;
    return first(rows);
  }

  async findAnswered(workflow: string, subject: string): Promise<PendingRequest | undefined> {
    // Khoá có thể được hỏi lại sau nhiều tháng → lấy lần đóng MỚI NHẤT, không lấy bừa row đầu.
    const rows: unknown = await sql`SELECT approval_id, conversation_id, channel, workflow, subject,
                                           state_snapshot, status, requester_id, ask_count,
                                           next_remind_at, expires_at
                                    FROM pending_actions
                                    WHERE workflow = ${workflow} AND subject = ${subject}
                                      AND status = ${PendingStatus.Approved}
                                    ORDER BY resolved_at DESC NULLS LAST
                                    LIMIT 1`;
    return first(rows);
  }

  async openForTarget(room: RoomRef): Promise<PendingRequest[]> {
    const rows: unknown = await sql`SELECT approval_id, conversation_id, channel, workflow, subject,
                                           state_snapshot, status, requester_id, ask_count,
                                           next_remind_at, expires_at
                                    FROM pending_actions
                                    WHERE channel = ${room.channel}
                                      AND conversation_id = ${room.groupId}
                                      AND status = ${PendingStatus.Pending}
                                    ORDER BY created_at ASC`;
    return toList(rows);
  }

  async openForOrigin(room: RoomRef): Promise<PendingRequest[]> {
    // Nhóm đã hỏi nằm trong jsonb (không phải khoá truy vấn nóng) → lọc bằng toán tử jsonb.
    // Bảng việc-đang-treo luôn nhỏ (đóng liên tục), nên không dựng index riêng cho chiều này.
    const rows: unknown = await sql`SELECT approval_id, conversation_id, channel, workflow, subject,
                                           state_snapshot, status, requester_id, ask_count,
                                           next_remind_at, expires_at
                                    FROM pending_actions
                                    WHERE status = ${PendingStatus.Pending}
                                      AND state_snapshot -> 'origin' ->> 'channel' = ${room.channel}
                                      AND state_snapshot -> 'origin' ->> 'groupId' = ${room.groupId}
                                    ORDER BY created_at ASC`;
    return toList(rows);
  }

  async dueForRemind(now: Date): Promise<PendingRequest[]> {
    const rows: unknown = await sql`SELECT approval_id, conversation_id, channel, workflow, subject,
                                           state_snapshot, status, requester_id, ask_count,
                                           next_remind_at, expires_at
                                    FROM pending_actions
                                    WHERE status = ${PendingStatus.Pending}
                                      AND next_remind_at IS NOT NULL
                                      AND next_remind_at <= ${now}
                                    ORDER BY next_remind_at ASC
                                    LIMIT ${MAX_REMIND_PER_TICK}`;
    return toList(rows);
  }

  async claimRemind({ id, expected, next }: ClaimRemindInput): Promise<boolean> {
    const rows: unknown = await sql`UPDATE pending_actions
                                    SET next_remind_at = ${next},
                                        ask_count      = ask_count + 1
                                    WHERE approval_id = ${id}
                                      AND status = ${PendingStatus.Pending}
                                      AND next_remind_at = ${expected}
                                    RETURNING approval_id`;
    return Array.isArray(rows) && rows.length > 0;
  }

  async resolve({ id, answer, resolvedBy }: ResolvePendingInput): Promise<PendingRequest | undefined> {
    const patch = JSON.stringify({ answer, answeredBy: resolvedBy });
    // `status = Pending` trong WHERE là hàng rào chống báo kết quả HAI LẦN: instance khác vừa đóng
    // xong thì UPDATE này không khớp row nào, caller thấy undefined và không broadcast lại.
    const rows: unknown = await sql`UPDATE pending_actions
                                    SET status         = ${PendingStatus.Approved},
                                        state_snapshot = state_snapshot || ${patch}::text::jsonb,
                                        resolved_at    = now(),
                                        next_remind_at = NULL
                                    WHERE approval_id = ${id} AND status = ${PendingStatus.Pending}
                                    RETURNING approval_id, conversation_id, channel, workflow, subject,
                                              state_snapshot, status, requester_id, ask_count,
                                              next_remind_at, expires_at`;
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const resolved = first(rows);
    // Đã UPDATE được row mà parse hỏng: việc ĐÃ đóng trong DB nhưng caller lại đọc ra "closed" và
    // im lặng không báo kết quả về nhóm đã hỏi — đáp án mất hẳn. Ném lỗi để thấy, đừng nuốt.
    if (resolved === undefined) {
      throw new Error(`[workflows] đóng được việc ${id} nhưng row trả về không parse được`);
    }
    return resolved;
  }

  async expireDue(now: Date): Promise<number> {
    const rows: unknown = await sql`UPDATE pending_actions
                                    SET status         = ${PendingStatus.Expired},
                                        resolved_at    = now(),
                                        next_remind_at = NULL
                                    WHERE status = ${PendingStatus.Pending} AND expires_at <= ${now}
                                    RETURNING approval_id`;
    return Array.isArray(rows) ? rows.length : 0;
  }
}

function toList(rows: unknown): PendingRequest[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(toRequest).filter((item): item is PendingRequest => item !== undefined);
}

function first(rows: unknown): PendingRequest | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  return toRequest(rows[0]);
}

/** Row từ DB là `unknown` → narrow từng cột. Thiếu cột bắt buộc = row hỏng, bỏ qua (log). */
function toRequest(row: unknown): PendingRequest | undefined {
  const record = asRecord(row);
  if (record === undefined) return undefined;

  const id = readString(record, "approval_id");
  const workflow = readString(record, "workflow");
  const targetGroupId = readString(record, "conversation_id");
  const targetChannel = readString(record, "channel");
  const requesterId = readString(record, "requester_id");
  const expiresAt = readDate(record, "expires_at");
  const status = readStatus(record);
  const snapshot = readSnapshot(record);
  const origin = readRoom(snapshot, "origin");

  if (
    id === undefined ||
    workflow === undefined ||
    targetGroupId === undefined ||
    targetChannel === undefined ||
    requesterId === undefined ||
    expiresAt === undefined ||
    status === undefined ||
    origin === undefined
  ) {
    console.error("[workflows] bỏ việc treo thiếu cột bắt buộc:", readString(record, "approval_id") ?? "(no id)");
    return undefined;
  }

  const state = asRecord(snapshot["state"]) ?? {};
  return {
    id,
    workflow,
    subject: readString(record, "subject"),
    target: { channel: targetChannel, groupId: targetGroupId },
    origin,
    requesterId,
    state,
    askCount: readInteger(record, "ask_count") ?? 0,
    nextRemindAt: readDate(record, "next_remind_at"),
    expiresAt,
    status,
    answer: readString(snapshot, "answer"),
  };
}

/** jsonb: driver có cấu hình trả object đã parse, có cấu hình trả chuỗi → nhận cả hai. */
function readSnapshot(record: Record<string, unknown>): Record<string, unknown> {
  const value = record["state_snapshot"];
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value)) ?? {};
    } catch {
      return {};
    }
  }
  return asRecord(value) ?? {};
}

function readRoom(snapshot: Record<string, unknown>, key: string): RoomRef | undefined {
  const room = asRecord(snapshot[key]);
  if (room === undefined) return undefined;
  const channel = readString(room, "channel");
  const groupId = readString(room, "groupId");
  return channel === undefined || groupId === undefined ? undefined : { channel, groupId };
}

/** Status ngoài tập cho phép = row hỏng (ai đó sửa tay DB) → undefined, không đoán trạng thái. */
function readStatus(record: Record<string, unknown>): PendingStatus | undefined {
  const value = readInteger(record, "status");
  if (value === undefined) return undefined;
  const known: readonly number[] = Object.values(PendingStatus);
  return known.includes(value) ? (value as PendingStatus) : undefined;
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
