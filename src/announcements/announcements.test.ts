// Test tầng announcements: soạn nháp, chốt → CHỜ DUYỆT (không gửi cho ai), cửa duyệt đích danh,
// poller gửi + retry + chịu thua. Store/drafts/broadcaster/history đều giả — không DB, không Redis.
//
// Trọng tâm là HAI hàng rào, vì hỏng chỗ nào cũng là tin sai bắn ra toàn bộ đại lý:
//   1. chốt xong KHÔNG có row nào tới hạn gửi (chưa duyệt = chưa đi).
//   2. chỉ đúng `approverUserId` mới mở khoá được.

import { describe, expect, test } from "bun:test";
import { AnnouncementStatus as AnnouncementState, DeliveryStatus } from "../db/schema.ts";
import type { BroadcastTarget } from "../broadcast/types.ts";
import type { HistoryEntry } from "../types/index.ts";
import { AnnouncementService } from "./service.ts";
import { backoffFrom, tick } from "./poller.ts";
import { AnnouncementKind, MAX_ATTEMPTS } from "./types.ts";
import type {
  AnnouncementDeps,
  AnnouncementDraft,
  AnnouncementStatus,
  AnnouncementStore,
  ApproveInput,
  ApproverRoom,
  AwaitingApproval,
  ClaimDeliveryInput,
  CreateAnnouncementInput,
  DealerRoom,
  Delivery,
  DraftStore,
  FailDeliveryInput,
  FailedDelivery,
  RejectInput,
} from "./types.ts";

const APPROVER_USER = "NV_GIOI";
const APPROVER_ROOM: ApproverRoom = { channel: "van-hanh", conversationId: "uid-gioi" };
const KHO_ROOM: ApproverRoom = { channel: "zalo-kho", conversationId: "kho-1" };
const KEEPER = "sender-thu-kho";
const NOW = Date.parse("2026-08-10T02:00:00Z");

