// repo.ts — job def trên Postgres. Query qua tagged template `sql` → auto-parameterize.
//
// FIRE-ONCE nằm ở đây, không ở lock ngoài: `claim` là compare-and-swap trên `next_run_at`
// (UPDATE ... WHERE next_run_at = giá trị vừa đọc). Hai instance cùng tick → chỉ một cái thấy
// rowCount = 1, cái kia thấy 0 và bỏ lượt. Không có lock nào hết hạn giữa chừng để mà bắn đôi.

import { sql } from "../db/client.ts";
import type { ClaimInput, JobAdmin, JobRepo, JobSummary, SchedulerJob } from "./types.ts";

/**
 * Trần job xử lý mỗi tick. Chặn một tick bị dồn (instance vừa lên sau khi down cả ngày) chiếm
 * worker pool quá lâu — phần còn lại chờ tick sau, vẫn tới hạn nên không mất.
 */
const MAX_JOBS_PER_TICK = 100;
/** Độ dài mã ngắn hiện cho người dùng gõ lại (`/lich xoa <mã>`). */
export const SHORT_ID_LENGTH = 8;

export class SqlJobRepo implements JobRepo, JobAdmin {
  async due(now: Date): Promise<SchedulerJob[]> {
    // next_run_at NULL = job vừa thêm vào DB, chưa ai tính lịch → lấy về để lên lịch (không bắn).
    const rows: unknown = await sql`SELECT id, schedule, channel, identity, task, target, next_run_at
                                    FROM scheduler_jobs
                                    WHERE enabled
                                      AND (next_run_at IS NULL OR next_run_at <= ${now})
                                    ORDER BY next_run_at ASC NULLS FIRST
                                    LIMIT ${MAX_JOBS_PER_TICK}`;
    if (!Array.isArray(rows)) return [];
    return rows.map(toJob).filter(isPresent);
  }

  async claim({ id, expected, next, ran }: ClaimInput): Promise<boolean> {
    // IS NOT DISTINCT FROM: so sánh đúng cả khi expected = NULL (job mới) — `= NULL` luôn sai.
    const rows: unknown = await sql`UPDATE scheduler_jobs
                                    SET next_run_at = ${next},
                                        last_run_at = COALESCE(${ran ?? null}, last_run_at),
                                        updated_at  = now()
                                    WHERE id = ${id}
                                      AND next_run_at IS NOT DISTINCT FROM ${expected ?? null}
                                    RETURNING id`;
    return Array.isArray(rows) && rows.length > 0;
  }

  async create(job: {
    id: string;
    schedule: string;
    channel: string;
    identity: string;
    task: string;
    target: string;
  }): Promise<void> {
    // next_run_at để NULL: mốc chạy đầu tiên do poller tính (một nguồn sự thật cho cron expr).
    await sql`INSERT INTO scheduler_jobs (id, schedule, channel, identity, task, target)
              VALUES (${job.id}, ${job.schedule}, ${job.channel}, ${job.identity},
                      ${job.task}, ${job.target})`;
  }

  async listByTarget(p: { channel: string; target: string }): Promise<JobSummary[]> {
    const rows: unknown = await sql`SELECT id, schedule, task, enabled, next_run_at
                                    FROM scheduler_jobs
                                    WHERE channel = ${p.channel} AND target = ${p.target}
                                    ORDER BY created_at ASC`;
    if (!Array.isArray(rows)) return [];
    return rows.map(toSummary).filter(isPresent);
  }

  async update(p: {
    channel: string;
    target: string;
    shortId: string;
    schedule?: string;
    task?: string;
  }): Promise<boolean> {
    const schedule = p.schedule ?? null;
    // Đổi giờ → next_run_at về NULL: mốc cũ thuộc lịch đã bị xoá, poller phải tính lại từ đầu.
    const rows: unknown = await sql`UPDATE scheduler_jobs
                                    SET schedule    = COALESCE(${schedule}, schedule),
                                        task        = COALESCE(${p.task ?? null}, task),
                                        next_run_at = CASE WHEN ${schedule}::text IS NULL
                                                           THEN next_run_at ELSE NULL END,
                                        updated_at  = now()
                                    WHERE channel = ${p.channel} AND target = ${p.target}
                                      AND left(id, ${SHORT_ID_LENGTH}) = ${p.shortId}
                                    RETURNING id`;
    return Array.isArray(rows) && rows.length > 0;
  }

  async setEnabled(p: {
    channel: string;
    target: string;
    shortId: string;
    enabled: boolean;
  }): Promise<boolean> {
    // Bật lại cũng reset lịch: job tắt cả tuần thì mốc cũ đã quá khứ → bật lên là bắn bù ngay.
    const rows: unknown = await sql`UPDATE scheduler_jobs
                                    SET enabled     = ${p.enabled},
                                        next_run_at = NULL,
                                        updated_at  = now()
                                    WHERE channel = ${p.channel} AND target = ${p.target}
                                      AND left(id, ${SHORT_ID_LENGTH}) = ${p.shortId}
                                      AND enabled IS DISTINCT FROM ${p.enabled}
                                    RETURNING id`;
    return Array.isArray(rows) && rows.length > 0;
  }

  async remove(p: { channel: string; target: string; shortId: string }): Promise<boolean> {
    const rows: unknown = await sql`DELETE FROM scheduler_jobs
                                    WHERE channel = ${p.channel} AND target = ${p.target}
                                      AND left(id, ${SHORT_ID_LENGTH}) = ${p.shortId}
                                    RETURNING id`;
    return Array.isArray(rows) && rows.length > 0;
  }
}

function toSummary(row: unknown): JobSummary | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const record = row as Record<string, unknown>;
  const id = readString(record, "id");
  const schedule = readString(record, "schedule");
  const task = readString(record, "task");
  if (id === undefined || schedule === undefined || task === undefined) return undefined;
  return {
    id,
    schedule,
    task,
    enabled: record["enabled"] !== false,
    nextRunAt: readDate(record, "next_run_at"),
  };
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** Row từ DB là shape `unknown` → narrow từng cột. Thiếu/sai kiểu = job hỏng, bỏ qua (log). */
function toJob(row: unknown): SchedulerJob | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const record = row as Record<string, unknown>;

  const id = readString(record, "id");
  const schedule = readString(record, "schedule");
  const channel = readString(record, "channel");
  const identity = readString(record, "identity");
  const task = readString(record, "task");
  const target = readString(record, "target");
  if (
    id === undefined ||
    schedule === undefined ||
    channel === undefined ||
    identity === undefined ||
    task === undefined ||
    target === undefined
  ) {
    console.error("[scheduler] bỏ job thiếu cột bắt buộc:", readString(record, "id") ?? "(no id)");
    return undefined;
  }

  return { id, schedule, channel, identity, task, target, nextRunAt: readDate(record, "next_run_at") };
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readDate(record: Record<string, unknown>, key: string): Date | undefined {
  const value = record[key];
  if (value instanceof Date) return value;
  // Driver trả timestamptz dạng chuỗi ở một số cấu hình → parse, chuỗi lạ thì coi như chưa lên lịch.
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}
