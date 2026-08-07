// Test worker: MemoryBroker consume, order-lock theo phòng, handleEnvelope end-to-end.
// Provider/identity/broadcaster đều giả — không network, không DB, không config runtime.

import { describe, expect, test } from "bun:test";
import type { ChatRequest, ChatResult, LLMProvider } from "../llm/types.ts";
import type { Identity, IdentityRepo, OpsPort } from "../flash-command/types.ts";
import { FlashRegistry, flashRegistry, ok } from "../flash-command/index.ts";
import { AGENT_SENDER_ID, type Envelope, type HistoryEntry } from "../types/index.ts";
import type { GroupCustomerLookup, GroupLookupInput, IdentityResolver } from "../auth/types.ts";
import type {
  DistillTurn,
  MemoryRecall,
  MemoryScope,
  MemoryWriter,
  RecalledFact,
} from "../state/types.ts";
import type { Broadcaster, BroadcastTarget } from "../broadcast/types.ts";
import { TypingFactory } from "../broadcast/typing-factory.ts";
import { MemoryBroker, MemoryHistoryStore } from "../bootstrap/deps-memory.ts";
import { HISTORY_WINDOW_TURNS } from "../state/session.ts";
import type { ConversationCompactor } from "../state/compactor.ts";
import { SkillRegistry } from "../skills/registry.ts";
import { buildAgentRegistry } from "../agents/registry.ts";
import type { AgentConfig } from "../agents/types.ts";
import { ConversationLock } from "./lock.ts";
import { handleEnvelope } from "./handler.ts";
import { startWorkers } from "./pool.ts";
import type { WorkerContext } from "./types.ts";

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const CFG: AgentConfig = { maxTokens: 100, effort: "low", agentMaxIterations: 4 };
// Registry skill rỗng: test worker không phụ thuộc filesystem skill def.
const SKILLS = new SkillRegistry();
// Typing factory rỗng (fallback noop): test không assert typing, chỉ cần thoả kiểu WorkerContext.
const TYPING = new TypingFactory();

// Port flash-command rỗng: các test dưới gửi text thường (không phải `/lệnh`) → dispatch trả null,
// không chạm repo/ops. Chỉ cần thoả kiểu WorkerContext.
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

function makeEnvelope(over: Partial<Envelope> = {}): Envelope {
  return {
    source: "channel",
    channel: "zalo",
    msgId: "m1",
    conversationId: "c1",
    senderId: "u1",
    isGroup: false,
    addressedToAgent: true,
    text: "hi",
    mentions: [],
    ts: 1,
    ...over,
  };
}

class ScriptedProvider implements LLMProvider {
  readonly name = "scripted";
  private index = 0;
  constructor(private readonly script: readonly ChatResult[]) {}
  chat(_req: ChatRequest): Promise<ChatResult> {
    const result = this.script[this.index];
    this.index += 1;
    if (result === undefined) throw new Error("hết kịch bản");
    return Promise.resolve(result);
  }
}

/** Lượt đầu treo tới khi bị abort (LLM/mạng lặng), lượt sau trả lời — kiểm deadline mỗi lượt. */
class HangsOnceProvider implements LLMProvider {
  readonly name = "hangs-once";
  private calls = 0;
  private markAborted: () => void = () => {};
  /** Resolve khi lượt treo thấy signal abort — test chờ mốc này thay vì đoán theo đồng hồ. */
  readonly aborted: Promise<void> = new Promise((resolve) => {
    this.markAborted = resolve;
  });
  chat(_req: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
    this.calls += 1;
    if (this.calls > 1) {
      return Promise.resolve({
        stopReason: "end_turn",
        content: [{ type: "text", text: LATE_REPLY }],
      });
    }
    return new Promise((_resolve, reject) => {
      signal?.addEventListener(
        "abort",
        () => {
          this.markAborted();
          reject(new Error("lượt bị abort"));
        },
        { once: true },
      );
    });
  }
}

const LATE_REPLY = "tin sau vẫn chạy";

/** Chờ điều kiện thay vì ngủ một khoảng cố định — test không phụ thuộc tốc độ máy. */
async function waitFor(cond: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("chờ điều kiện quá hạn");
    await delay(5);
  }
}