const ROOMS: readonly DealerRoom[] = [
  { channel: "zalo", groupId: "g1", customerId: "c1" },
  { channel: "zalo", groupId: "g2", customerId: "c2" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Fake ports
// ─────────────────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  announcementId: string;
  channel: string;
  groupId: string;
  customerId: string;
  status: number;
  attempts: number;
  lastError?: string;
  nextAttemptAt?: Date;
}

class FakeStore implements AnnouncementStore {
  readonly heads = new Map<
    string,
    { kind: string; text: string; createdBy: string; origin: ApproverRoom; state: number; reject?: string }
  >();
  readonly rows: Row[] = [];
  /** Nhóm bị /block giữa chừng — approve phải bỏ qua chúng. */
  blocked = new Set<string>();
  /** Số lần claim còn được phép thắng — 0 = mô phỏng instance khác đã giành trước. */
  constructor(private claimWinsLeft = Number.POSITIVE_INFINITY) {}

  create(input: CreateAnnouncementInput): Promise<string> {
    const id = `a${this.heads.size + 1}`;
    this.heads.set(id, {
      kind: input.kind,
      text: input.text,
      createdBy: input.createdBy,
      origin: input.origin,
      state: AnnouncementState.AwaitingApproval,
    });
    for (const room of input.rooms) {
      this.rows.push({
        id: `d${this.rows.length + 1}`,
        announcementId: id,
        channel: room.channel,
        groupId: room.groupId,
        customerId: room.customerId,
        status: DeliveryStatus.Pending,
        attempts: 0,
        // Cố ý KHÔNG đặt: chưa duyệt thì không row nào tới hạn.
        nextAttemptAt: undefined,
      });
    }
    return Promise.resolve(id);
  }

  find(announcementId: string): Promise<AwaitingApproval | undefined> {
    const head = this.heads.get(announcementId);
    if (head === undefined) return Promise.resolve(undefined);
    return Promise.resolve({
      announcementId,
      kind: head.kind,
      text: head.text,
      createdBy: head.createdBy,
      roomCount: this.rows.filter((r) => r.announcementId === announcementId).length,
      createdAt: new Date(NOW),
    });
  }

  approve({ announcementId, firstAttemptAt }: ApproveInput): Promise<number | undefined> {
    const head = this.heads.get(announcementId);
    if (head === undefined || head.state !== AnnouncementState.AwaitingApproval) {
      return Promise.resolve(undefined);
    }
    head.state = AnnouncementState.Approved;
    let opened = 0;
    for (const row of this.rows) {
      if (row.announcementId !== announcementId) continue;
      if (row.status !== DeliveryStatus.Pending) continue;
      if (this.blocked.has(row.groupId)) continue;
      row.nextAttemptAt = firstAttemptAt;
      opened += 1;
    }
    return Promise.resolve(opened);
  }

  reject({ announcementId, reason }: RejectInput): Promise<boolean> {
    const head = this.heads.get(announcementId);
    if (head === undefined || head.state !== AnnouncementState.AwaitingApproval) {
      return Promise.resolve(false);
    }
    head.state = AnnouncementState.Rejected;
    head.reject = reason;
    return Promise.resolve(true);
  }

  listAwaiting(limit: number): Promise<readonly AwaitingApproval[]> {
    const ids = [...this.heads.entries()]
      .filter(([, head]) => head.state === AnnouncementState.AwaitingApproval)
      .slice(0, limit)
      .map(([id]) => id);
    return Promise.all(ids.map((id) => this.find(id))).then((items) =>
      items.filter((item): item is AwaitingApproval => item !== undefined),
    );
  }

  dueForSend(now: Date): Promise<readonly Delivery[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (row) =>
            row.status === DeliveryStatus.Pending &&
            row.nextAttemptAt !== undefined &&
            row.nextAttemptAt.getTime() <= now.getTime() &&
            this.heads.get(row.announcementId)?.state === AnnouncementState.Approved,
        )
        .map((row) => ({
          id: row.id,
          announcementId: row.announcementId,
          channel: row.channel,
          groupId: row.groupId,
          customerId: row.customerId,
          text: this.heads.get(row.announcementId)?.text ?? "",
          attempts: row.attempts,
          nextAttemptAt: row.nextAttemptAt,
        })),
    );
  }

  claim({ id, expected, next }: ClaimDeliveryInput): Promise<boolean> {
    if (this.claimWinsLeft <= 0) return Promise.resolve(false);
    const row = this.rows.find((item) => item.id === id);
    if (row === undefined || row.nextAttemptAt?.getTime() !== expected.getTime()) {
      return Promise.resolve(false);
    }
    this.claimWinsLeft -= 1;
    row.nextAttemptAt = next;
    row.attempts += 1;
    return Promise.resolve(true);
  }

  markSent(id: string): Promise<void> {
    const row = this.rows.find((item) => item.id === id);
    if (row !== undefined) {
      row.status = DeliveryStatus.Sent;
      row.nextAttemptAt = undefined;
    }
    return Promise.resolve();
  }

  markFailed({ id, reason, giveUp }: FailDeliveryInput): Promise<void> {
    const row = this.rows.find((item) => item.id === id);
    if (row !== undefined) {
      row.lastError = reason;
      if (giveUp) {
        row.status = DeliveryStatus.Failed;
        row.nextAttemptAt = undefined;
      }
    }
    return Promise.resolve();
  }

  status(announcementId: string): Promise<AnnouncementStatus | undefined> {
    const head = this.heads.get(announcementId);
    if (head === undefined) return Promise.resolve(undefined);
    const rows = this.rows.filter((row) => row.announcementId === announcementId);
    const failed: FailedDelivery[] = rows
      .filter((row) => row.status === DeliveryStatus.Failed)
      .map((row) => ({
        groupId: row.groupId,
        customerId: row.customerId,
        reason: row.lastError ?? "(không rõ lý do)",
      }));
    return Promise.resolve({
      announcementId,
      state: head.state as AnnouncementStatus["state"],
      total: rows.length,
      sent: rows.filter((row) => row.status === DeliveryStatus.Sent).length,
      pending: rows.filter((row) => row.status === DeliveryStatus.Pending).length,
      failed,
      rejectReason: head.reject,
    });
  }

  latestBy(createdBy: string): Promise<string | undefined> {
    const found = [...this.heads.entries()].reverse().find(([, h]) => h.createdBy === createdBy);
    return Promise.resolve(found?.[0]);
  }

  originOf(announcementId: string): Promise<ApproverRoom | undefined> {
    return Promise.resolve(this.heads.get(announcementId)?.origin);
  }
}

class FakeDrafts implements DraftStore {
  readonly items = new Map<string, AnnouncementDraft>();
  put(draft: AnnouncementDraft): Promise<void> {
    this.items.set(draft.id, draft);
    return Promise.resolve();
  }
  /** GETDEL: lấy rồi xoá — chốt hai lần thì lần hai không còn gì. */
  take(id: string): Promise<AnnouncementDraft | undefined> {
    const found = this.items.get(id);
    this.items.delete(id);
    return Promise.resolve(found);
  }
}

