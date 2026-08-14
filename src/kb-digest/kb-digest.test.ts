// Test tầng kb-digest: mốc giờ VN, parser output model, store SQL shape, pipeline service,
// poller due-time, cửa duyệt + flash command. Toàn fake port — không network/DB/config runtime.

import { describe, expect, test } from "bun:test";
import { EMPTY_USAGE, type ChatRequest, type ChatResult, type LLMProvider } from "../llm/types.ts";
import type { Broadcaster, BroadcastTarget } from "../broadcast/types.ts";
import { KbDigestRunStatus, KbProposalStatus } from "../db/schema.ts";
import type {
  DistilledFact,
  MemoryScope,
  MemoryStore,
  RecalledFact,
  SqlExecutor,
} from "../state/types.ts";
import { ORG_KB_SCOPE } from "../state/types.ts";
import { ActorRole, type FlashContext, type IdentityRepo, type JobAdmin, type OpsPort } from "../flash-command/types.ts";
import { duyetKb, kiemduyetKb } from "../flash-command/commands/kiemduyet-kb.ts";
import {
  KbDigestExtractor,
  parseExtraction,
  renderDayTranscript,
  TRANSCRIPT_MAX_CHARS,
} from "./extractor.ts";
import { SqlKbDigestStore } from "./store.ts";
import { KbDigestService, KbReviewService, renderDigest } from "./service.ts";
import { tick } from "./poller.ts";
import { parseRunTime, vnDateOf, vnDayBounds, vnMinutesOfDay } from "./time.ts";
import type {
  KbDigestExtraction,
  KbDigestStore,
  KbLoggedMessage,
  KbReviewConfig,
} from "./types.ts";

// ─── fakes ──────────────────────────────────────────────────────────────────

class FakeExec implements SqlExecutor {
  readonly calls: { text: string; params: readonly unknown[] }[] = [];
  constructor(private readonly responder: (text: string) => unknown = () => []) {}
  query(text: string, params: readonly unknown[]): Promise<unknown> {
    this.calls.push({ text, params });
    return Promise.resolve(this.responder(text));
  }
}

class ScriptedProvider implements LLMProvider {
  readonly name = "scripted";
  constructor(private readonly reply: ChatResult | Error) {}
  chat(_req: ChatRequest): Promise<ChatResult> {
    if (this.reply instanceof Error) return Promise.reject(this.reply);
    return Promise.resolve(this.reply);
  }
}

function textResult(text: string): ChatResult {
  return { content: [{ type: "text", text }], stopReason: "end_turn", usage: EMPTY_USAGE };
}

class CapturingBroadcaster implements Broadcaster {
  readonly sent: Array<{ target: BroadcastTarget; text: string }> = [];
  send(target: BroadcastTarget, text: string): Promise<void> {
    this.sent.push({ target, text });
    return Promise.resolve();
  }
  sendMedia(): Promise<void> {
    return Promise.resolve();
  }
}

class ThrowingBroadcaster implements Broadcaster {
  send(): Promise<void> {
    return Promise.reject(new Error("bridge chết"));
  }
  sendMedia(): Promise<void> {
    return Promise.reject(new Error("bridge chết"));
  }
}

const CONFIG: KbReviewConfig = {
  channel: "van-hanh",
  conversationId: "review-group",
  runTime: "18:00",
  enabled: true,
};

function msg(senderId: string, text: string, ts = 1_755_100_000_000): KbLoggedMessage {
  return { senderId, text, ts };
}

/** Store giả in-memory: đủ hành vi claim/insert/decide cho test service + poller. */
class FakeStore implements KbDigestStore {
  config: KbReviewConfig | undefined = CONFIG;
  groups: string[] = [];
  messages = new Map<string, KbLoggedMessage[]>();
  readonly claims = new Set<string>();
  readonly finished: Array<{ conversationId: string; status: number }> = [];
  readonly proposals: Array<{ id: string; factText: string; status: number; decidedBy?: string }> = [];
  private nextId = 0;