class FakeResolver implements IdentityResolver {
  constructor(private readonly identity: Identity) {}
  resolve(): Promise<Identity> {
    return Promise.resolve(this.identity);
  }
}

class CapturingBroadcaster implements Broadcaster {
  readonly sent: Array<{ target: BroadcastTarget; text: string }> = [];
  send(target: BroadcastTarget, text: string): Promise<void> {
    this.sent.push({ target, text });
    return Promise.resolve();
  }
}

/** AUTH hỏng (vd Postgres chết) — phải phân biệt được với BROADCAST hỏng. */
class ThrowingResolver implements IdentityResolver {
  resolve(): Promise<Identity> {
    return Promise.reject(new Error("db chết"));
  }
}

class ThrowingBroadcaster implements Broadcaster {
  send(): Promise<void> {
    return Promise.reject(new Error("kênh chết"));
  }
}

/** Ghi lại scope recall — dùng để kiểm memory được tra theo PHÒNG nào. */
class RecordingMemory implements MemoryRecall {
  readonly scopes: MemoryScope[] = [];
  recall(scope: MemoryScope): Promise<RecalledFact[]> {
    this.scopes.push(scope);
    return Promise.resolve([]);
  }
}

class FakeGroupCustomer implements GroupCustomerLookup {
  readonly calls: GroupLookupInput[] = [];
  constructor(private readonly customerId?: string) {}
  customerIdOf(input: GroupLookupInput): Promise<string | undefined> {
    this.calls.push(input);
    return Promise.resolve(this.customerId);
  }
}

describe("MemoryBroker consume", () => {
  test("take chờ tới khi publish", async () => {
    const broker = new MemoryBroker();
    const pending = broker.take();
    await broker.publish(makeEnvelope({ msgId: "mx" }));
    expect((await pending)?.envelope.msgId).toBe("mx");
  });

  test("publish trước, take sau (FIFO)", async () => {
    const broker = new MemoryBroker();
    await broker.publish(makeEnvelope({ msgId: "a" }));
    await broker.publish(makeEnvelope({ msgId: "b" }));
    expect((await broker.take())?.envelope.msgId).toBe("a");
    expect((await broker.take())?.envelope.msgId).toBe("b");
  });

  test("abort → take trả null", async () => {
    const broker = new MemoryBroker();
    const ac = new AbortController();
    const pending = broker.take(ac.signal);
    ac.abort();
    expect(await pending).toBeNull();
  });
});