class FakeBroadcaster {
  readonly sent: { target: BroadcastTarget; text: string }[] = [];
  /** groupId nào cũng ném lỗi — mô phỏng bridge từ chối. */
  failFor = new Set<string>();
  send(target: BroadcastTarget, text: string): Promise<void> {
    if (this.failFor.has(target.conversationId)) {
      return Promise.reject(new Error(`bridge từ chối ${target.conversationId}`));
    }
    this.sent.push({ target, text });
    return Promise.resolve();
  }
  sendMedia(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeHistory {
  readonly entries: HistoryEntry[] = [];
  append(entry: HistoryEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

function buildDeps(over: Partial<AnnouncementDeps> = {}): {
  deps: AnnouncementDeps;
  store: FakeStore;
  drafts: FakeDrafts;
  broadcaster: FakeBroadcaster;
  history: FakeHistory;
} {
  const store = (over.store as FakeStore | undefined) ?? new FakeStore();
  const drafts = new FakeDrafts();
  const broadcaster = (over.broadcaster as FakeBroadcaster | undefined) ?? new FakeBroadcaster();
  const history = new FakeHistory();
  const deps: AnnouncementDeps = {
    store,
    drafts,
    broadcaster,
    history,
    rooms: { allEnabled: (): Promise<readonly DealerRoom[]> => Promise.resolve(ROOMS) },
    approverRooms: { roomOf: (): Promise<ApproverRoom | undefined> => Promise.resolve(APPROVER_ROOM) },
    approverUserId: APPROVER_USER,
    ...over,
  };
  return { deps, store, drafts, broadcaster, history };
}

/** Soạn nháp rồi chốt — trả mã đợt. Dùng ở phần lớn test nên gói lại. */
async function draftAndQueue(
  service: AnnouncementService,
  text = "Yến 100 hết hàng, 15/08 có lại.",
): Promise<string> {
  const drafted = await service.draft({ text, authorSenderId: KEEPER });
  if (drafted.kind !== "drafted") throw new Error(`soạn nháp hỏng: ${drafted.kind}`);
  const queued = await service.queue({
    draftId: drafted.draft.id,
    kind: AnnouncementKind.HetHang,
    senderId: KEEPER,
    origin: KHO_ROOM,
    nowMs: NOW,
  });
  if (queued.kind !== "awaiting_approval") throw new Error(`chốt hỏng: ${queued.kind}`);
  return queued.announcementId;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("soạn nháp", () => {
  test("trả nháp kèm số nhóm sẽ nhận, chưa ghi gì vào store", async () => {
    const { deps, store } = buildDeps();
    const service = new AnnouncementService(deps);

    const outcome = await service.draft({ text: "Yến 100 hết hàng.", authorSenderId: KEEPER });

    expect(outcome.kind).toBe("drafted");
    if (outcome.kind !== "drafted") return;
    expect(outcome.roomCount).toBe(2);
    expect(store.heads.size).toBe(0);
  });

  test("chưa nhóm đại lý nào được nối → no_room, không tạo nháp", async () => {
    const { deps, drafts } = buildDeps({
      rooms: { allEnabled: (): Promise<readonly DealerRoom[]> => Promise.resolve([]) },
    });
    const outcome = await new AnnouncementService(deps).draft({ text: "x", authorSenderId: KEEPER });

    expect(outcome.kind).toBe("no_room");
    expect(drafts.items.size).toBe(0);
  });

  test("vượt trần kênh chặt nhất → too_long, không cắt bớt", async () => {
    const { deps } = buildDeps();
    const outcome = await new AnnouncementService(deps).draft({
      text: "x".repeat(5000),
      authorSenderId: KEEPER,
    });

    expect(outcome.kind).toBe("too_long");
    if (outcome.kind !== "too_long") return;
    expect(outcome.length).toBe(5000);
    expect(outcome.limit).toBe(4500);
  });
});

describe("chốt → chờ duyệt", () => {
  test("KHÔNG gửi cho nhóm đại lý nào, chỉ gửi yêu cầu duyệt", async () => {
    const { deps, store, broadcaster } = buildDeps();
    const service = new AnnouncementService(deps);

    const id = await draftAndQueue(service);

    expect(store.heads.get(id)?.state).toBe(AnnouncementState.AwaitingApproval);
    // Đúng MỘT tin đi ra, và nó tới phòng người duyệt — không nhóm đại lý nào.
    expect(broadcaster.sent).toHaveLength(1);
    expect(broadcaster.sent[0]?.target.conversationId).toBe(APPROVER_ROOM.conversationId);
    expect(broadcaster.sent[0]?.text).toContain(`/duyet-thongbao ${id}`);
  });

  test("row nhận sinh ra KHÔNG tới hạn → poller chạy cũng không gửi gì", async () => {
    const { deps, store, broadcaster, history } = buildDeps();
    const service = new AnnouncementService(deps);
    await draftAndQueue(service);
    broadcaster.sent.length = 0;

    await tick(deps, NOW + 3_600_000);

    expect(broadcaster.sent).toHaveLength(0);
    expect(history.entries).toHaveLength(0);
    expect(store.rows.every((row) => row.status === DeliveryStatus.Pending)).toBe(true);
  });

  test("chưa cấu hình người duyệt → no_approver, KHÔNG tạo đợt và nháp còn nguyên", async () => {
    const { deps, store, drafts } = buildDeps({ approverUserId: undefined });
    const service = new AnnouncementService(deps);
    const drafted = await service.draft({ text: "Yến 100 hết.", authorSenderId: KEEPER });
    if (drafted.kind !== "drafted") throw new Error("soạn nháp hỏng");

    const outcome = await service.queue({
      draftId: drafted.draft.id,
      kind: AnnouncementKind.HetHang,
      senderId: KEEPER,
      origin: KHO_ROOM,
      nowMs: NOW,
    });

    expect(outcome.kind).toBe("no_approver");
    expect(store.heads.size).toBe(0);
    // Nháp KHÔNG bị nuốt: thủ kho chốt lại được sau khi kỹ thuật sửa cấu hình.
    expect(drafts.items.has(drafted.draft.id)).toBe(true);
  });

  test("người duyệt chưa nối tài khoản → no_approver (không đẻ đợt treo không ai duyệt)", async () => {
    const { deps, store } = buildDeps({
      approverRooms: { roomOf: (): Promise<ApproverRoom | undefined> => Promise.resolve(undefined) },
    });
    const service = new AnnouncementService(deps);
    const drafted = await service.draft({ text: "Yến 100 hết.", authorSenderId: KEEPER });
    if (drafted.kind !== "drafted") throw new Error("soạn nháp hỏng");

    const outcome = await service.queue({
      draftId: drafted.draft.id,
      kind: AnnouncementKind.HetHang,
      senderId: KEEPER,
      origin: KHO_ROOM,
      nowMs: NOW,
    });

    expect(outcome.kind).toBe("no_approver");
    expect(store.heads.size).toBe(0);
  });

  test("người khác chốt hộ nháp → not_author, không tạo đợt", async () => {
    const { deps, store } = buildDeps();
    const service = new AnnouncementService(deps);
    const drafted = await service.draft({ text: "Yến 100 hết.", authorSenderId: KEEPER });
    if (drafted.kind !== "drafted") throw new Error("soạn nháp hỏng");

    const outcome = await service.queue({
      draftId: drafted.draft.id,
      kind: AnnouncementKind.HetHang,
      senderId: "sender-nguoi-khac",
      origin: KHO_ROOM,
      nowMs: NOW,
    });

    expect(outcome.kind).toBe("not_author");
    expect(store.heads.size).toBe(0);
  });

  test("chốt lần hai cùng mã nháp → expired, không sinh đợt thứ hai", async () => {
    const { deps, store } = buildDeps();
    const service = new AnnouncementService(deps);
    const drafted = await service.draft({ text: "Yến 100 hết.", authorSenderId: KEEPER });
    if (drafted.kind !== "drafted") throw new Error("soạn nháp hỏng");
    const args = {
      draftId: drafted.draft.id,
      kind: AnnouncementKind.HetHang,
      senderId: KEEPER,
      origin: KHO_ROOM,
      nowMs: NOW,
    };

    expect((await service.queue(args)).kind).toBe("awaiting_approval");
    expect((await service.queue(args)).kind).toBe("expired");
    expect(store.heads.size).toBe(1);
  });
});

describe("cửa duyệt", () => {
  test("người KHÁC người duyệt → forbidden, đợt vẫn nằm chờ", async () => {
    const { deps, store } = buildDeps();
    const service = new AnnouncementService(deps);
    const id = await draftAndQueue(service);

    const outcome = await service.approve({ announcementId: id, userId: "NV_KHAC", nowMs: NOW });

    expect(outcome.kind).toBe("forbidden");
    expect(store.heads.get(id)?.state).toBe(AnnouncementState.AwaitingApproval);
    expect(store.rows.every((row) => row.nextAttemptAt === undefined)).toBe(true);
  });

  test("chưa cấu hình người duyệt → KHÔNG ai duyệt được (fail-closed)", async () => {
    // Đợt tạo được ở cấu hình có người duyệt, rồi cấu hình biến mất (env bị gỡ khi deploy lại).
    const { deps, store } = buildDeps();
    const id = await draftAndQueue(new AnnouncementService(deps));

    const crippled = new AnnouncementService({ ...deps, approverUserId: undefined });
    const outcome = await crippled.approve({ announcementId: id, userId: APPROVER_USER, nowMs: NOW });

    expect(outcome.kind).toBe("forbidden");
    expect(store.heads.get(id)?.state).toBe(AnnouncementState.AwaitingApproval);
  });

  test("đúng người duyệt → mở khoá row nhận + báo về phòng kho", async () => {
    const { deps, store, broadcaster } = buildDeps();
    const service = new AnnouncementService(deps);
    const id = await draftAndQueue(service);
    broadcaster.sent.length = 0;

    const outcome = await service.approve({ announcementId: id, userId: APPROVER_USER, nowMs: NOW });

    expect(outcome).toEqual({ kind: "approved", roomCount: 2 });
    expect(store.rows.every((row) => row.nextAttemptAt !== undefined)).toBe(true);
    expect(broadcaster.sent[0]?.target.conversationId).toBe(KHO_ROOM.conversationId);
  });

  test("duyệt lần hai → not_found, không báo kết quả lần hai", async () => {
    const { deps, broadcaster } = buildDeps();
    const service = new AnnouncementService(deps);
    const id = await draftAndQueue(service);
    await service.approve({ announcementId: id, userId: APPROVER_USER, nowMs: NOW });
    broadcaster.sent.length = 0;

    const again = await service.approve({ announcementId: id, userId: APPROVER_USER, nowMs: NOW });

    expect(again.kind).toBe("not_found");
    expect(broadcaster.sent).toHaveLength(0);
  });

  test("nhóm bị /block giữa chốt và duyệt thì không được mở khoá", async () => {
    const store = new FakeStore();
    const { deps } = buildDeps({ store });
    const service = new AnnouncementService(deps);
    const id = await draftAndQueue(service);
    store.blocked.add("g2");

    const outcome = await service.approve({ announcementId: id, userId: APPROVER_USER, nowMs: NOW });

    expect(outcome).toEqual({ kind: "approved", roomCount: 1 });
    expect(store.rows.find((row) => row.groupId === "g2")?.nextAttemptAt).toBeUndefined();
  });

  test("từ chối → không nhóm nào nhận, phòng kho nhận được lý do", async () => {
    const { deps, store, broadcaster } = buildDeps();
    const service = new AnnouncementService(deps);
    const id = await draftAndQueue(service);
    broadcaster.sent.length = 0;

    const outcome = await service.reject({
      announcementId: id,
      userId: APPROVER_USER,
      reason: "sai tên sản phẩm",
    });

    expect(outcome.kind).toBe("rejected");
    expect(store.heads.get(id)?.state).toBe(AnnouncementState.Rejected);
    expect(store.rows.every((row) => row.nextAttemptAt === undefined)).toBe(true);
    expect(broadcaster.sent[0]?.text).toContain("sai tên sản phẩm");
  });

  test("người khác hỏi hàng chờ duyệt → mảng rỗng", async () => {
    const { deps } = buildDeps();
    const service = new AnnouncementService(deps);
    await draftAndQueue(service);

    expect(await service.awaiting("NV_KHAC")).toHaveLength(0);
    expect(await service.awaiting(APPROVER_USER)).toHaveLength(1);
  });
});

describe("poller gửi", () => {
  test("đã duyệt → gửi đúng một tin/nhóm, NGUYÊN VĂN, và ghi vào history nhóm", async () => {
    const { deps, store, broadcaster, history } = buildDeps();
    const service = new AnnouncementService(deps);
    const text = "Yến 100 hết hàng, 15/08 có lại.";
    const id = await draftAndQueue(service, text);
    await service.approve({ announcementId: id, userId: APPROVER_USER, nowMs: NOW });
    broadcaster.sent.length = 0;

    await tick(deps, NOW);

    expect(broadcaster.sent).toHaveLength(2);
    expect(broadcaster.sent.map((item) => item.text)).toEqual([text, text]);
    expect(broadcaster.sent.map((item) => item.target.conversationId).sort()).toEqual(["g1", "g2"]);
    expect(store.rows.every((row) => row.status === DeliveryStatus.Sent)).toBe(true);
    // History để agent đại lý trích lại được (skill het-hang Luật 2).
    expect(history.entries).toHaveLength(2);
    expect(history.entries[0]?.role).toBe("agent");
    expect(history.entries[0]?.text).toBe(text);
  });

  test("tick lần hai không gửi lại nhóm đã gửi", async () => {
    const { deps, broadcaster } = buildDeps();
    const service = new AnnouncementService(deps);
    const id = await draftAndQueue(service);
    await service.approve({ announcementId: id, userId: APPROVER_USER, nowMs: NOW });
    await tick(deps, NOW);
    broadcaster.sent.length = 0;

    await tick(deps, NOW + 600_000);

    expect(broadcaster.sent).toHaveLength(0);
  });

  test("thua CAS claim → không gửi (instance khác đang gửi)", async () => {
    const store = new FakeStore(0);
    const { deps, broadcaster } = buildDeps({ store });
    const service = new AnnouncementService(deps);
    const id = await draftAndQueue(service);
    await service.approve({ announcementId: id, userId: APPROVER_USER, nowMs: NOW });
    broadcaster.sent.length = 0;

    await tick(deps, NOW);

    expect(broadcaster.sent).toHaveLength(0);
  });

  test("một nhóm hỏng không chặn nhóm còn lại, và được thử lại sau backoff", async () => {
    const broadcaster = new FakeBroadcaster();
    broadcaster.failFor.add("g1");
    const store = new FakeStore();
    const { deps } = buildDeps({ store, broadcaster });
    const service = new AnnouncementService(deps);
    const id = await draftAndQueue(service);
    await service.approve({ announcementId: id, userId: APPROVER_USER, nowMs: NOW });
    broadcaster.sent.length = 0;

    await tick(deps, NOW);

    expect(broadcaster.sent.map((item) => item.target.conversationId)).toEqual(["g2"]);
    const failing = store.rows.find((row) => row.groupId === "g1");
    expect(failing?.status).toBe(DeliveryStatus.Pending);
    expect(failing?.lastError).toContain("bridge từ chối");
    expect(failing?.nextAttemptAt?.getTime()).toBe(backoffFrom(1, NOW).getTime());
  });

  test("hỏng đủ MAX_ATTEMPTS lần → chịu thua, thôi thử", async () => {
    const broadcaster = new FakeBroadcaster();
    broadcaster.failFor.add("g1");
    broadcaster.failFor.add("g2");
    const store = new FakeStore();
    const { deps } = buildDeps({ store, broadcaster });
    const service = new AnnouncementService(deps);
    const id = await draftAndQueue(service);
    await service.approve({ announcementId: id, userId: APPROVER_USER, nowMs: NOW });

    // Mỗi tick chạy sau mốc backoff của lần trước → lần thử kế được nhặt.
    let at = NOW;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await tick(deps, at);
      at += backoffFrom(i + 1, 0).getTime() + 1;
    }

    expect(store.rows.every((row) => row.status === DeliveryStatus.Failed)).toBe(true);
    expect(store.rows.every((row) => row.nextAttemptAt === undefined)).toBe(true);

    const status = await service.status({ senderId: KEEPER });
    expect(status?.sent).toBe(0);
    expect(status?.failed).toHaveLength(2);
  });
});

describe("soát trạng thái", () => {
  test("đợt chờ duyệt báo đúng trạng thái, không phải '0 nhóm đã nhận'", async () => {
    const { deps } = buildDeps();
    const service = new AnnouncementService(deps);
    await draftAndQueue(service);

    const status = await service.status({ senderId: KEEPER });

    expect(status?.state).toBe(AnnouncementState.AwaitingApproval);
    expect(status?.total).toBe(2);
    expect(status?.sent).toBe(0);
  });

  test("đợt bị từ chối mang theo lý do", async () => {
    const { deps } = buildDeps();
    const service = new AnnouncementService(deps);
    const id = await draftAndQueue(service);
    await service.reject({ announcementId: id, userId: APPROVER_USER, reason: "chưa rõ ngày về" });

    const status = await service.status({ senderId: KEEPER, announcementId: id });

    expect(status?.state).toBe(AnnouncementState.Rejected);
    expect(status?.rejectReason).toBe("chưa rõ ngày về");
  });
});
