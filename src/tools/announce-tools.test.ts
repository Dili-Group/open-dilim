// announce-tools.test.ts — cửa QUYỀN của hai luồng phát tin (impl/announce/). Thứ cần chốt không
// phải câu chữ trả về mà là: ai gọi được port, ai không, và tool bị chặn thì port KHÔNG được đụng
// tới (chặn sau khi đã nuốt nháp là mất nháp).
//
// Luồng vận hành: mọi nhân viên SOẠN được, chỉ ceo/swe CHỐT được.
// Luồng kho: chỉ warehouse/swe, cả soạn lẫn chốt.

import { describe, expect, test } from "bun:test";
import type {
  AnnouncePort,
  AnnouncementStatus,
  DraftOutcome,
  QueueOutcome,
} from "../announcements/types.ts";
import { AnnouncementKind } from "../announcements/types.ts";
import type { Identity } from "../flash-command/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import { HET_HANG_FLOW, VAN_HANH_FLOW } from "./impl/announce/flows.ts";
import {
  buildNoticeDraftTool,
  buildNoticeSendTool,
  buildNoticeStatusTool,
} from "./impl/announce/notice.ts";
import type { ToolContext } from "./types.ts";

const skills: SkillRegistry = await buildSkillRegistry();

const GUEST: Identity = { role: "guest", senderId: "u1" };
const DEALER: Identity = { role: "dai_ly", senderId: "u2", customerId: "dealer-9" };
/** Nhân viên vận hành thường: bind rồi nhưng chức danh không nằm trong nhóm được chốt. */
const STAFF: Identity = { role: "nhan_vien", senderId: "u3", userId: "77", roleSlug: "sale" };
/** Nhân viên bind từ trước khi API trả `role_slug` — fail-closed ở cửa chốt. */
const STAFF_NO_SLUG: Identity = { role: "nhan_vien", senderId: "u4", userId: "78" };
const CEO: Identity = { role: "nhan_vien", senderId: "u5", userId: "79", roleSlug: "ceo" };
const WAREHOUSE: Identity = { role: "nhan_vien", senderId: "u6", userId: "80", roleSlug: "warehouse" };

const OPS_ROOM = { channel: "van-hanh", groupId: "g-ops" };

class FakeAnnounce implements AnnouncePort {
  readonly drafted: { text: string; authorSenderId: string }[] = [];
  readonly queued: { draftId: string; kind: string; senderId: string }[] = [];
  readonly statusAsked: string[] = [];

  draft(input: { text: string; authorSenderId: string }): Promise<DraftOutcome> {
    this.drafted.push(input);
    return Promise.resolve({
      kind: "drafted",
      draft: { id: "abc12345", text: input.text, authorSenderId: input.authorSenderId },
      roomCount: 45,
    });
  }

  queue(input: {
    draftId: string;
    kind: AnnouncementKind;
    senderId: string;
  }): Promise<QueueOutcome> {
    this.queued.push({ draftId: input.draftId, kind: input.kind, senderId: input.senderId });
    return Promise.resolve({ kind: "awaiting_approval", announcementId: "an-1", roomCount: 45 });
  }

  status(input: { senderId: string }): Promise<AnnouncementStatus | undefined> {
    this.statusAsked.push(input.senderId);
    return Promise.resolve(undefined);
  }
}

function ctxOf(identity: Identity, announce: AnnouncePort, room = OPS_ROOM): ToolContext {
  return { skills, identity, announce, room };
}

// ─────────────────────────────────────────────────────────────────────────────
// Luồng vận hành — soạn
// ─────────────────────────────────────────────────────────────────────────────