describe("ConversationLock", () => {
  test("cùng key serialize (task chậm chạy trước)", async () => {
    const lock = new ConversationLock();
    const order: string[] = [];
    const p1 = lock.run("a", async () => {
      await delay(20);
      order.push("a1");
    });
    const p2 = lock.run("a", () => {
      order.push("a2");
      return Promise.resolve();
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual(["a1", "a2"]);
  });

  test("key khác chạy song song (không chờ)", async () => {
    const lock = new ConversationLock();
    const order: string[] = [];
    const p1 = lock.run("a", async () => {
      await delay(20);
      order.push("a");
    });
    const p2 = lock.run("b", () => {
      order.push("b");
      return Promise.resolve();
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual(["b", "a"]);
  });
});

describe("startWorkers — deadline mỗi lượt", () => {
  test("lượt treo quá turnTimeoutMs → abort, phòng vẫn phục vụ tin kế", async () => {
    const history = new MemoryHistoryStore();
    for (const msgId of ["m1", "m2"]) {
      await history.append({
        conversationId: "c1",
        msgId,
        senderId: "u1",
        text: "hi",
        isGroup: false,
        role: "user",
        ts: 1,
      });
    }
    const provider = new HangsOnceProvider();
    const broadcaster = new CapturingBroadcaster();
    const broker = new MemoryBroker();
    const workers = startWorkers({
      history,
      historyWriter: history,
      flash: flashRegistry,
      identityRepo: NOOP_REPO,
      ops: NOOP_OPS,
      identity: new FakeResolver({ role: "guest", senderId: "u1" }),
      agents: buildAgentRegistry({ provider, config: CFG, skills: SKILLS }),
      broadcaster,
      typing: TYPING,
      broker,
      workerCount: 1,
      turnTimeoutMs: 20,
    });

    await broker.publish(makeEnvelope({ msgId: "m1" }));
    await broker.publish(makeEnvelope({ msgId: "m2" }));
    await provider.aborted;
    // Cùng conversationId: tin thứ hai chỉ chạy được nếu lượt treo đã nhả lock.
    await waitFor(() => broadcaster.sent.length === 1);
    await workers.stop();

    expect(broadcaster.sent[0]?.text).toBe(LATE_REPLY);
  });
});

describe("handleEnvelope", () => {
  function makeCtx(provider: LLMProvider, identity: Identity, history: MemoryHistoryStore): {
    ctx: WorkerContext;
    broadcaster: CapturingBroadcaster;
  } {
    const broadcaster = new CapturingBroadcaster();
    const ctx: WorkerContext = {
      history,
      historyWriter: history,
      flash: flashRegistry,
      identityRepo: NOOP_REPO,
      ops: NOOP_OPS,
      identity: new FakeResolver(identity),
      agents: buildAgentRegistry({ provider, config: CFG, skills: SKILLS }),
      broadcaster,
      typing: TYPING,
    };
    return { ctx, broadcaster };
  }

  test("auth→state→agent→broadcast: reply tới broadcaster", async () => {
    const history = new MemoryHistoryStore();
    await history.append({
      conversationId: "c1",
      msgId: "m1",
      senderId: "u1",
      text: "chào",
      isGroup: false,
      role: "user",
      ts: 1,
    });
    const provider = new ScriptedProvider([
      { stopReason: "end_turn", content: [{ type: "text", text: "xin chào bạn" }] },
    ]);
    const { ctx, broadcaster } = makeCtx(provider, { role: "guest", senderId: "u1" }, history);

    const result = await handleEnvelope(ctx, makeEnvelope());

    expect(result).toEqual({ status: "reply", text: "xin chào bạn" });
    expect(broadcaster.sent).toHaveLength(1);
    expect(broadcaster.sent[0]!.text).toBe("xin chào bạn");
    expect(broadcaster.sent[0]!.target.conversationId).toBe("c1");
  });

  test("nén hội thoại nhận CẢ BUFFER, không chỉ cửa sổ agent đọc", async () => {
    const history = new MemoryHistoryStore();
    const total = HISTORY_WINDOW_TURNS + 10;
    for (let i = 0; i < total; i++) {
      await history.append({
        conversationId: "c1",
        msgId: `old${i}`,
        senderId: "u1",
        text: `tin ${i}`,
        isGroup: false,
        role: "user",
        ts: i + 1,
      });
    }
    const seen: HistoryEntry[][] = [];
    const compactor: ConversationCompactor = {
      afterTurn: (_conversationId, entries) => {
        seen.push([...entries]);
        return Promise.resolve();
      },
    };
    const provider = new ScriptedProvider([
      { stopReason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ]);
    const { ctx } = makeCtx(provider, { role: "guest", senderId: "u1" }, history);

    const result = await handleEnvelope({ ...ctx, compactor }, makeEnvelope());

    expect(result.status).toBe("reply");
    // Agent chỉ thấy 20 tin cuối; compactor phải thấy cả phần đã trôi + reply vừa lưu.
    expect(seen[0]?.length).toBe(total + 1);
    expect(seen[0]?.[0]?.msgId).toBe("old0");
  });

  test("agent tra đơn → gửi tin báo TRƯỚC, rồi tin trả lời (2 tin, đúng thứ tự)", async () => {
    const history = new MemoryHistoryStore();
    await history.append({
      conversationId: "g1",
      msgId: "m1",
      senderId: "u1",
      text: "Đơn A đi giúp chị nhé!",
      isGroup: true,
      role: "user",
      ts: 1,
    });
    const provider = new ScriptedProvider([
      { stopReason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "tra_don_hang", input: {} }] },
      { stopReason: "end_turn", content: [{ type: "text", text: "Dạ đơn DH-1 đang giao ạ." }] },
    ]);
    const broadcaster = new CapturingBroadcaster();
    const ctx: WorkerContext = {
      history,
      historyWriter: history,
      flash: flashRegistry,
      identityRepo: NOOP_REPO,
      ops: NOOP_OPS,
      identity: new FakeResolver({ role: "nhan_vien", senderId: "u1", userId: "nv1" }),
      // Phòng đã /ketnoi-daily → tool tra đơn có phạm vi đại lý dù NGƯỜI GÕ là nhân viên.
      groupCustomer: new FakeGroupCustomer("dealer-1"),
      agents: buildAgentRegistry({ provider, config: CFG, skills: SKILLS }),
      broadcaster,
      typing: TYPING,
    };

    const result = await handleEnvelope(
      ctx,
      makeEnvelope({ conversationId: "g1", isGroup: true, text: "Đơn A đi giúp chị nhé!" }),
    );

    expect(result.status).toBe("reply");
    expect(broadcaster.sent.map((s) => s.text)).toEqual([
      "Dạ để em kiểm tra đơn hàng giúp anh/chị ạ.",
      "Dạ đơn DH-1 đang giao ạ.",
    ]);
    // Tin báo là câu trấn an cố định → KHÔNG vào history (chỉ tin người dùng + reply thật).
    const saved = await history.recent("g1", 10);
    expect(saved.map((e) => e.role)).toEqual(["user", "agent"]);
  });

  test("reply vượt trần channel → text gửi bị cắt, kết quả trả về giữ nguyên", async () => {
    const history = new MemoryHistoryStore();
    await history.append({
      conversationId: "c1",
      msgId: "m1",
      senderId: "u1",
      text: "chào",
      isGroup: false,
      role: "user",
      ts: 1,
    });
    const long = "a".repeat(5000);
    const provider = new ScriptedProvider([
      { stopReason: "end_turn", content: [{ type: "text", text: long }] },
    ]);
    const { ctx, broadcaster } = makeCtx(provider, { role: "guest", senderId: "u1" }, history);

    const result = await handleEnvelope(ctx, makeEnvelope());

    expect(result).toEqual({ status: "reply", text: long });
    const sent = broadcaster.sent[0]!.text;
    expect(sent.length).toBeLessThanOrEqual(4500);
    expect(sent.endsWith("… (nội dung đã bị cắt bớt)")).toBe(true);
  });

  test("history rỗng → failed(state), không broadcast", async () => {
    const provider = new ScriptedProvider([
      { stopReason: "end_turn", content: [{ type: "text", text: "x" }] },
    ]);
    const { ctx, broadcaster } = makeCtx(provider, { role: "guest", senderId: "u1" }, new MemoryHistoryStore());
    const result = await handleEnvelope(ctx, makeEnvelope({ conversationId: "trong" }));
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.step).toBe("state");
    expect(broadcaster.sent).toHaveLength(0);
  });

  test("AUTH hỏng → failed(auth), không chạy LLM, không broadcast", async () => {
    const history = new MemoryHistoryStore();
    const broadcaster = new CapturingBroadcaster();
    // Script rỗng: nếu loop chạy tới LLM thì test sẽ hỏng ở bước agent, không phải auth.
    const ctx: WorkerContext = {
      history,
      historyWriter: history,
      flash: flashRegistry,
      identityRepo: NOOP_REPO,
      ops: NOOP_OPS,
      identity: new ThrowingResolver(),
      agents: buildAgentRegistry({
        provider: new ScriptedProvider([]),
        config: CFG,
        skills: SKILLS,
      }),
      broadcaster,
      typing: TYPING,
    };

    const result = await handleEnvelope(ctx, makeEnvelope());

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.step).toBe("auth");
    expect(broadcaster.sent).toHaveLength(0);
  });

  test("BROADCAST hỏng → failed(broadcast), phân biệt được với auth", async () => {
    const history = new MemoryHistoryStore();
    await history.append({
      conversationId: "c1",
      msgId: "m1",
      senderId: "u1",
      text: "chào",
      isGroup: false,
      role: "user",
      ts: 1,
    });
    const ctx: WorkerContext = {
      history,
      historyWriter: history,
      flash: flashRegistry,
      identityRepo: NOOP_REPO,
      ops: NOOP_OPS,
      identity: new FakeResolver({ role: "guest", senderId: "u1" }),
      agents: buildAgentRegistry({
        provider: new ScriptedProvider([
          { stopReason: "end_turn", content: [{ type: "text", text: "ok" }] },
        ]),
        config: CFG,
        skills: SKILLS,
      }),
      broadcaster: new ThrowingBroadcaster(),
      typing: TYPING,
    };

    const result = await handleEnvelope(ctx, makeEnvelope());

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.step).toBe("broadcast");
  });

  test("flash command → dispatch, KHÔNG chạy LLM, broadcast + lưu history lượt agent", async () => {
    const history = new MemoryHistoryStore();
    const flash = new FlashRegistry().register({
      name: "ping",
      description: "test",
      handler: () => Promise.resolve(ok("pong")),
    });
    const broadcaster = new CapturingBroadcaster();
    const ctx: WorkerContext = {
      history,
      historyWriter: history,
      identity: new FakeResolver({ role: "guest", senderId: "u1" }),
      flash,
      identityRepo: NOOP_REPO,
      ops: NOOP_OPS,
      // Script LLM rỗng: nếu handler chạy tới bước agent thì hỏng ở đó, không trả "pong".
      agents: buildAgentRegistry({ provider: new ScriptedProvider([]), config: CFG, skills: SKILLS }),
      broadcaster,
      typing: TYPING,
    };

    const result = await handleEnvelope(ctx, makeEnvelope({ text: "/ping" }));

    expect(result).toEqual({ status: "reply", text: "pong" });
    expect(broadcaster.sent).toHaveLength(1);
    expect(broadcaster.sent[0]!.text).toBe("pong");
    // Reply lưu vào history như lượt agent (role=agent) để LLM turn sau thấy.
    const recent = await history.recent("c1", 10);
    expect(recent.at(-1)).toMatchObject({ role: "agent", text: "pong" });
  });

  test("nhóm đã /block → ignored, KHÔNG chạy LLM, không broadcast", async () => {
    const history = new MemoryHistoryStore();
    await history.append({
      conversationId: "g1",
      msgId: "m1",
      senderId: "u1",
      text: "đơn của em sao rồi",
      isGroup: true,
      role: "user",
      ts: 1,
    });
    const broadcaster = new CapturingBroadcaster();
    const ctx: WorkerContext = {
      history,
      historyWriter: history,
      flash: flashRegistry,
      identityRepo: { ...NOOP_REPO, isGroupBlocked: () => Promise.resolve(true) },
      ops: NOOP_OPS,
      identity: new FakeResolver({ role: "guest", senderId: "u1" }),
      // Script LLM rỗng: chạy tới bước agent là hỏng ở đó, không ra "ignored".
      agents: buildAgentRegistry({ provider: new ScriptedProvider([]), config: CFG, skills: SKILLS }),
      broadcaster,
      typing: TYPING,
    };

    const result = await handleEnvelope(
      ctx,
      makeEnvelope({ conversationId: "g1", isGroup: true, text: "đơn của em sao rồi" }),
    );

    expect(result).toEqual({ status: "ignored", reason: "group_blocked" });
    expect(broadcaster.sent).toHaveLength(0);
  });

  test("nhóm đã /block vẫn chạy flash command (để /unlock gỡ được)", async () => {
    const history = new MemoryHistoryStore();
    const broadcaster = new CapturingBroadcaster();
    const ctx: WorkerContext = {
      history,
      historyWriter: history,
      flash: flashRegistry,
      identityRepo: { ...NOOP_REPO, isGroupBlocked: () => Promise.resolve(true) },
      ops: NOOP_OPS,
      identity: new FakeResolver({ role: "nhan_vien", senderId: "u1", userId: "nv1" }),
      agents: buildAgentRegistry({ provider: new ScriptedProvider([]), config: CFG, skills: SKILLS }),
      broadcaster,
      typing: TYPING,
    };

    const result = await handleEnvelope(
      ctx,
      makeEnvelope({ conversationId: "g1", isGroup: true, text: "/unlock" }),
    );

    expect(result.status).toBe("reply");
    expect(broadcaster.sent).toHaveLength(1);
  });
});