  getConfig(): Promise<KbReviewConfig | undefined> {
    return Promise.resolve(this.config);
  }
  upsertConfig(p: { channel: string; conversationId: string; runTime: string; createdBy: string }): Promise<void> {
    this.config = { channel: p.channel, conversationId: p.conversationId, runTime: p.runTime, enabled: true };
    return Promise.resolve();
  }
  staffActiveGroups(): Promise<string[]> {
    return Promise.resolve([...this.groups]);
  }
  messagesForDay(p: { conversationId: string }): Promise<KbLoggedMessage[]> {
    return Promise.resolve(this.messages.get(p.conversationId) ?? [msg("u1", "tin mặc định")]);
  }
  claimRun(day: string, conversationId: string): Promise<boolean> {
    const key = `${day}:${conversationId}`;
    if (this.claims.has(key)) return Promise.resolve(false);
    this.claims.add(key);
    return Promise.resolve(true);
  }
  finishRun(_day: string, conversationId: string, status: number): Promise<void> {
    this.finished.push({ conversationId, status });
    return Promise.resolve();
  }
  insertProposals(p: { facts: readonly string[] }): Promise<string[]> {
    return Promise.resolve(
      p.facts.map((factText) => {
        const id = `00000000-0000-0000-0000-${String(this.nextId++).padStart(12, "0")}`;
        this.proposals.push({ id, factText, status: KbProposalStatus.Pending });
        return id;
      }),
    );
  }
  listPending(): Promise<{ id: string; day: string; factText: string; createdAt: Date }[]> {
    return Promise.resolve(
      this.proposals
        .filter((p) => p.status === KbProposalStatus.Pending)
        .map((p) => ({ id: p.id, day: "2026-08-14", factText: p.factText, createdAt: new Date(0) })),
    );
  }
  findPendingByShortId(
    shortId: string,
  ): Promise<{ kind: "found"; id: string; factText: string } | { kind: "not_found" } | { kind: "ambiguous" }> {
    const hits = this.proposals.filter(
      (p) => p.status === KbProposalStatus.Pending && p.id.startsWith(shortId),
    );
    if (hits.length === 0) return Promise.resolve({ kind: "not_found" });
    if (hits.length > 1) return Promise.resolve({ kind: "ambiguous" });
    const hit = hits[0];
    if (hit === undefined) return Promise.resolve({ kind: "not_found" });
    return Promise.resolve({ kind: "found", id: hit.id, factText: hit.factText });
  }
  decide(id: string, status: number, decidedBy: string): Promise<boolean> {
    const row = this.proposals.find((p) => p.id === id && p.status === KbProposalStatus.Pending);
    if (row === undefined) return Promise.resolve(false);
    row.status = status;
    row.decidedBy = decidedBy;
    return Promise.resolve(true);
  }
}

const EXTRACTION: KbDigestExtraction = {
  vanDe: ["giao trễ khu X"],
  giaiPhap: ["nhân viên đã hẹn lại lịch"],
  kb: ["Một số đại lý phản ánh SLA giao khu X thường trễ 1 ngày"],
};

function fakeExtractor(result: KbDigestExtraction | undefined | Error) {
  return {
    calls: 0,
    extract(this: { calls: number }): Promise<KbDigestExtraction | undefined> {
      this.calls += 1;
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    },
  };
}

class RecordingMemory implements MemoryStore {
  readonly writes: Array<{ scope: MemoryScope; facts: readonly DistilledFact[]; sourceMsgId?: string }> = [];
  write(scope: MemoryScope, facts: readonly DistilledFact[], sourceMsgId?: string): Promise<number> {
    this.writes.push({ scope, facts, ...(sourceMsgId === undefined ? {} : { sourceMsgId }) });
    return Promise.resolve(facts.length);
  }
  recall(): Promise<RecalledFact[]> {
    return Promise.resolve([]);
  }
  prime(): Promise<RecalledFact[]> {
    return Promise.resolve([]);
  }
}

// ─── time ───────────────────────────────────────────────────────────────────

