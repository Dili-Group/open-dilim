// Test tầng flash-command: parse + dispatch + 3 lệnh. Port mock, không đụng DB/hệ vận hành.

import { describe, expect, test } from "bun:test";
import { flashRegistry } from "./index.ts";
import { parseCommand, type DispatchInput } from "./registry.ts";
import {
  ActorRole,
  type Identity,
  type IdentityRepo,
  type JobAdmin,
  type JobSummary,
  type OpsPort,
} from "./types.ts";

const CHANNEL = "zalo";
const GROUP = "G1";
/** Tên đại lý hệ vận hành trả về — reply của /ketnoi-daily phải gọi đúng tên này. */
const DEALER_NAME = "Gioi dz";

/** Repo mock ghi lại call để assert side-effect. */
function makeRepo() {
  const calls: string[] = [];
  const repo: IdentityRepo = {
    async bindUser(p) {
      calls.push(
        `bind:${p.senderId}=${p.userId} tok=${p.opToken} role=${p.roleSlug ?? "-"} name=${p.fullName ?? "-"}`,
      );
    },
    async isBoundUser(p) {
      return p.senderId === "STAFF"; // chỉ STAFF là nhân viên
    },
    async getOpToken(p) {
      return p.senderId === "NV_A" ? "OPTOK" : null; // chỉ NV_A đã bind op token
    },
    async upsertGroupMap(p) {
      calls.push(`map:${p.groupId}=${p.customerId}`);
    },
    async assignDealer(p) {
      calls.push(`assign:${p.senderId}@${p.groupId} by=${p.assignedBy}`);
    },
    async revokeDealer(p) {
      calls.push(`revoke:${p.senderId}@${p.groupId}`);
    },
    async blockGroup(p) {
      calls.push(`block:${p.groupId} by=${p.blockedBy}`);
    },
    async unblockGroup(p) {
      calls.push(`unblock:${p.groupId}`);
    },
    async isGroupBlocked(p) {
      return p.groupId === "G_BLOCKED";
    },
  };
  return { repo, calls };
}

const ops: OpsPort = {
  async resolveUserByToken(token) {
    return token === "GOOD"
      ? { userId: "NV_042", roleSlug: "ke_toan", fullName: "Nguyễn Văn A" }
      : null;
  },
  async fetchDealerInfo(p) {
    // Nhóm G1 có đại lý gắn ở hệ vận hành; nhóm khác → null.
    return p.groupId === GROUP ? { customerId: "CUS_9", name: DEALER_NAME } : null;
  },
};

const nhanVien: Identity = { role: ActorRole.NhanVien, senderId: "NV_A", userId: "NV_042" };
const guest: Identity = { role: ActorRole.Guest, senderId: "U_guest" };

/** Port job cron in-mem: đủ để khẳng định /lich ghi gì, không đụng Postgres. */
function makeJobs(seed: JobSummary[] = []): {
  jobs: JobAdmin;
  rows: JobSummary[];
  created: { id: string; schedule: string; task: string; target: string; channel: string }[];
} {
  const rows = [...seed];
  const created: { id: string; schedule: string; task: string; target: string; channel: string }[] = [];
  const find = (shortId: string): JobSummary | undefined =>
    rows.find((row) => row.id.startsWith(shortId));
  const jobs: JobAdmin = {
    create: (job) => {
      created.push(job);
      rows.push({ id: job.id, schedule: job.schedule, task: job.task, enabled: true });
      return Promise.resolve();
    },
    listByTarget: (p) => Promise.resolve(p.target === GROUP ? rows : []),
    update: (p) => {
      const row = find(p.shortId);
      if (row === undefined || p.target !== GROUP) return Promise.resolve(false);
      rows[rows.indexOf(row)] = {
        ...row,
        schedule: p.schedule ?? row.schedule,
        task: p.task ?? row.task,
      };
      return Promise.resolve(true);
    },
    setEnabled: (p) => {
      const row = find(p.shortId);
      if (row === undefined || p.target !== GROUP || row.enabled === p.enabled) {
        return Promise.resolve(false);
      }
      rows[rows.indexOf(row)] = { ...row, enabled: p.enabled };
      return Promise.resolve(true);
    },
    remove: (p) => {
      const row = find(p.shortId);
      if (row === undefined || p.target !== GROUP) return Promise.resolve(false);
      rows.splice(rows.indexOf(row), 1);
      return Promise.resolve(true);
    },
  };
  return { jobs, rows, created };
}