describe("soan_thong_bao_chung", () => {
  test("nhân viên thường soạn được, nhưng được nói thẳng là không chốt được", async () => {
    const port = new FakeAnnounce();
    const result = await buildNoticeDraftTool(ctxOf(STAFF, port), VAN_HANH_FLOW).run({
      noi_dung: "Mai công ty nghỉ lễ.",
    });

    expect(result.isError).toBeUndefined();
    expect(port.drafted).toEqual([{ text: "Mai công ty nghỉ lễ.", authorSenderId: "u3" }]);
    expect(result.content).toContain("KHÔNG có quyền chốt");
    // Không được xui model gọi tool chốt với mã nháp này (chốt là GETDEL → mất nháp).
    expect(result.content).toContain("KHÔNG gọi chot_thong_bao_chung");
  });

  test("người có quyền chốt soạn → hướng dẫn chốt kèm mã nháp", async () => {
    const port = new FakeAnnounce();
    const result = await buildNoticeDraftTool(ctxOf(CEO, port), VAN_HANH_FLOW).run({
      noi_dung: "Từ 01/09 đổi chính sách đổi trả.",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("ma_ban_nhap = abc12345");
    expect(result.content).toContain("chot_thong_bao_chung");
  });

  test("đại lý và guest KHÔNG soạn được, port không bị đụng", async () => {
    for (const identity of [DEALER, GUEST]) {
      const port = new FakeAnnounce();
      const result = await buildNoticeDraftTool(ctxOf(identity, port), VAN_HANH_FLOW).run({
        noi_dung: "x",
      });
      expect(result.isError).toBe(true);
      expect(result.content).toContain("KHÔNG phải nhân viên vận hành");
      expect(port.drafted).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Luồng vận hành — chốt
// ─────────────────────────────────────────────────────────────────────────────

describe("chot_thong_bao_chung", () => {
  test("ceo chốt được → đợt đi duyệt mang kind van_hanh", async () => {
    const port = new FakeAnnounce();
    const result = await buildNoticeSendTool(ctxOf(CEO, port), VAN_HANH_FLOW).run({
      ma_ban_nhap: "abc12345",
    });

    expect(result.isError).toBeUndefined();
    expect(port.queued).toEqual([
      { draftId: "abc12345", kind: AnnouncementKind.VanHanh, senderId: "u5" },
    ]);
    expect(result.content).toContain("đã chuyển đi duyệt");
  });

  test("nhân viên thường và nhân viên chưa có role_slug đều bị chặn, không tạo đợt nào", async () => {
    for (const identity of [STAFF, STAFF_NO_SLUG, DEALER]) {
      const port = new FakeAnnounce();
      const result = await buildNoticeSendTool(ctxOf(identity, port), VAN_HANH_FLOW).run({
        ma_ban_nhap: "abc12345",
      });
      expect(result.isError).toBe(true);
      expect(result.content).toContain("KHÔNG có quyền chốt");
      expect(port.queued).toEqual([]);
    }
  });

  test("chat riêng (không có phòng) → chặn trước khi nuốt nháp", async () => {
    const port = new FakeAnnounce();
    const ctx: ToolContext = { skills, identity: CEO, announce: port };
    const result = await buildNoticeSendTool(ctx, VAN_HANH_FLOW).run({ ma_ban_nhap: "abc12345" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("nhóm vận hành");
    expect(port.queued).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Soát + luồng kho giữ nguyên cửa cũ
// ─────────────────────────────────────────────────────────────────────────────

describe("soat_thong_bao_chung", () => {
  test("dùng cửa SOẠN: nhân viên thường soát được, chỉ tra đợt của chính mình", async () => {
    const port = new FakeAnnounce();
    const result = await buildNoticeStatusTool(ctxOf(STAFF, port), VAN_HANH_FLOW).run({});

    expect(port.statusAsked).toEqual(["u3"]);
    // Fake trả undefined = chưa có đợt nào → lỗi nghiệp vụ, không throw.
    expect(result.isError).toBe(true);
  });

  test("đại lý không soát được", async () => {
    const port = new FakeAnnounce();
    const result = await buildNoticeStatusTool(ctxOf(DEALER, port), VAN_HANH_FLOW).run({});

    expect(result.isError).toBe(true);
    expect(port.statusAsked).toEqual([]);
  });
});

describe("luồng kho (het_hang) không bị nới ra theo", () => {
  test("ceo KHÔNG soạn/chốt được tin hết hàng", async () => {
    const port = new FakeAnnounce();
    const draft = await buildNoticeDraftTool(ctxOf(CEO, port), HET_HANG_FLOW).run({
      noi_dung: "Yến 100 hết hàng.",
    });
    const send = await buildNoticeSendTool(ctxOf(CEO, port), HET_HANG_FLOW).run({
      ma_ban_nhap: "abc12345",
    });

    expect(draft.isError).toBe(true);
    expect(send.isError).toBe(true);
    expect(draft.content).toContain("KHÔNG phải quản lý kho");
    expect(port.drafted).toEqual([]);
    expect(port.queued).toEqual([]);
  });

  test("quản lý kho vẫn soạn + chốt được, kind giữ nguyên het_hang", async () => {
    const port = new FakeAnnounce();
    const room = { channel: "zalo-kho", groupId: "g-kho" };
    const draft = await buildNoticeDraftTool(ctxOf(WAREHOUSE, port, room), HET_HANG_FLOW).run({
      noi_dung: "Yến 100 hết hàng, 15/08 có lại.",
    });
    const send = await buildNoticeSendTool(ctxOf(WAREHOUSE, port, room), HET_HANG_FLOW).run({
      ma_ban_nhap: "abc12345",
    });

    expect(draft.isError).toBeUndefined();
    expect(send.isError).toBeUndefined();
    expect(port.queued).toEqual([
      { draftId: "abc12345", kind: AnnouncementKind.HetHang, senderId: "u6" },
    ]);
  });
});