describe("kb-digest time (giờ VN)", () => {
  test("vnDateOf: 23h VN vẫn là hôm đó, 0h30 VN là hôm sau (server UTC không lệch)", () => {
    // 2026-08-14T16:30Z = 23:30 VN ngày 14; 2026-08-14T17:30Z = 00:30 VN ngày 15.
    expect(vnDateOf(Date.parse("2026-08-14T16:30:00Z"))).toBe("2026-08-14");
    expect(vnDateOf(Date.parse("2026-08-14T17:30:00Z"))).toBe("2026-08-15");
  });

  test("vnDayBounds: [00:00, 24:00) giờ VN", () => {
    const { startMs, endMs } = vnDayBounds("2026-08-14");
    expect(startMs).toBe(Date.parse("2026-08-13T17:00:00Z"));
    expect(endMs - startMs).toBe(24 * 60 * 60 * 1000);
  });

  test("vnMinutesOfDay + parseRunTime khớp đơn vị", () => {
    const at1830 = Date.parse("2026-08-14T11:30:00Z"); // 18:30 VN
    expect(vnMinutesOfDay(at1830)).toBe(18 * 60 + 30);
    expect(parseRunTime("18:00")).toBe(18 * 60);
    expect(parseRunTime("18h30")).toBe(18 * 60 + 30);
    expect(parseRunTime("7")).toBe(7 * 60);
    expect(parseRunTime("25:00")).toBeUndefined();
    expect(parseRunTime("xx")).toBeUndefined();
  });
});

// ─── extractor ──────────────────────────────────────────────────────────────

describe("parseExtraction", () => {
  test("JSON sạch", () => {
    const out = parseExtraction('{"van_de":["a"],"giai_phap":["b"],"kb":["c"]}');
    expect(out).toEqual({ vanDe: ["a"], giaiPhap: ["b"], kb: ["c"] });
  });

  test("model bọc văn xuôi quanh JSON vẫn rút được", () => {
    const out = parseExtraction('Kết quả đây:\n{"van_de":[],"giai_phap":[],"kb":["x"]}\nHết.');
    expect(out?.kb).toEqual(["x"]);
  });

  test("mảng thiếu → rỗng; phần tử không phải string / rỗng → bỏ", () => {
    const out = parseExtraction('{"kb":["ok", 5, "", "  "]}');
    expect(out).toEqual({ vanDe: [], giaiPhap: [], kb: ["ok"] });
  });

  test("JSON vỡ / không phải object → undefined (khác extraction rỗng)", () => {
    expect(parseExtraction("xin lỗi tôi chịu")).toBeUndefined();
    expect(parseExtraction('{"van_de": [cụt')).toBeUndefined();
    expect(parseExtraction('["mảng trần"]')).toBeUndefined();
  });
});

describe("renderDayTranscript", () => {
  test("quá trần → cắt GIỮ ĐUÔI, có marker", () => {
    const messages = Array.from({ length: 2000 }, (_, i) => msg("u1", `tin số ${i} ${"x".repeat(20)}`));
    const out = renderDayTranscript(messages);
    expect(out.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CHARS + 50);
    expect(out.startsWith("(… đã cắt phần đầu ngày …)")).toBe(true);
    expect(out).toContain("tin số 1999"); // đuôi (cuối ngày) phải còn
    expect(out).not.toContain("tin số 0 "); // đầu ngày hy sinh
  });

  test("senderName ưu tiên hơn senderId", () => {
    const out = renderDayTranscript([{ senderId: "u1", senderName: "Chị Lan", text: "hàng về chưa", ts: 0 }]);
    expect(out).toContain("Chị Lan: hàng về chưa");
  });
});

describe("KbDigestExtractor", () => {
  test("model hỏng → undefined, không throw", async () => {
    const extractor = new KbDigestExtractor(new ScriptedProvider(new Error("model chết")));
    expect(await extractor.extract([msg("u1", "hi")])).toBeUndefined();
  });

  test("không có tin → rỗng, không tốn call", async () => {
    const extractor = new KbDigestExtractor(new ScriptedProvider(new Error("không được gọi")));
    expect(await extractor.extract([])).toEqual({ vanDe: [], giaiPhap: [], kb: [] });
  });

  test("đường vui: chat → parse", async () => {
    const extractor = new KbDigestExtractor(
      new ScriptedProvider(textResult('{"van_de":["v"],"giai_phap":[],"kb":[]}')),
    );
    expect((await extractor.extract([msg("u1", "hi")]))?.vanDe).toEqual(["v"]);
  });
});

// ─── store (SQL shape qua FakeExec) ─────────────────────────────────────────

