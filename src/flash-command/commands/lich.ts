// /lich — nhân viên quản việc chạy theo giờ cho CHÍNH nhóm đang gõ (scheduler §8). CRUD đủ:
//
//   /lich                              → xem việc của nhóm này            (read)
//   /lich 17:00 gửi báo cáo cuối ngày  → thêm việc, chạy mỗi ngày         (create)
//   /lich sua a1b2c3d4 18:00           → đổi giờ                          (update)
//   /lich sua a1b2c3d4 gửi báo cáo kèm đơn hoàn  → đổi mô tả việc         (update)
//   /lich tat a1b2c3d4 · /lich bat a1b2c3d4      → dừng tạm / chạy lại    (update)
//   /lich xoa a1b2c3d4                 → xoá hẳn, không khôi phục         (delete)
//
// Mô tả việc = TEXT TỰ NHIÊN, đi thẳng vào history phòng lúc tới giờ rồi agent đọc như một yêu
// cầu của người dùng. Vì vậy viết như đang nhờ agent ("gửi báo cáo cuối ngày"), không phải tên
// kỹ thuật ("job_report_v2").
//
// Phạm vi CỨNG: job luôn gắn với (channel, nhóm đang gõ), và mã ngắn chỉ có nghĩa trong nhóm đó.
// Không có cách nào đặt/sửa/xoá việc của nhóm khác.

import { nextRunAfter } from "../../scheduler/schedule.ts";
import { foldVietnamese } from "../normalize.ts";
import {
  ActorRole,
  fail,
  ok,
  type FlashCommand,
  type FlashContext,
  type FlashResult,
  type JobSummary,
} from "../types.ts";

/** senderId mà mọi job chạy dưới danh nghĩa. Vai vẫn do AUTH resolve → guest, không quyền sẵn. */
const CRON_IDENTITY = "system:cron";
/** Mã ngắn hiện cho người dùng = 8 ký tự đầu của id (khớp SHORT_ID_LENGTH ở scheduler/repo.ts). */
const SHORT_ID_LENGTH = 8;
/** Trần việc mỗi nhóm — chặn gõ nhầm thành hàng chục tin tự động dội vào phòng. */
const MAX_JOBS_PER_GROUP = 10;
/** Trần độ dài mô tả. Dài hơn thì đó là cả quy trình, thuộc về skill chứ không phải job. */
const MAX_TASK_CHARS = 300;

/** Khoá đã bỏ dấu (foldVietnamese) → `xóa`/`xoa`, `tắt`/`tat` đều trúng, không liệt kê hai lần. */
const SUBCOMMANDS: Readonly<Record<string, "delete" | "off" | "on" | "edit">> =
  {
    xoa: "delete",
    tat: "off",
    bat: "on",
    sua: "edit",
  };

const TIME_ZONE = "Asia/Ho_Chi_Minh";
const runAtFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const USAGE =
  "Cách dùng: /lich (xem) · /lich 17:00 <việc> (thêm) · /lich sua <mã> <giờ hoặc việc mới> · " +
  "/lich tat|bat <mã> · /lich xoa <mã>";

const lich: FlashCommand = {
  name: "lich",
  description:
    "Quản việc chạy theo giờ của nhóm: /lich · /lich 17:00 <việc> · /lich sua|tat|bat|xoa <mã>",
  allowedRoles: [ActorRole.NhanVien, ActorRole.DaiLy],

  async handler(ctx) {
    if (ctx.groupId === undefined) return fail("Lệnh này chỉ dùng trong nhóm.");

    const [first, ...rest] = ctx.args;
    if (first === undefined) return listJobs(ctx, ctx.groupId);

    const sub = SUBCOMMANDS[foldVietnamese(first)];
    if (sub === undefined) return createJob(ctx, ctx.groupId, first, rest);

    const shortId = rest[0];
    if (shortId === undefined)
      return fail(`Thiếu mã việc. Gõ /lich để xem mã.\n${USAGE}`);

    switch (sub) {
      case "delete":
        return removeJob(ctx, ctx.groupId, shortId);
      case "off":
        return toggleJob(ctx, ctx.groupId, shortId, false);
      case "on":
        return toggleJob(ctx, ctx.groupId, shortId, true);
      case "edit":
        return editJob(ctx, ctx.groupId, shortId, rest.slice(1));
    }
  },
};

