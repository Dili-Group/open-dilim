// Test tầng workflows: mốc nhắc (giờ VN), mở việc → envelope hỏi, chống hỏi trùng, đóng việc →
// báo về nhóm đã hỏi, hàng rào nhóm, nhắc lại + hết hạn. Store/broker/history/dedupe đều giả —
// không DB, không Redis.

import { describe, expect, test } from "bun:test";
import { PendingStatus } from "../db/schema.ts";
import type { BroadcastTarget } from "../broadcast/types.ts";
import type { Envelope, HistoryEntry } from "../types/index.ts";
import { answerRequest, askMsgId, openRequest } from "./engine.ts";
import { tick } from "./poller.ts";
import { WorkflowRegistry } from "./registry.ts";
import { nextRemindAt, shiftIntoOfficeHours } from "./schedule.ts";
import { buildAskOriginOrderWorkflow, ASK_ORIGIN_ORDER } from "./defs/hoi-don-goc.ts";
import type {
  ClaimRemindInput,
  OpenPendingInput,
  PendingRequest,
  PendingStore,
  ResolvePendingInput,
  RoomRef,
  WorkflowDef,
  WorkflowDeps,
} from "./types.ts";

const WAREHOUSE: RoomRef = { channel: "zalo-kho", groupId: "kho-1" };
const DEALER_ROOM: RoomRef = { channel: "zalo", groupId: "group-42" };
const OTHER_DEALER_ROOM: RoomRef = { channel: "zalo", groupId: "group-99" };
const RETURN_CODE = "VTP0093412DH";
const ORIGIN_CODE = "VTP0093412";
/** 09:00 giờ VN = 02:00 UTC — trong giờ hành chính. */
const NOW = Date.parse("2026-08-10T02:00:00Z");

// ─────────────────────────────────────────────────────────────────────────────
// Fake ports
// ─────────────────────────────────────────────────────────────────────────────

class FakeStore implements PendingStore {
  readonly rows: PendingRequest[] = [];
  readonly claims: ClaimRemindInput[] = [];
  /** Số lần claim còn được phép thắng — 0 = mô phỏng instance khác đã giành trước. */
  constructor(private claimWinsLeft = Number.POSITIVE_INFINITY) {}