describe("SqlKbDigestStore", () => {
  test("staffActiveGroups: JOIN user_binding active + đúng thứ tự param", async () => {
    const exec = new FakeExec(() => [{ conversation_id: "g1" }]);
    const store = new SqlKbDigestStore(exec);
    const groups = await store.staffActiveGroups({
      channel: "zalo",
      startMs: 100,
      endMs: 200,
      excludeConversationId: "review-group",
    });
    expect(groups).toEqual(["g1"]);
    const call = exec.calls[0];
    expect(call?.text).toContain("JOIN user_binding");
    expect(call?.text).toContain("revoked_at IS NULL");
    expect(call?.params).toEqual(["zalo", 100, 200, "review-group"]);
  });

  test("claimRun: ON CONFLICT DO NOTHING — có RETURNING = giành được, rỗng = thua", async () => {
    const winner = new SqlKbDigestStore(new FakeExec(() => [{ conversation_id: "g1" }]));
    expect(await winner.claimRun("2026-08-14", "g1")).toBe(true);
    const loser = new SqlKbDigestStore(new FakeExec(() => []));
    expect(await loser.claimRun("2026-08-14", "g1")).toBe(false);
  });

  test("findPendingByShortId: 2 hit → ambiguous, 0 hit → not_found", async () => {
    const two = new SqlKbDigestStore(new FakeExec(() => [{ id: "a", fact_text: "x" }, { id: "b", fact_text: "y" }]));
    expect((await two.findPendingByShortId("abc")).kind).toBe("ambiguous");
    const zero = new SqlKbDigestStore(new FakeExec(() => []));
    expect((await zero.findPendingByShortId("abc")).kind).toBe("not_found");
  });

  test("decide: chỉ UPDATE row còn pending (WHERE status = pending)", async () => {
    const exec = new FakeExec(() => [{ id: "a" }]);
    const store = new SqlKbDigestStore(exec);
    expect(await store.decide("a", KbProposalStatus.Approved, "nv1")).toBe(true);
    expect(exec.calls[0]?.params).toEqual(["a", KbProposalStatus.Approved, "nv1", KbProposalStatus.Pending]);
  });
});

// ─── service ────────────────────────────────────────────────────────────────

describe("KbDigestService.runDay", () => {
  test("đường vui: claim → extract → lưu đề xuất → MỘT digest/group về group kiểm duyệt", async () => {
    const store = new FakeStore();
    store.groups = ["g1", "g2"];
    const broadcaster = new CapturingBroadcaster();
    const service = new KbDigestService({ store, extractor: fakeExtractor(EXTRACTION), broadcaster });

    await service.runDay("2026-08-14");

    expect(broadcaster.sent).toHaveLength(2);
    expect(broadcaster.sent[0]?.target).toMatchObject({
      channel: "van-hanh",
      conversationId: "review-group",
      isGroup: true,
    });
    expect(broadcaster.sent[0]?.text).toContain("Đề xuất ghi knowledge base");
    expect(store.proposals).toHaveLength(2);
    expect(store.finished.every((f) => f.status === KbDigestRunStatus.Done)).toBe(true);
  });

  test("group đã claim (ngày đã chạy) → bỏ qua, không extract lại", async () => {
    const store = new FakeStore();
    store.groups = ["g1"];
    store.claims.add("2026-08-14:g1");
    const extractor = fakeExtractor(EXTRACTION);
    const service = new KbDigestService({ store, extractor, broadcaster: new CapturingBroadcaster() });

    await service.runDay("2026-08-14");

    expect(extractor.calls).toBe(0);
    expect(store.finished).toHaveLength(0);
  });

  test("extraction rỗng → không gửi digest rác, lượt vẫn Done", async () => {
    const store = new FakeStore();
    store.groups = ["g1"];
    const broadcaster = new CapturingBroadcaster();
    const service = new KbDigestService({
      store,
      extractor: fakeExtractor({ vanDe: [], giaiPhap: [], kb: [] }),
      broadcaster,
    });

    await service.runDay("2026-08-14");

    expect(broadcaster.sent).toHaveLength(0);
    expect(store.finished).toEqual([{ conversationId: "g1", status: KbDigestRunStatus.Done }]);
  });

  test("extractor trả undefined (model hỏng) → lượt Failed, không phải Done giả", async () => {
    const store = new FakeStore();
    store.groups = ["g1"];
    const service = new KbDigestService({
      store,
      extractor: fakeExtractor(undefined),
      broadcaster: new CapturingBroadcaster(),
    });

    await service.runDay("2026-08-14");

    expect(store.finished).toEqual([{ conversationId: "g1", status: KbDigestRunStatus.Failed }]);
  });

  test("gửi digest fail → Failed TERMINAL, group sau vẫn chạy (cô lập lỗi)", async () => {
    const store = new FakeStore();
    store.groups = ["g1", "g2"];
    const service = new KbDigestService({
      store,
      extractor: fakeExtractor(EXTRACTION),
      broadcaster: new ThrowingBroadcaster(),
    });

    await service.runDay("2026-08-14");

    expect(store.finished).toEqual([
      { conversationId: "g1", status: KbDigestRunStatus.Failed },
      { conversationId: "g2", status: KbDigestRunStatus.Failed },
    ]);
  });

  test("chưa bind config → không làm gì", async () => {
    const store = new FakeStore();
    store.config = undefined;
    store.groups = ["g1"];
    const extractor = fakeExtractor(EXTRACTION);
    await new KbDigestService({ store, extractor, broadcaster: new CapturingBroadcaster() }).runDay("2026-08-14");
    expect(extractor.calls).toBe(0);
  });
});