// Memory thuộc PHÒNG: scope derive từ group_map + envelope, KHÔNG từ Identity người gõ.
describe("handleEnvelope — MemoryScope", () => {
  async function runWith(
    groupCustomer: GroupCustomerLookup | undefined,
    identity: Identity,
    envelope: Envelope,
  ): Promise<RecordingMemory> {
    const history = new MemoryHistoryStore();
    await history.append({
      conversationId: envelope.conversationId,
      msgId: "m1",
      senderId: envelope.senderId,
      text: "khách hỏi gì đó",
      isGroup: envelope.isGroup,
      role: "user",
      ts: 1,
    });
    const memory = new RecordingMemory();
    const ctx: WorkerContext = {
      history,
      historyWriter: history,
      flash: flashRegistry,
      identityRepo: NOOP_REPO,
      ops: NOOP_OPS,
      identity: new FakeResolver(identity),
      groupCustomer,
      agents: buildAgentRegistry({
        provider: new ScriptedProvider([
          { stopReason: "end_turn", content: [{ type: "text", text: "ok" }] },
        ]),
        config: CFG,
        skills: SKILLS,
        memory,
      }),
      broadcaster: new CapturingBroadcaster(),
      typing: TYPING,
    };
    const result = await handleEnvelope(ctx, envelope);
    expect(result.status).toBe("reply");
    return memory;
  }

  test("nhân viên gõ trong nhóm đã bind → scope là (khách của PHÒNG, kênh, phòng)", async () => {
    const groups = new FakeGroupCustomer("cusX");
    const memory = await runWith(
      groups,
      // Identity nhân viên KHÔNG mang customerId — lấy từ đây là mất scope.
      { role: "nhan_vien", senderId: "nv1", userId: "u-9" },
      makeEnvelope({ isGroup: true, conversationId: "g1", channel: "zalo", senderId: "nv1" }),
    );
    expect(groups.calls).toEqual([{ channel: "zalo", groupId: "g1" }]);
    expect(memory.scopes).toEqual([
      { ownerKind: "customer", ownerId: "cusX", channel: "zalo", conversationId: "g1" },
    ]);
  });

  test("nhóm chưa /ketnoi-dilim → không recall (không đoán khách)", async () => {
    const memory = await runWith(
      new FakeGroupCustomer(undefined),
      { role: "guest", senderId: "u1" },
      makeEnvelope({ isGroup: true, conversationId: "g2" }),
    );
    expect(memory.scopes).toHaveLength(0);
  });

  test("chat 1-1 với agent KHÔNG directOnly → không nhớ gì (fact là của phòng, không của người)", async () => {
    const groups = new FakeGroupCustomer("cusX");
    const memory = await runWith(
      groups,
      { role: "guest", senderId: "u1" },
      makeEnvelope({ isGroup: false }), // channel zalo → dealer agent
    );
    expect(groups.calls).toHaveLength(0);
    expect(memory.scopes).toHaveLength(0);
  });

  test("trợ lý riêng + chat 1-1 → scope theo NGƯỜI GÕ, không tra group_map", async () => {
    const groups = new FakeGroupCustomer("cusX");
    const memory = await runWith(
      groups,
      { role: "guest", senderId: "u7" },
      makeEnvelope({ isGroup: false, channel: "zalo-canhan", conversationId: "u7", senderId: "u7" }),
    );
    expect(groups.calls).toHaveLength(0);
    expect(memory.scopes).toEqual([
      { ownerKind: "user", ownerId: "u7", channel: "zalo-canhan", conversationId: "u7" },
    ]);
  });

  test("trợ lý riêng lạc vào nhóm → không nhớ (không rõ fact của ai)", async () => {
    const memory = await runWith(
      new FakeGroupCustomer("cusX"),
      { role: "guest", senderId: "u7" },
      makeEnvelope({ isGroup: true, channel: "zalo-canhan", conversationId: "g9" }),
    );
    expect(memory.scopes).toHaveLength(0);
  });
});