function input(over: Partial<DispatchInput>): DispatchInput {
  return {
    identity: nhanVien,
    channel: CHANNEL,
    groupId: GROUP,
    mentions: [],
    repo: makeRepo().repo,
    ops,
    jobs: makeJobs().jobs,
    ...over,
  };
}

describe("parseCommand", () => {
  test("text thường → null", () => {
    expect(parseCommand("chào bạn")).toBeNull();
  });
  test("tách tên + args, lowercase tên", () => {
    expect(parseCommand("  /Ketnoi-Hethong  GOOD ")).toEqual({ name: "ketnoi-hethong", args: ["GOOD"] });
  });
  test("'/' trơ → null", () => {
    expect(parseCommand("/   ")).toBeNull();
  });
});

describe("dispatch — không phải lệnh / tên lạ", () => {
  test("text thường → null (để agent xử lý)", async () => {
    expect(await flashRegistry.dispatch("hỏi gì đó", input({}))).toBeNull();
  });
  test("lệnh lạ → fail có reply", async () => {
    const r = await flashRegistry.dispatch("/khong-co", input({}));
    expect(r).toEqual({ ok: false, reply: expect.stringContaining("không tồn tại") });
  });
});

describe("/ketnoi-hethong", () => {
  test("token tốt → bind + ok", async () => {
    const { repo, calls } = makeRepo();
    const r = await flashRegistry.dispatch("/ketnoi-hethong GOOD", input({ identity: guest, repo }));
    expect(r?.ok).toBe(true);
    expect(calls).toEqual(["bind:U_guest=NV_042 tok=GOOD role=ke_toan name=Nguyễn Văn A"]);
  });
  test("thiếu token → fail, không bind", async () => {
    const { repo, calls } = makeRepo();
    const r = await flashRegistry.dispatch("/ketnoi-hethong", input({ identity: guest, repo }));
    expect(r?.ok).toBe(false);
    expect(calls).toEqual([]);
  });
  test("token sai → fail", async () => {
    const r = await flashRegistry.dispatch("/ketnoi-hethong BAD", input({ identity: guest }));
    expect(r?.ok).toBe(false);
  });
});

describe("/ketnoi-daily", () => {
  test("nhân viên mention 1 người → map group + assign", async () => {
    const { repo, calls } = makeRepo();
    const r = await flashRegistry.dispatch("/ketnoi-daily @A", input({ repo, mentions: [{ uid: "U_A" }] }));
    expect(r?.ok).toBe(true);
    // group_map ghi TRƯỚC assign (resolve vai đại lý cần cả hai).
    expect(calls).toEqual(["map:G1=CUS_9", "assign:U_A@G1 by=NV_042"]);
  });

  test("reply gọi TÊN đại lý hệ vận hành trả về, không phải customerId", async () => {
    const { repo } = makeRepo();
    const r = await flashRegistry.dispatch("/ketnoi-daily @A", input({ repo, mentions: [{ uid: "U_A" }] }));
    expect(r?.reply).toContain(DEALER_NAME);
    // customerId là khoá nội bộ — lọt vào tin nhắn nhóm là rò dữ liệu hệ vận hành.
    expect(r?.reply).not.toContain("CUS_9");
  });
  test("nhân viên chưa bind op token → fail, không map/assign", async () => {
    const { repo, calls } = makeRepo();
    const noTokenStaff: Identity = { role: ActorRole.NhanVien, senderId: "NV_X", userId: "NV_099" };
    const r = await flashRegistry.dispatch(
      "/ketnoi-daily @A",
      input({ repo, identity: noTokenStaff, mentions: [{ uid: "U_A" }] }),
    );
    expect(r?.ok).toBe(false);
    expect(calls).toEqual([]);
  });
  test("nhóm chưa gắn đại lý ở hệ vận hành → fail, không map/assign", async () => {
    const { repo, calls } = makeRepo();
    // Nhóm khác G1 → hệ vận hành không có đại lý gắn với nhóm này.
    const r = await flashRegistry.dispatch(
      "/ketnoi-daily @B",
      input({ repo, mentions: [{ uid: "U_B" }], groupId: "G_KHONG_DAI_LY" }),
    );
    expect(r?.ok).toBe(false);
    expect(calls).toEqual([]);
  });
  test("guest gõ → chặn quyền", async () => {
    const r = await flashRegistry.dispatch("/ketnoi-daily @A", input({ identity: guest, mentions: [{ uid: "U_A" }] }));
    expect(r?.ok).toBe(false);
  });
  test("thiếu mention → fail", async () => {
    const r = await flashRegistry.dispatch("/ketnoi-daily", input({ mentions: [] }));
    expect(r?.ok).toBe(false);
  });
  test("mention là nhân viên → chặn", async () => {
    const r = await flashRegistry.dispatch("/ketnoi-daily @s", input({ mentions: [{ uid: "STAFF" }] }));
    expect(r?.ok).toBe(false);
  });
  test("ngoài group → fail", async () => {
    const r = await flashRegistry.dispatch("/ketnoi-daily @A", input({ groupId: undefined, mentions: [{ uid: "U_A" }] }));
    expect(r?.ok).toBe(false);
  });
});