describe("renderDigest", () => {
  test("đề xuất KB kèm mã ngắn 8 ký tự + hint lệnh duyệt", () => {
    const text = renderDigest("2026-08-14", "g1", EXTRACTION, ["abcdef12-3456-7890-abcd-ef1234567890"]);
    expect(text).toContain("[abcdef12]");
    expect(text).toContain("/duyet-kb");
    expect(text).toContain("giao trễ khu X");
  });
});

// ─── poller ─────────────────────────────────────────────────────────────────

describe("kb-digest poller tick", () => {
  function serviceSpy(store: FakeStore): { service: KbDigestService; ranDays: string[] } {
    const ranDays: string[] = [];
    const service = new KbDigestService({
      store,
      extractor: fakeExtractor(EXTRACTION),
      broadcaster: new CapturingBroadcaster(),
    });
    const original = service.runDay.bind(service);
    service.runDay = (day: string) => {
      ranDays.push(day);
      return original(day);
    };
    return { service, ranDays };
  }

  test("chưa tới giờ VN → không chạy; qua giờ → chạy đúng ngày VN", async () => {
    const store = new FakeStore(); // runTime 18:00
    const { service, ranDays } = serviceSpy(store);

    await tick(store, service, Date.parse("2026-08-14T10:00:00Z")); // 17:00 VN
    expect(ranDays).toEqual([]);

    await tick(store, service, Date.parse("2026-08-14T11:30:00Z")); // 18:30 VN
    expect(ranDays).toEqual(["2026-08-14"]);
  });

  test("run_time rác trong DB → coi như chưa tới giờ, không nổ", async () => {
    const store = new FakeStore();
    store.config = { ...CONFIG, runTime: "gà" };
    const { service, ranDays } = serviceSpy(store);
    await tick(store, service, Date.parse("2026-08-14T15:00:00Z"));
    expect(ranDays).toEqual([]);
  });
});

// ─── duyệt ──────────────────────────────────────────────────────────────────

describe("KbReviewService", () => {
  async function pendingStore(): Promise<FakeStore> {
    const store = new FakeStore();
    await store.insertProposals({ facts: ["fact A"] });
    return store;
  }

  test("approve: ghi memory đúng ORG_KB_SCOPE + sourceMsgId theo id đề xuất, rồi mới đánh dấu", async () => {
    const store = await pendingStore();
    const memory = new RecordingMemory();
    const service = new KbReviewService({ store, memory });

    const outcome = await service.approve({ shortId: "00000000", decidedBy: "nv1" });

    expect(outcome).toEqual({ kind: "approved", written: true });
    expect(memory.writes[0]?.scope).toEqual(ORG_KB_SCOPE);
    expect(memory.writes[0]?.facts[0]?.text).toBe("fact A");
    expect(memory.writes[0]?.sourceMsgId).toBe(`kb-proposal:${store.proposals[0]?.id}`);
    expect(store.proposals[0]?.status).toBe(KbProposalStatus.Approved);
  });

  test("thiếu memory store (không embedder) → no_memory, đề xuất VẪN pending", async () => {
    const store = await pendingStore();
    const outcome = await new KbReviewService({ store }).approve({ shortId: "00000000", decidedBy: "nv1" });
    expect(outcome).toEqual({ kind: "no_memory" });
    expect(store.proposals[0]?.status).toBe(KbProposalStatus.Pending);
  });

  test("reject: đánh dấu rejected, KHÔNG chạm memory", async () => {
    const store = await pendingStore();
    const outcome = await new KbReviewService({ store }).reject({ shortId: "00000000", decidedBy: "nv1" });
    expect(outcome).toEqual({ kind: "rejected" });
    expect(store.proposals[0]?.status).toBe(KbProposalStatus.Rejected);
  });
});

