// Test scheduler: cron → mốc kế tiếp (giờ VN), envelope cron, fire-once (CAS + dedupe),
// miss-fire bắn bù một lần. Repo/broker/history/dedupe đều giả — không DB, không Redis.

import { describe, expect, test } from "bun:test";
import type { BroadcastTarget, TypingTarget } from "../broadcast/index.ts";
import type { Envelope, HistoryEntry } from "../types/index.ts";
import { nextRunAfter, parseCron, VN_UTC_OFFSET_MINUTES } from "./schedule.ts";
import { buildCronEnvelope, cronMsgId, fireJob } from "./fire.ts";
import { tick } from "./poller.ts";
import type { ClaimInput, JobRepo, SchedulerDeps, SchedulerJob } from "./types.ts";

const DAILY_17H = "0 17 * * *";

const JOB: SchedulerJob = {
  id: "bao-cao-cuoi-ngay:dl-42",
  schedule: DAILY_17H,
  channel: "zalo",
  identity: "system:cron",
  task: "Chạy báo cáo cuối ngày cho nhóm này.",
  target: "group-42",
};

/** 17h VN = 10:00 UTC cùng ngày (offset cố định +07:00). */
function vn(iso: string): number {
  return Date.parse(iso);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fake ports
// ─────────────────────────────────────────────────────────────────────────────

class FakeRepo implements JobRepo {
  readonly claims: ClaimInput[] = [];
  /** Số lần claim còn được phép thắng — 0 = mô phỏng instance khác đã giành trước. */
  constructor(
    private jobs: SchedulerJob[],
    private winsLeft = Number.POSITIVE_INFINITY,
  ) {}

  due(_now: Date): Promise<SchedulerJob[]> {
    return Promise.resolve(this.jobs);
  }

  claim(input: ClaimInput): Promise<boolean> {
    this.claims.push(input);
    if (this.winsLeft <= 0) return Promise.resolve(false);
    this.winsLeft -= 1;
    this.jobs = this.jobs.map((job) =>
      job.id === input.id ? { ...job, nextRunAt: input.next } : job,
    );
    return Promise.resolve(true);
  }
}

function fakeDeps(repo: JobRepo): SchedulerDeps & {
  published: Envelope[];
  appended: HistoryEntry[];
  seen: Set<string>;
} {
  const published: Envelope[] = [];
  const appended: HistoryEntry[] = [];
  const seen = new Set<string>();
  return {
    repo,
    published,
    appended,
    seen,
    broker: {
      publish: (envelope) => {
        published.push(envelope);
        return Promise.resolve();
      },
    },
    history: {
      append: (entry) => {
        appended.push(entry);
        return Promise.resolve();
      },
    },
    dedupe: {
      firstSee: (channel, msgId) => {
        const key = `${channel}:${msgId}`;
        if (seen.has(key)) return Promise.resolve(false);
        seen.add(key);
        return Promise.resolve(true);
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// schedule.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("nextRunAfter", () => {
  test("17h mỗi ngày = 10:00 UTC cùng ngày", () => {
    const from = vn("2026-08-07T02:00:00Z"); // 09:00 VN
    expect(new Date(nextRunAfter(DAILY_17H, from)).toISOString()).toBe("2026-08-07T10:00:00.000Z");
  });

  test("qua giờ chạy → nhảy sang ngày hôm sau", () => {
    const from = vn("2026-08-07T10:30:00Z"); // 17:30 VN
    expect(new Date(nextRunAfter(DAILY_17H, from)).toISOString()).toBe("2026-08-08T10:00:00.000Z");
  });

  test("đứng đúng mốc → trả mốc KẾ TIẾP (luôn tiến, không đứng yên)", () => {
    const at = vn("2026-08-07T10:00:00Z");
    expect(new Date(nextRunAfter(DAILY_17H, at)).toISOString()).toBe("2026-08-08T10:00:00.000Z");
  });

  test("cuối tháng cuộn sang tháng sau", () => {
    const from = vn("2026-08-31T11:00:00Z"); // 18:00 VN 31/8
    expect(new Date(nextRunAfter(DAILY_17H, from)).toISOString()).toBe("2026-09-01T10:00:00.000Z");
  });

  test("mốc trước nửa đêm VN vẫn tính đúng NGÀY VN (không lệch múi)", () => {
    // 23:30 VN ngày 07/08 = 16:30 UTC 07/08 → mốc kế là 17h VN ngày 08/08.
    const from = vn("2026-08-07T16:30:00Z");
    expect(new Date(nextRunAfter(DAILY_17H, from)).toISOString()).toBe("2026-08-08T10:00:00.000Z");
  });

  test("thứ trong tuần: 8h thứ hai", () => {
    // 2026-08-07 là thứ sáu → thứ hai kế là 10/08, 08:00 VN = 01:00 UTC.
    const from = vn("2026-08-07T02:00:00Z");
    expect(new Date(nextRunAfter("0 8 * * 1", from)).toISOString()).toBe("2026-08-10T01:00:00.000Z");
  });

  test("bước và danh sách: mỗi 30 phút trong khung 8-9h", () => {
    const from = vn("2026-08-07T00:10:00Z"); // 07:10 VN
    expect(new Date(nextRunAfter("0,30 8-9 * * *", from)).toISOString()).toBe(
      "2026-08-07T01:00:00.000Z",
    );
  });

  test("offset truyền vào được (test múi khác VN)", () => {
    const from = vn("2026-08-07T02:00:00Z");
    expect(new Date(nextRunAfter(DAILY_17H, from, 0)).toISOString()).toBe(
      "2026-08-07T17:00:00.000Z",
    );
    expect(VN_UTC_OFFSET_MINUTES).toBe(420);
  });

  test("expr sai cú pháp → throw có tên job đọc được", () => {
    expect(() => parseCron("0 17 * *")).toThrow(/5 trường/);
    expect(() => parseCron("0 99 * * *")).toThrow(/ngoài khoảng 0-23/);
    expect(() => parseCron("0 17 * * */0")).toThrow(/số nguyên dương/);
  });

  test("lịch không bao giờ xảy ra → throw thay vì lặp vô tận", () => {
    expect(() => nextRunAfter("0 0 30 2 *", Date.now())).toThrow(/không có mốc chạy/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fire.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("envelope cron", () => {
  const scheduled = vn("2026-08-07T10:00:00Z");

  test("shape: source=cron, đích = target, chạy dưới identity của job", () => {
    const envelope = buildCronEnvelope(JOB, scheduled);
    expect(envelope.source).toBe("cron");
    expect(envelope.channel).toBe("zalo");
    expect(envelope.conversationId).toBe("group-42");
    expect(envelope.senderId).toBe("system:cron");
    expect(envelope.addressedToAgent).toBe(true);
    expect(envelope.isGroup).toBe(true);
    expect(envelope.text).toBe(JOB.task);
    expect(envelope.ts).toBe(scheduled);
  });

  test("msgId theo (job, MỐC LỊCH) → hai instance lệch đồng hồ vẫn sinh cùng id", () => {
    expect(buildCronEnvelope(JOB, scheduled).msgId).toBe(cronMsgId(JOB.id, scheduled));
    expect(cronMsgId(JOB.id, scheduled)).not.toBe(cronMsgId(JOB.id, scheduled + 1000));
  });

  test("bắn = ghi history phòng (role user) rồi mới publish", async () => {
    const deps = fakeDeps(new FakeRepo([]));
    expect(await fireJob(deps, JOB, scheduled)).toBe(true);

    expect(deps.appended).toHaveLength(1);
    const entry = deps.appended[0];
    expect(entry?.conversationId).toBe("group-42");
    expect(entry?.role).toBe("user");
    expect(entry?.text).toBe(JOB.task);
    expect(deps.published).toHaveLength(1);
    expect(deps.published[0]?.msgId).toBe(entry?.msgId);
  });

  test("dedupe nuốt lần bắn thứ hai cùng mốc", async () => {
    const deps = fakeDeps(new FakeRepo([]));
    expect(await fireJob(deps, JOB, scheduled)).toBe(true);
    expect(await fireJob(deps, JOB, scheduled)).toBe(false);
    expect(deps.published).toHaveLength(1);
    expect(deps.appended).toHaveLength(1);
  });

  test("báo trước: typing rồi text 'Chuẩn bị chạy job' tới đúng phòng", async () => {
    const typed: TypingTarget[] = [];
    const sent: { target: BroadcastTarget; text: string }[] = [];
    const deps = {
      ...fakeDeps(new FakeRepo([])),
      typing: {
        for: () => ({
          typing: (target: TypingTarget) => {
            typed.push(target);
            return Promise.resolve();
          },
        }),
      },
      broadcaster: {
        send: (target: BroadcastTarget, text: string) => {
          sent.push({ target, text });
          return Promise.resolve();
        },
      },
    };

    expect(await fireJob(deps, JOB, scheduled)).toBe(true);
    expect(typed).toEqual([{ channel: "zalo", conversationId: "group-42", isGroup: true }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe(`⏰ Chuẩn bị chạy job: ${JOB.task}`);
    expect(sent[0]?.target.conversationId).toBe("group-42");
    // Báo trước hỏng cũng không được mất lượt → text đi TRƯỚC khi publish.
    expect(deps.published).toHaveLength(1);
  });

  test("báo trước hỏng vẫn bắn job", async () => {
    const deps = {
      ...fakeDeps(new FakeRepo([])),
      broadcaster: {
        send: () => Promise.reject(new Error("bridge chết")),
      },
    };
    expect(await fireJob(deps, JOB, scheduled)).toBe(true);
    expect(deps.published).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// poller.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("tick", () => {
  const now = vn("2026-08-07T10:00:05Z"); // vừa qua mốc 17:00 VN

  test("job tới hạn: claim rồi bắn, lịch mới là mốc kế tiếp", async () => {
    const scheduled = new Date(vn("2026-08-07T10:00:00Z"));
    const repo = new FakeRepo([{ ...JOB, nextRunAt: scheduled }]);
    const deps = fakeDeps(repo);

    await tick(deps, now);

    expect(repo.claims).toHaveLength(1);
    expect(repo.claims[0]?.expected).toEqual(scheduled);
    expect(repo.claims[0]?.next.toISOString()).toBe("2026-08-08T10:00:00.000Z");
    expect(deps.published).toHaveLength(1);
    expect(deps.published[0]?.ts).toBe(scheduled.getTime());
  });

  test("job chưa có lịch: chỉ đặt mốc đầu tiên, KHÔNG bắn", async () => {
    const repo = new FakeRepo([{ ...JOB, nextRunAt: undefined }]);
    const deps = fakeDeps(repo);

    await tick(deps, now);

    expect(repo.claims[0]?.expected).toBeUndefined();
    expect(repo.claims[0]?.ran).toBeUndefined();
    expect(deps.published).toHaveLength(0);
  });

  test("thua CAS (instance khác giành) → không bắn", async () => {
    const repo = new FakeRepo([{ ...JOB, nextRunAt: new Date(vn("2026-08-07T10:00:00Z")) }], 0);
    const deps = fakeDeps(repo);

    await tick(deps, now);

    expect(repo.claims).toHaveLength(1);
    expect(deps.published).toHaveLength(0);
  });

  test("miss-fire: down 3 ngày → bắn BÙ 1 lần, mốc mới tính từ bây giờ", async () => {
    const missed = new Date(vn("2026-08-04T10:00:00Z"));
    const repo = new FakeRepo([{ ...JOB, nextRunAt: missed }]);
    const deps = fakeDeps(repo);

    await tick(deps, now);

    expect(deps.published).toHaveLength(1);
    expect(deps.published[0]?.ts).toBe(missed.getTime());
    // Không replay 05/08, 06/08 — nhảy thẳng mốc kế tiếp sau `now`.
    expect(repo.claims[0]?.next.toISOString()).toBe("2026-08-08T10:00:00.000Z");
  });

  test("cron hỏng: KHÔNG claim, không bắn, job còn nguyên lịch để tick sau kêu lại", async () => {
    const scheduled = new Date(vn("2026-08-07T10:00:00Z"));
    const repo = new FakeRepo([{ ...JOB, schedule: "sai bét", nextRunAt: scheduled }]);
    const deps = fakeDeps(repo);

    await tick(deps, now);

    expect(repo.claims).toHaveLength(0);
    expect(deps.published).toHaveLength(0);
  });

  test("một job hỏng không chặn job còn lại trong cùng tick", async () => {
    const scheduled = new Date(vn("2026-08-07T10:00:00Z"));
    const repo = new FakeRepo([
      { ...JOB, id: "hong", schedule: "sai bét", nextRunAt: scheduled },
      { ...JOB, id: "chay", nextRunAt: scheduled },
    ]);
    const deps = fakeDeps(repo);

    await tick(deps, now);

    expect(deps.published).toHaveLength(1);
    expect(deps.published[0]?.msgId).toBe(cronMsgId("chay", scheduled.getTime()));
  });
});