  open(input: OpenPendingInput): Promise<PendingRequest | null> {
    const clash = this.rows.some(
      (row) =>
        row.status === PendingStatus.Pending &&
        row.workflow === input.workflow &&
        row.subject === input.subject,
    );
    if (clash) return Promise.resolve(null);
    const row: PendingRequest = {
      id: `p${this.rows.length + 1}`,
      workflow: input.workflow,
      subject: input.subject,
      target: input.target,
      origin: input.origin,
      requesterId: input.requesterId,
      state: input.state,
      askCount: 1,
      nextRemindAt: input.nextRemindAt,
      expiresAt: input.expiresAt,
      status: PendingStatus.Pending,
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findOpen(workflow: string, subject: string): Promise<PendingRequest | undefined> {
    return Promise.resolve(
      this.rows.find(
        (row) =>
          row.status === PendingStatus.Pending &&
          row.workflow === workflow &&
          row.subject === subject,
      ),
    );
  }

  findAnswered(workflow: string, subject: string): Promise<PendingRequest | undefined> {
    return Promise.resolve(
      this.rows.find(
        (row) =>
          row.status === PendingStatus.Approved &&
          row.workflow === workflow &&
          row.subject === subject,
      ),
    );
  }

  openForTarget(room: RoomRef): Promise<PendingRequest[]> {
    return Promise.resolve(
      this.rows.filter(
        (row) =>
          row.status === PendingStatus.Pending &&
          row.target.channel === room.channel &&
          row.target.groupId === room.groupId,
      ),
    );
  }

  openForOrigin(room: RoomRef): Promise<PendingRequest[]> {
    return Promise.resolve(
      this.rows.filter(
        (row) =>
          row.status === PendingStatus.Pending &&
          row.origin.channel === room.channel &&
          row.origin.groupId === room.groupId,
      ),
    );
  }

  dueForRemind(now: Date): Promise<PendingRequest[]> {
    return Promise.resolve(
      this.rows.filter(
        (row) =>
          row.status === PendingStatus.Pending &&
          row.nextRemindAt !== undefined &&
          row.nextRemindAt.getTime() <= now.getTime(),
      ),
    );
  }

  claimRemind(input: ClaimRemindInput): Promise<boolean> {
    this.claims.push(input);
    if (this.claimWinsLeft <= 0) return Promise.resolve(false);
    this.claimWinsLeft -= 1;
    this.replace(input.id, (row) => ({
      ...row,
      nextRemindAt: input.next,
      askCount: row.askCount + 1,
    }));
    return Promise.resolve(true);
  }

  resolve(input: ResolvePendingInput): Promise<PendingRequest | undefined> {
    const row = this.rows.find((item) => item.id === input.id);
    if (row === undefined || row.status !== PendingStatus.Pending) return Promise.resolve(undefined);
    const next: PendingRequest = {
      ...row,
      status: PendingStatus.Approved,
      answer: input.answer,
      nextRemindAt: undefined,
    };
    this.replace(input.id, () => next);
    return Promise.resolve(next);
  }

  expireDue(now: Date): Promise<number> {
    let count = 0;
    for (const row of [...this.rows]) {
      if (row.status === PendingStatus.Pending && row.expiresAt.getTime() <= now.getTime()) {
        this.replace(row.id, (item) => ({
          ...item,
          status: PendingStatus.Expired,
          nextRemindAt: undefined,
        }));
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  private replace(id: string, patch: (row: PendingRequest) => PendingRequest): void {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index >= 0) {
      const current = this.rows[index];
      if (current !== undefined) this.rows[index] = patch(current);
    }
  }
}

interface Recorder extends WorkflowDeps {
  readonly published: Envelope[];
  readonly appended: HistoryEntry[];
  readonly sent: { target: BroadcastTarget; text: string }[];
}

function fakeDeps(store: PendingStore): Recorder {
  const published: Envelope[] = [];
  const appended: HistoryEntry[] = [];
  const sent: { target: BroadcastTarget; text: string }[] = [];
  const seen = new Set<string>();
  return {
    store,
    published,
    appended,
    sent,
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
    broadcaster: {
      send: (target, text) => {
        sent.push({ target, text });
        return Promise.resolve();
      },
    },
  };
}

/** Def thật (hoi-don-goc) với hai cổng giả: tra chủ đơn + tra nhóm đại lý. */
function buildDef(options?: {
  owner?: { dealerId: string } | null;
  /** true = đại lý chưa có nhóm nào được nối. */
  roomMissing?: boolean;
  ownerError?: Error;
}): WorkflowDef {
  return buildAskOriginOrderWorkflow({
    owners: {
      ownerOf: () => {
        if (options?.ownerError !== undefined) return Promise.reject(options.ownerError);
        return Promise.resolve(options?.owner === undefined ? { dealerId: "42" } : options.owner);
      },
    },
    rooms: {
      roomOf: () => Promise.resolve(options?.roomMissing === true ? undefined : DEALER_ROOM),
    },
  });
}

function openInput(): Parameters<typeof openRequest>[2] {
  return { subject: RETURN_CODE, origin: WAREHOUSE, requesterId: "kho-nv-1", nowMs: NOW };
}

// ─────────────────────────────────────────────────────────────────────────────
// schedule
// ─────────────────────────────────────────────────────────────────────────────

describe("giờ hành chính", () => {
  test("trước 8h sáng VN → dời tới 8h cùng ngày", () => {
    // 03:00 giờ VN = 20:00 UTC hôm trước.
    const early = Date.parse("2026-08-09T20:00:00Z");
    expect(shiftIntoOfficeHours(early)).toBe(Date.parse("2026-08-10T01:00:00Z"));
  });

  test("từ 18h VN trở đi → dời tới 8h hôm sau", () => {
    // 19:00 giờ VN = 12:00 UTC cùng ngày.
    const late = Date.parse("2026-08-10T12:00:00Z");
    expect(shiftIntoOfficeHours(late)).toBe(Date.parse("2026-08-11T01:00:00Z"));
  });

  test("trong giờ hành chính → giữ nguyên", () => {
    expect(shiftIntoOfficeHours(NOW)).toBe(NOW);
  });

  test("mốc nhắc của def đơn hoàn rơi vào giờ hành chính", () => {
    const def = buildDef();
    // 09:00 + 8h = 17:00 VN, vẫn trong giờ → giữ nguyên.
    expect(nextRemindAt(def, NOW)?.getTime()).toBe(NOW + 8 * 3_600_000);
    // 14:00 VN + 8h = 22:00 → dời sang 8h hôm sau.
    const afternoon = Date.parse("2026-08-10T07:00:00Z");
    expect(nextRemindAt(def, afternoon)?.getTime()).toBe(Date.parse("2026-08-11T01:00:00Z"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Khoá + đáp án hợp lệ (def)
// ─────────────────────────────────────────────────────────────────────────────

describe("chuẩn hoá mã của def hoi-don-goc", () => {
  const def = buildDef();

  test("mã hoàn chuẩn hoá về HOA, bỏ khoảng trắng/gạch", () => {
    expect(def.normalizeSubject(" vtp 009-3412 dh ")).toBe(RETURN_CODE);
  });

  test("mã không có đuôi DH KHÔNG phải việc của nghiệp vụ này", () => {
    expect(def.normalizeSubject(ORIGIN_CODE)).toBeUndefined();
  });

  test("đáp án là mã hoàn (đuôi DH) bị từ chối — đại lý đang trả lời nhầm thứ", () => {
    expect(def.normalizeAnswer(RETURN_CODE)).toBeUndefined();
  });

  test("đáp án quá ngắn bị từ chối", () => {
    expect(def.normalizeAnswer("ok")).toBeUndefined();
  });

  test("đáp án hợp lệ được chuẩn hoá", () => {
    expect(def.normalizeAnswer("vtp0093412")).toBe(ORIGIN_CODE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mở việc
// ─────────────────────────────────────────────────────────────────────────────

describe("mở việc", () => {
  test("đẩy lượt hỏi vào ĐÚNG nhóm đại lý, ghi history trước khi publish", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    const outcome = await openRequest(deps, buildDef(), openInput());

    expect(outcome.kind).toBe("asked");
    expect(store.rows).toHaveLength(1);

    const envelope = deps.published[0];
    expect(envelope?.channel).toBe(DEALER_ROOM.channel);
    expect(envelope?.conversationId).toBe(DEALER_ROOM.groupId);
    expect(envelope?.addressedToAgent).toBe(true);
    // Mã phải xuất hiện NGUYÊN VĂN trong chỉ thị, nếu không agent hỏi sai mã.
    expect(envelope?.text).toContain(RETURN_CODE);
    expect(deps.appended[0]?.msgId).toBe(envelope?.msgId);
    expect(deps.appended[0]?.role).toBe("user");
  });

  test("gõ lại mã đang chờ → KHÔNG hỏi đại lý lần hai", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    await openRequest(deps, buildDef(), openInput());
    const again = await openRequest(deps, buildDef(), openInput());

    expect(again.kind).toBe("already_open");
    expect(deps.published).toHaveLength(1);
  });

  test("mã đã có đáp án → trả luôn, không phiền đại lý", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    const def = buildDef();
    await openRequest(deps, def, openInput());
    await answerRequest(deps, def, {
      subject: RETURN_CODE,
      answer: ORIGIN_CODE,
      targetRoom: DEALER_ROOM,
      answeredBy: "dl-1",
      nowMs: NOW,
    });

    const again = await openRequest(deps, def, { ...openInput(), nowMs: NOW + 1000 });
    expect(again.kind).toBe("already_answered");
    expect(deps.published).toHaveLength(1);
  });

  test("mã không phải loại DH → invalid_subject, không đụng hệ vận hành", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    const outcome = await openRequest(deps, buildDef(), { ...openInput(), subject: ORIGIN_CODE });

    expect(outcome.kind).toBe("invalid_subject");
    expect(store.rows).toHaveLength(0);
  });

  test("hệ vận hành không có đơn → unknown_subject (không mở việc)", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    const outcome = await openRequest(deps, buildDef({ owner: null }), openInput());

    expect(outcome.kind).toBe("unknown_subject");
    expect(store.rows).toHaveLength(0);
  });

  test("đại lý chưa có nhóm → no_room, không mở việc", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    const outcome = await openRequest(deps, buildDef({ roomMissing: true }), openInput());

    expect(outcome.kind).toBe("no_room");
    expect(store.rows).toHaveLength(0);
  });

  test("gọi hệ vận hành hỏng → failed (thử lại được), KHÔNG mở việc", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    const outcome = await openRequest(
      deps,
      buildDef({ ownerError: new Error("502 bad gateway") }),
      openInput(),
    );

    expect(outcome.kind).toBe("failed");
    expect(store.rows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Trả lời việc
// ─────────────────────────────────────────────────────────────────────────────

describe("trả lời việc", () => {
  test("đóng việc + báo kết quả về ĐÚNG nhóm kho", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    const def = buildDef();
    await openRequest(deps, def, openInput());

    const outcome = await answerRequest(deps, def, {
      subject: RETURN_CODE,
      answer: " vtp0093412 ",
      targetRoom: DEALER_ROOM,
      answeredBy: "dl-1",
      nowMs: NOW,
    });

    expect(outcome.kind).toBe("recorded");
    const sent = deps.sent[0];
    expect(sent?.target.channel).toBe(WAREHOUSE.channel);
    expect(sent?.target.conversationId).toBe(WAREHOUSE.groupId);
    expect(sent?.target.replyToSenderId).toBe("kho-nv-1");
    expect(sent?.text).toContain(ORIGIN_CODE);
    expect(store.rows[0]?.status).toBe(PendingStatus.Approved);
  });

  test("nhóm đại lý KHÁC không đóng được việc của nhóm này", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    const def = buildDef();
    await openRequest(deps, def, openInput());

    const outcome = await answerRequest(deps, def, {
      subject: RETURN_CODE,
      answer: ORIGIN_CODE,
      targetRoom: OTHER_DEALER_ROOM,
      answeredBy: "ke-cap",
      nowMs: NOW,
    });

    expect(outcome.kind).toBe("not_found");
    // Không rò mã của nhóm khác vào danh sách gợi ý.
    if (outcome.kind === "not_found") expect(outcome.openSubjects).toEqual([]);
    expect(deps.sent).toHaveLength(0);
    expect(store.rows[0]?.status).toBe(PendingStatus.Pending);
  });

  test("đáp án không hợp lệ → việc VẪN treo, không báo về kho", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    const def = buildDef();
    await openRequest(deps, def, openInput());

    const outcome = await answerRequest(deps, def, {
      subject: RETURN_CODE,
      answer: RETURN_CODE, // trả lại chính mã hoàn
      targetRoom: DEALER_ROOM,
      answeredBy: "dl-1",
      nowMs: NOW,
    });

    expect(outcome.kind).toBe("invalid_answer");
    expect(deps.sent).toHaveLength(0);
    expect(store.rows[0]?.status).toBe(PendingStatus.Pending);
  });

  test("trả lời lần hai → closed, KHÔNG báo về kho lần hai", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    const def = buildDef();
    await openRequest(deps, def, openInput());
    const answer = {
      subject: RETURN_CODE,
      answer: ORIGIN_CODE,
      targetRoom: DEALER_ROOM,
      answeredBy: "dl-1",
      nowMs: NOW,
    };
    await answerRequest(deps, def, answer);
    const again = await answerRequest(deps, def, answer);

    // Việc đã đóng nên không còn "open" nào mang mã đó → not_found, và tuyệt đối không gửi lại.
    expect(again.kind).toBe("not_found");
    expect(deps.sent).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Poller: nhắc lại + hết hạn
// ─────────────────────────────────────────────────────────────────────────────

describe("poller", () => {
  function registryWith(def: WorkflowDef): WorkflowRegistry {
    return new WorkflowRegistry().register(def);
  }

  test("tới hạn nhắc → đẩy lượt hỏi mới với msgId khác lần trước", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    const def = buildDef();
    await openRequest(deps, def, openInput());
    const firstId = deps.published[0]?.msgId;

    // Sang mốc nhắc (8h sau, vẫn trong giờ hành chính).
    await tick(deps, registryWith(def), NOW + 8 * 3_600_000);

    expect(deps.published).toHaveLength(2);
    expect(deps.published[1]?.msgId).not.toBe(firstId);
    expect(deps.published[1]?.msgId).toBe(askMsgId("p1", 2));
    expect(deps.published[1]?.text).toContain(RETURN_CODE);
  });

  test("thua CAS (instance khác đang nhắc) → không đẩy lượt nào", async () => {
    const store = new FakeStore(1); // chỉ đủ thắng cho lần claim của chính openRequest
    const deps = fakeDeps(store);
    const def = buildDef();
    await openRequest(deps, def, openInput());
    // Tiêu nốt quota thắng để lần claim của poller thua.
    await store.claimRemind({ id: "p1", expected: new Date(NOW), next: new Date(NOW) });

    await tick(deps, registryWith(def), NOW + 8 * 3_600_000);
    expect(deps.published).toHaveLength(1);
  });

  test("quá hạn → đóng im lặng, KHÔNG nhắc thêm và KHÔNG báo ai", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    const def = buildDef();
    await openRequest(deps, def, openInput());

    // Quá 2 ngày.
    await tick(deps, registryWith(def), NOW + 3 * 24 * 3_600_000);

    expect(store.rows[0]?.status).toBe(PendingStatus.Expired);
    expect(deps.published).toHaveLength(1);
    expect(deps.sent).toHaveLength(0);
  });

  test("workflow lạ (def bị gỡ) → bỏ nhắc, không giết tick", async () => {
    const store = new FakeStore();
    const deps = fakeDeps(store);
    await openRequest(deps, buildDef(), openInput());

    await tick(deps, new WorkflowRegistry(), NOW + 8 * 3_600_000);
    expect(deps.published).toHaveLength(1);
  });

  test("slug của def đơn hoàn không đổi (đổi = mồ côi việc đang treo)", () => {
    expect(buildDef().name).toBe(ASK_ORIGIN_ORDER);
    expect(ASK_ORIGIN_ORDER).toBe("hoi-don-goc");
  });
});