// ─── flash command ──────────────────────────────────────────────────────────

const NOOP_REPO: IdentityRepo = {
  bindUser: () => Promise.resolve(),
  isBoundUser: () => Promise.resolve(false),
  getOpToken: () => Promise.resolve(null),
  upsertGroupMap: () => Promise.resolve(),
  assignDealer: () => Promise.resolve(),
  revokeDealer: () => Promise.resolve(),
  blockGroup: () => Promise.resolve(),
  unblockGroup: () => Promise.resolve(),
  isGroupBlocked: () => Promise.resolve(false),
};
const NOOP_OPS: OpsPort = {
  resolveUserByToken: () => Promise.resolve(null),
  fetchDealerInfo: () => Promise.resolve(null),
};
const NOOP_JOBS: JobAdmin = {
  create: () => Promise.resolve(),
  listByTarget: () => Promise.resolve([]),
  update: () => Promise.resolve(false),
  setEnabled: () => Promise.resolve(false),
  remove: () => Promise.resolve(false),
};

function flashCtx(over: Partial<FlashContext> = {}): FlashContext {
  return {
    identity: { role: ActorRole.NhanVien, senderId: "s1", userId: "nv1" },
    channel: "van-hanh",
    groupId: "review-group",
    conversationId: "review-group",
    args: [],
    mentions: [],
    repo: NOOP_REPO,
    ops: NOOP_OPS,
    jobs: NOOP_JOBS,
    agentType: "operations",
    ...over,
  };
}

describe("flash /kiemduyet-kb + /duyet-kb", () => {
  test("/kiemduyet-kb bind group đang đứng + giờ chuẩn hoá HH:MM", async () => {
    const store = new FakeStore();
    store.config = undefined;
    const kb = new KbReviewService({ store });
    const result = await kiemduyetKb.handler(flashCtx({ kb, args: ["19h30"] }));

    expect(result.ok).toBe(true);
    expect(store.config).toMatchObject({ channel: "van-hanh", conversationId: "review-group", runTime: "19:30" });
  });

  test("/kiemduyet-kb ở chat riêng → từ chối rõ", async () => {
    const kb = new KbReviewService({ store: new FakeStore() });
    const result = await kiemduyetKb.handler(flashCtx({ kb, groupId: undefined }));
    expect(result.ok).toBe(false);
  });

  test("/duyet-kb ngoài group kiểm duyệt → chặn (đề xuất không lộ ra nhóm đại lý)", async () => {
    const store = await (async () => {
      const s = new FakeStore();
      await s.insertProposals({ facts: ["f"] });
      return s;
    })();
    const kb = new KbReviewService({ store, memory: new RecordingMemory() });
    const result = await duyetKb.handler(
      flashCtx({ kb, conversationId: "nhom-dai-ly", groupId: "nhom-dai-ly", args: ["00000000"] }),
    );
    expect(result.ok).toBe(false);
    expect(store.proposals[0]?.status).toBe(KbProposalStatus.Pending);
  });

  test("/duyet-kb trong group kiểm duyệt → duyệt + ghi KB", async () => {
    const store = new FakeStore();
    await store.insertProposals({ facts: ["f"] });
    const memory = new RecordingMemory();
    const kb = new KbReviewService({ store, memory });
    const result = await duyetKb.handler(flashCtx({ kb, args: ["00000000"] }));

    expect(result.ok).toBe(true);
    expect(memory.writes).toHaveLength(1);
  });

  test("không có port kb → fail-closed", async () => {
    const result = await duyetKb.handler(flashCtx({ args: ["00000000"] }));
    expect(result.ok).toBe(false);
    expect(result.reply).toContain("chưa sẵn sàng");
  });
});