export default lich;

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

async function createJob(
  ctx: FlashContext,
  groupId: string,
  timeText: string,
  taskWords: readonly string[],
): Promise<FlashResult> {
  const time = parseDailyTime(timeText);
  if (time === undefined) {
    return fail(`Không hiểu "${timeText}" là giờ hay lệnh gì.\n${USAGE}`);
  }

  const task = readTask(taskWords);
  if (typeof task !== "string") return task;

  const existing = await ctx.jobs.listByTarget({
    channel: ctx.channel,
    target: groupId,
  });
  if (existing.filter((job) => job.enabled).length >= MAX_JOBS_PER_GROUP) {
    return fail(
      `Nhóm này đã có ${MAX_JOBS_PER_GROUP} việc đang bật. Tắt bớt (/lich tat <mã>) trước.`,
    );
  }

  const schedule = dailyCron(time);
  const id = crypto.randomUUID();
  await ctx.jobs.create({
    id,
    schedule,
    channel: ctx.channel,
    identity: CRON_IDENTITY,
    task,
    target: groupId,
  });

  const shortId = id.slice(0, SHORT_ID_LENGTH);
  return ok(
    `Đã đặt việc [${shortId}] — ${clockOf(time)} mỗi ngày:\n"${task}"\n` +
      `Chạy lần đầu: ${runAtFormat.format(firstRunOf(schedule))}. Sửa: /lich sua ${shortId} <giờ hoặc việc mới>.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────

async function listJobs(
  ctx: FlashContext,
  groupId: string,
): Promise<FlashResult> {
  const jobs = await ctx.jobs.listByTarget({
    channel: ctx.channel,
    target: groupId,
  });
  if (jobs.length === 0) {
    return ok(`Nhóm này chưa có việc theo giờ nào.\n${USAGE}`);
  }
  return ok(["Việc theo giờ của nhóm:", ...jobs.map(renderJob)].join("\n"));
}

function renderJob(job: JobSummary): string {
  const when = readDailyClock(job.schedule) ?? job.schedule; // cron đặt tay bằng SQL → in nguyên expr.
  const state = !job.enabled
    ? "đang tắt"
    : job.nextRunAt === undefined
      ? "chờ lên lịch"
      : `kế tiếp ${runAtFormat.format(job.nextRunAt)}`;
  return `• [${job.id.slice(0, SHORT_ID_LENGTH)}] ${when} — ${job.task} (${state})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `/lich sua <mã> ...` — token kế tiếp là giờ thì đổi giờ; phần chữ còn lại (nếu có) là mô tả
 * mới. Gõ mỗi chữ → chỉ đổi mô tả. Cho đổi cả hai trong một lệnh vì đó là cách người ta thật sự
 * sửa: "dời sang 18h và nói rõ là kèm đơn hoàn".
 */
async function editJob(
  ctx: FlashContext,
  groupId: string,
  shortId: string,
  words: readonly string[],
): Promise<FlashResult> {
  const [head, ...tail] = words;
  if (head === undefined) {
    return fail(
      `Thiếu phần cần sửa. Ví dụ: /lich sua ${shortId} 18:00 — hoặc /lich sua ${shortId} <việc mới>.`,
    );
  }

  const time = parseDailyTime(head);
  const taskWords = time === undefined ? words : tail;
  let task: string | undefined;
  if (taskWords.length > 0) {
    const parsed = readTask(taskWords);
    if (typeof parsed !== "string") return parsed;
    task = parsed;
  }

  const schedule = time === undefined ? undefined : dailyCron(time);
  const updated = await ctx.jobs.update({
    channel: ctx.channel,
    target: groupId,
    shortId: shortId.toLowerCase(),
    schedule,
    task,
  });
  if (!updated) return notFound(shortId);

  const changes: string[] = [];
  if (time !== undefined && schedule !== undefined) {
    changes.push(
      `giờ chạy: ${clockOf(time)} mỗi ngày (kế tiếp ${runAtFormat.format(firstRunOf(schedule))})`,
    );
  }
  if (task !== undefined) changes.push(`việc: "${task}"`);
  return ok(
    [`Đã sửa việc [${shortId}]:`, ...changes.map((line) => `• ${line}`)].join(
      "\n",
    ),
  );
}

async function toggleJob(
  ctx: FlashContext,
  groupId: string,
  shortId: string,
  enabled: boolean,
): Promise<FlashResult> {
  const changed = await ctx.jobs.setEnabled({
    channel: ctx.channel,
    target: groupId,
    shortId: shortId.toLowerCase(),
    enabled,
  });
  if (!changed) {
    return fail(
      `Không đổi được việc "${shortId}": không có mã đó ở nhóm này, hoặc nó đã ${enabled ? "bật" : "tắt"} sẵn.`,
    );
  }
  return ok(
    enabled
      ? `Đã bật lại việc [${shortId}]. Chạy từ lần tới giờ kế tiếp, không chạy bù phần đã tắt.`
      : `Đã tắt việc [${shortId}]. Vẫn nằm trong /lich, bật lại bằng /lich bat ${shortId}.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────────────────────────────────────

async function removeJob(
  ctx: FlashContext,
  groupId: string,
  shortId: string,
): Promise<FlashResult> {
  const removed = await ctx.jobs.remove({
    channel: ctx.channel,
    target: groupId,
    shortId: shortId.toLowerCase(),
  });
  if (!removed) return notFound(shortId);
  return ok(
    `Đã xoá hẳn việc [${shortId}]. Muốn dùng lại phải đặt mới bằng /lich <giờ> <việc>.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dùng chung
// ─────────────────────────────────────────────────────────────────────────────

function notFound(shortId: string): FlashResult {
  return fail(
    `Không thấy việc nào mã "${shortId}" ở nhóm này. Gõ /lich để xem lại.`,
  );
}

/** Trả string khi hợp lệ, FlashResult lỗi khi không — caller narrow bằng typeof. */
function readTask(words: readonly string[]): string | FlashResult {
  const task = words.join(" ").trim();
  if (task.length === 0) {
    return fail(
      "Thiếu mô tả việc. Ví dụ: /lich 17:00 gửi báo cáo cuối ngày cho nhóm.",
    );
  }
  if (task.length > MAX_TASK_CHARS) {
    return fail(
      `Mô tả dài quá ${MAX_TASK_CHARS} ký tự. Viết ngắn lại, phần quy trình để trong skill.`,
    );
  }
  return task;
}

/** Mốc kế tiếp chỉ để XÁC NHẬN cho người gõ — lịch thật do poller đặt ở tick sau. */
function firstRunOf(schedule: string): Date {
  return new Date(nextRunAfter(schedule, Date.now()));
}

function dailyCron(time: { hour: number; minute: number }): string {
  return `${time.minute} ${time.hour} * * *`;
}

function clockOf(time: { hour: number; minute: number }): string {
  return `${pad(time.hour)}:${pad(time.minute)}`;
}

/**
 * Giờ người Việt gõ: `17`, `17h`, `17:00`, `17h30`, `17.30`, `7:05`. Không nhận cron expr —
 * người gõ lệnh là nhân viên, không phải người viết cron; lịch phức tạp đặt thẳng bằng SQL.
 */
export function parseDailyTime(
  text: string,
): { hour: number; minute: number } | undefined {
  const match = /^(\d{1,2})(?:[h:.](\d{1,2})?)?$/.exec(text.trim());
  if (match === null) return undefined;

  const [, hourText, minuteText] = match;
  if (hourText === undefined) return undefined;
  const hour = Number(hourText);
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return undefined;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return undefined;
  return { hour, minute };
}

/** Cron `M H * * *` → "17:00 mỗi ngày". Dạng khác → undefined (caller in nguyên expr). */
function readDailyClock(schedule: string): string | undefined {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule.trim());
  if (match === null) return undefined;
  const [, minute, hour] = match;
  if (minute === undefined || hour === undefined) return undefined;
  return `${pad(Number(hour))}:${pad(Number(minute))} mỗi ngày`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
