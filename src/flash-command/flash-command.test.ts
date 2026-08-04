// Test tầng flash-command: parse + dispatch + 3 lệnh. Port mock, không đụng DB/hệ vận hành.

import { describe, expect, test } from "bun:test";
import { flashRegistry } from "./index.ts";
import { parseCommand, type DispatchInput } from "./registry.ts";
import { ActorRole, type Identity, type IdentityRepo, type OpsPort } from "./types.ts";

const CHANNEL = "zalo";
const GROUP = "G1";

/** Repo mock ghi lại call để assert side-effect. */
function makeRepo() {
  const calls: string[] = [];
  const repo: IdentityRepo = {
    async bindUser(p) {
      calls.push(`bind:${p.senderId}=${p.userId}`);
    },
    async isBoundUser(p) {
      return p.senderId === "STAFF"; // chỉ STAFF là nhân viên
    },
    async assignDealer(p) {
      calls.push(`assign:${p.senderId}@${p.groupId} by=${p.assignedBy}`);
    },
    async revokeDealer(p) {
      calls.push(`revoke:${p.senderId}@${p.groupId}`);
    },
  };
  return { repo, calls };
}

const ops: OpsPort = {
  async resolveUserByToken(token) {
    return token === "GOOD" ? { userId: "NV_042" } : null;
  },
};

const nhanVien: Identity = { role: ActorRole.NhanVien, senderId: "NV_A", userId: "NV_042" };
const guest: Identity = { role: ActorRole.Guest, senderId: "U_guest" };

function input(over: Partial<DispatchInput>): DispatchInput {
  return {
    identity: nhanVien,
    channel: CHANNEL,
    groupId: GROUP,
    mentions: [],
    repo: makeRepo().repo,
    ops,
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
    expect(calls).toEqual(["bind:U_guest=NV_042"]);
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
  test("nhân viên mention 1 người → assign", async () => {
    const { repo, calls } = makeRepo();
    const r = await flashRegistry.dispatch("/ketnoi-daily @A", input({ repo, mentions: [{ uid: "U_A" }] }));
    expect(r?.ok).toBe(true);
    expect(calls).toEqual(["assign:U_A@G1 by=NV_042"]);
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