describe("/huy-ketnoi", () => {
  test("nhân viên mention → revoke", async () => {
    const { repo, calls } = makeRepo();
    const r = await flashRegistry.dispatch("/huy-ketnoi @A", input({ repo, mentions: [{ uid: "U_A" }] }));
    expect(r?.ok).toBe(true);
    expect(calls).toEqual(["revoke:U_A@G1"]);
  });
});

describe("/block + /unlock", () => {
  test("nhân viên gõ /block → ghi group_block kèm người chặn", async () => {
    const { repo, calls } = makeRepo();
    const r = await flashRegistry.dispatch("/block", input({ repo }));
    expect(r?.ok).toBe(true);
    expect(calls).toEqual(["block:G1 by=NV_042"]);
  });
  test("nhân viên gõ /unlock → xoá group_block", async () => {
    const { repo, calls } = makeRepo();
    const r = await flashRegistry.dispatch("/unlock", input({ repo }));
    expect(r?.ok).toBe(true);
    expect(calls).toEqual(["unblock:G1"]);
  });
  test("guest gõ → chặn quyền, không đụng repo", async () => {
    const { repo, calls } = makeRepo();
    const r = await flashRegistry.dispatch("/block", input({ repo, identity: guest }));
    expect(r?.ok).toBe(false);
    expect(calls).toEqual([]);
  });
  test("ngoài group → fail cả hai lệnh", async () => {
    const { repo, calls } = makeRepo();
    expect((await flashRegistry.dispatch("/block", input({ repo, groupId: undefined })))?.ok).toBe(false);
    expect((await flashRegistry.dispatch("/unlock", input({ repo, groupId: undefined })))?.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("/lich — CRUD việc theo giờ", () => {
  const DAILY_17H = "0 17 * * *";

  test("thêm: giờ + mô tả → job của CHÍNH nhóm này, mã ngắn trong reply", async () => {
    const { jobs, created } = makeJobs();
    const r = await flashRegistry.dispatch("/lich 17:00 gửi báo cáo cuối ngày", input({ jobs }));

    expect(r?.ok).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]?.schedule).toBe(DAILY_17H);
    expect(created[0]?.task).toBe("gửi báo cáo cuối ngày");
    expect(created[0]?.target).toBe(GROUP);
    expect(created[0]?.channel).toBe(CHANNEL);
    expect(r?.reply).toContain(created[0]?.id.slice(0, 8));
  });

  test("thêm: nhận 17h, 17h30, 17 — không bắt gõ cron", async () => {
    for (const [text, expected] of [
      ["17h", "0 17 * * *"],
      ["17h30", "30 17 * * *"],
      ["7", "0 7 * * *"],
    ] as const) {
      const { jobs, created } = makeJobs();
      await flashRegistry.dispatch(`/lich ${text} chốt sổ`, input({ jobs }));
      expect(created[0]?.schedule).toBe(expected);
    }
  });

  test("thêm: thiếu mô tả / giờ sai → fail, không ghi", async () => {
    const { jobs, created } = makeJobs();
    expect((await flashRegistry.dispatch("/lich 17:00", input({ jobs })))?.ok).toBe(false);
    expect((await flashRegistry.dispatch("/lich 99:00 abc", input({ jobs })))?.ok).toBe(false);
    expect(created).toHaveLength(0);
  });

  test("xem: liệt kê kèm mã + giờ + trạng thái", async () => {
    const { jobs } = makeJobs([
      { id: "a1b2c3d4-x", schedule: DAILY_17H, task: "báo cáo", enabled: true },
      { id: "e5f6a7b8-y", schedule: "0 8 * * *", task: "nhắc tồn", enabled: false },
    ]);
    const r = await flashRegistry.dispatch("/lich", input({ jobs }));

    expect(r?.reply).toContain("[a1b2c3d4] 17:00 mỗi ngày — báo cáo");
    expect(r?.reply).toContain("[e5f6a7b8] 08:00 mỗi ngày — nhắc tồn (đang tắt)");
  });

  test("sửa: đổi giờ, đổi việc, hoặc cả hai", async () => {
    const seed = (): JobSummary[] => [
      { id: "a1b2c3d4-x", schedule: DAILY_17H, task: "báo cáo", enabled: true },
    ];

    const onlyTime = makeJobs(seed());
    await flashRegistry.dispatch("/lich sua a1b2c3d4 18:30", input({ jobs: onlyTime.jobs }));
    expect(onlyTime.rows[0]?.schedule).toBe("30 18 * * *");
    expect(onlyTime.rows[0]?.task).toBe("báo cáo");

    const onlyTask = makeJobs(seed());
    await flashRegistry.dispatch("/lich sua a1b2c3d4 báo cáo kèm đơn hoàn", input({ jobs: onlyTask.jobs }));
    expect(onlyTask.rows[0]?.schedule).toBe(DAILY_17H);
    expect(onlyTask.rows[0]?.task).toBe("báo cáo kèm đơn hoàn");

    const both = makeJobs(seed());
    await flashRegistry.dispatch("/lich sua a1b2c3d4 19:00 chốt sổ ngày", input({ jobs: both.jobs }));
    expect(both.rows[0]?.schedule).toBe("0 19 * * *");
    expect(both.rows[0]?.task).toBe("chốt sổ ngày");
  });

  test("tắt rồi bật lại", async () => {
    const { jobs, rows } = makeJobs([
      { id: "a1b2c3d4-x", schedule: DAILY_17H, task: "báo cáo", enabled: true },
    ]);
    expect((await flashRegistry.dispatch("/lich tat a1b2c3d4", input({ jobs })))?.ok).toBe(true);
    expect(rows[0]?.enabled).toBe(false);
    expect((await flashRegistry.dispatch("/lich bat a1b2c3d4", input({ jobs })))?.ok).toBe(true);
    expect(rows[0]?.enabled).toBe(true);
    // Bật lại cái đang bật → không đổi gì, báo rõ.
    expect((await flashRegistry.dispatch("/lich bat a1b2c3d4", input({ jobs })))?.ok).toBe(false);
  });

  test("xoá hẳn", async () => {
    const { jobs, rows } = makeJobs([
      { id: "a1b2c3d4-x", schedule: DAILY_17H, task: "báo cáo", enabled: true },
    ]);
    expect((await flashRegistry.dispatch("/lich xoa a1b2c3d4", input({ jobs })))?.ok).toBe(true);
    expect(rows).toHaveLength(0);
  });

  test("mã lạ → fail, không đụng job nào", async () => {
    const { jobs, rows } = makeJobs([
      { id: "a1b2c3d4-x", schedule: DAILY_17H, task: "báo cáo", enabled: true },
    ]);
    expect((await flashRegistry.dispatch("/lich xoa zzzzzzzz", input({ jobs })))?.ok).toBe(false);
    expect((await flashRegistry.dispatch("/lich sua zzzzzzzz 18:00", input({ jobs })))?.ok).toBe(false);
    expect(rows).toHaveLength(1);
  });

  test("gõ có dấu: /lịch, /lịch xóa, /lịch sửa đều trúng", async () => {
    const { jobs, rows, created } = makeJobs([
      { id: "a1b2c3d4-x", schedule: DAILY_17H, task: "báo cáo", enabled: true },
    ]);
    expect((await flashRegistry.dispatch("/lịch", input({ jobs })))?.reply).toContain("a1b2c3d4");

    await flashRegistry.dispatch("/lịch sửa a1b2c3d4 18:00", input({ jobs }));
    expect(rows[0]?.schedule).toBe("0 18 * * *");

    await flashRegistry.dispatch("/lịch tắt a1b2c3d4", input({ jobs }));
    expect(rows[0]?.enabled).toBe(false);

    await flashRegistry.dispatch("/lịch xóa a1b2c3d4", input({ jobs }));
    expect(rows).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  test("mô tả việc GIỮ NGUYÊN dấu (chỉ khoá tra cứu mới bỏ dấu)", async () => {
    const { jobs, created } = makeJobs();
    await flashRegistry.dispatch("/lịch 17:00 gửi báo cáo cuối ngày kèm đơn hoàn", input({ jobs }));
    expect(created[0]?.task).toBe("gửi báo cáo cuối ngày kèm đơn hoàn");
  });

  test("không phải nhân viên / không phải nhóm → chặn", async () => {
    const { jobs, created } = makeJobs();
    expect((await flashRegistry.dispatch("/lich 17:00 abc", input({ jobs, identity: guest })))?.ok).toBe(false);
    expect(
      (await flashRegistry.dispatch("/lich 17:00 abc", input({ jobs, groupId: undefined })))?.ok,
    ).toBe(false);
    expect(created).toHaveLength(0);
  });
});