/** Ghi lại lời gọi đường ghi dài hạn — kiểm worker có đóng lượt bằng distill hay không. */
class RecordingMemoryWriter implements MemoryWriter {
  readonly calls: { scope: MemoryScope; turns: DistillTurn[]; sourceMsgId: string }[] = [];
  afterTurn(scope: MemoryScope, turns: readonly DistillTurn[], sourceMsgId: string): Promise<number> {
    this.calls.push({ scope, turns: [...turns], sourceMsgId });
    return Promise.resolve(0);
  }
}

// Đóng lượt (bước 10): reply agent vào history ngắn hạn + đẩy cửa sổ sang đường ghi dài hạn.
describe("handleEnvelope — ghi nhớ sau lượt", () => {
  async function runTurn(
    groupCustomer: GroupCustomerLookup | undefined,
    envelope: Envelope,
  ): Promise<{ writer: RecordingMemoryWriter; history: MemoryHistoryStore }> {
    const history = new MemoryHistoryStore();
    await history.append({
      conversationId: envelope.conversationId,
      msgId: "m1",
      senderId: envelope.senderId,
      text: "khách hỏi gì đó",
      isGroup: envelope.isGroup,
      role: "user",
      ts: 1,
    });
    const writer = new RecordingMemoryWriter();
    const ctx: WorkerContext = {
      history,
      historyWriter: history,
      flash: flashRegistry,
      identityRepo: NOOP_REPO,
      ops: NOOP_OPS,
      identity: new FakeResolver({ role: "guest", senderId: envelope.senderId }),
      groupCustomer,
      memoryWriters: { for: () => writer },
      agents: buildAgentRegistry({
        provider: new ScriptedProvider([
          { stopReason: "end_turn", content: [{ type: "text", text: "ok anh" }] },
        ]),
        config: CFG,
        skills: SKILLS,
      }),
      broadcaster: new CapturingBroadcaster(),
      typing: TYPING,
    };
    expect((await handleEnvelope(ctx, envelope)).status).toBe("reply");
    return { writer, history };
  }

  test("reply agent được lưu vào history phòng", async () => {
    const envelope = makeEnvelope({ isGroup: true, conversationId: "g1", channel: "zalo" });
    const { history } = await runTurn(new FakeGroupCustomer("cusX"), envelope);
    const recent = await history.recent("g1", 10);
    expect(recent.at(-1)).toMatchObject({ role: "agent", text: "ok anh" });
  });

  test("phòng đã bind → afterTurn nhận scope + transcript có cả lượt agent", async () => {
    const envelope = makeEnvelope({ isGroup: true, conversationId: "g1", channel: "zalo" });
    const { writer } = await runTurn(new FakeGroupCustomer("cusX"), envelope);
    expect(writer.calls).toHaveLength(1);
    const call = writer.calls[0];
    expect(call?.scope).toEqual({ ownerKind: "customer", ownerId: "cusX", channel: "zalo", conversationId: "g1" });
    expect(call?.sourceMsgId).toBe(envelope.msgId);
    expect(call?.turns.at(-1)).toEqual({ senderId: AGENT_SENDER_ID, role: "assistant", text: "ok anh" });
  });

  test("chưa bind phòng → không ghi dài hạn (không có chỗ để ghi)", async () => {
    const { writer } = await runTurn(new FakeGroupCustomer(undefined), makeEnvelope({ isGroup: true }));
    expect(writer.calls).toHaveLength(0);
  });

  test("ghi bằng writer CỦA AGENT vừa chạy (spec đóng cứng vào writer)", async () => {
    const asked: string[] = [];
    const writer = new RecordingMemoryWriter();
    const history = new MemoryHistoryStore();
    // Kênh zalo-sep → BossAgent: writer phải được tra bằng agentType "boss", không phải mặc định.
    const envelope = makeEnvelope({ isGroup: true, conversationId: "g1", channel: "zalo-sep" });
    await history.append({
      conversationId: envelope.conversationId,
      msgId: "m1",
      senderId: envelope.senderId,
      text: "doanh số tuần này",
      isGroup: true,
      role: "user",
      ts: 1,
    });

    const ctx: WorkerContext = {
      history,
      historyWriter: history,
      flash: flashRegistry,
      identityRepo: NOOP_REPO,
      ops: NOOP_OPS,
      identity: new FakeResolver({ role: "guest", senderId: envelope.senderId }),
      groupCustomer: new FakeGroupCustomer("cusX"),
      memoryWriters: {
        for: (agentType) => {
          asked.push(agentType);
          return writer;
        },
      },
      agents: buildAgentRegistry({
        provider: new ScriptedProvider([
          { stopReason: "end_turn", content: [{ type: "text", text: "ok" }] },
        ]),
        config: CFG,
        skills: SKILLS,
      }),
      broadcaster: new CapturingBroadcaster(),
      typing: TYPING,
    };

    expect((await handleEnvelope(ctx, envelope)).status).toBe("reply");
    expect(asked).toEqual(["boss"]);
    expect(writer.calls).toHaveLength(1);
  });

  test("nén hội thoại chạy theo PHÒNG — kể cả phòng chưa bind (không có MemoryScope)", async () => {
    const compacted: { conversationId: string; count: number }[] = [];
    const history = new MemoryHistoryStore();
    const envelope = makeEnvelope({ isGroup: true, conversationId: "g1", channel: "zalo" });
    await history.append({
      conversationId: envelope.conversationId,
      msgId: "m1",
      senderId: envelope.senderId,
      text: "hỏi gì đó",
      isGroup: true,
      role: "user",
      ts: 1,
    });

    const ctx: WorkerContext = {
      history,
      historyWriter: history,
      flash: flashRegistry,
      identityRepo: NOOP_REPO,
      ops: NOOP_OPS,
      identity: new FakeResolver({ role: "guest", senderId: envelope.senderId }),
      // Chưa /ketnoi-daily → không có scope → không distill. Nén vẫn phải chạy.
      groupCustomer: new FakeGroupCustomer(undefined),
      compactor: {
        afterTurn: (conversationId, entries) => {
          compacted.push({ conversationId, count: entries.length });
          return Promise.resolve();
        },
      },
      summaries: { get: () => Promise.resolve("tóm tắt cũ") },
      agents: buildAgentRegistry({
        provider: new ScriptedProvider([
          { stopReason: "end_turn", content: [{ type: "text", text: "ok" }] },
        ]),
        config: CFG,
        skills: SKILLS,
      }),
      broadcaster: new CapturingBroadcaster(),
      typing: TYPING,
    };

    expect((await handleEnvelope(ctx, envelope)).status).toBe("reply");
    // Cửa sổ đưa vào nén = history + reply agent vừa lưu.
    expect(compacted).toEqual([{ conversationId: "g1", count: 2 }]);
  });

  test("không có writer cho agent → bỏ ghi, KHÔNG mượn writer agent khác", async () => {
    const history = new MemoryHistoryStore();
    const envelope = makeEnvelope({ isGroup: true, conversationId: "g1", channel: "zalo" });
    await history.append({
      conversationId: envelope.conversationId,
      msgId: "m1",
      senderId: envelope.senderId,
      text: "hỏi gì đó",
      isGroup: true,
      role: "user",
      ts: 1,
    });

    const ctx: WorkerContext = {
      history,
      historyWriter: history,
      flash: flashRegistry,
      identityRepo: NOOP_REPO,
      ops: NOOP_OPS,
      identity: new FakeResolver({ role: "guest", senderId: envelope.senderId }),
      groupCustomer: new FakeGroupCustomer("cusX"),
      memoryWriters: { for: () => undefined },
      agents: buildAgentRegistry({
        provider: new ScriptedProvider([
          { stopReason: "end_turn", content: [{ type: "text", text: "ok" }] },
        ]),
        config: CFG,
        skills: SKILLS,
      }),
      broadcaster: new CapturingBroadcaster(),
      typing: TYPING,
    };

    // Lượt vẫn thành công: thiếu trí nhớ dài hạn không được biến lượt thành failed.
    expect((await handleEnvelope(ctx, envelope)).status).toBe("reply");
  });
});
