// Test worker: MemoryBroker consume, order-lock theo phòng, handleEnvelope end-to-end.
// Provider/identity/broadcaster đều giả — không network, không DB, không config runtime.

import { describe, expect, test } from "bun:test";
import type { ChatRequest, ChatResult, LLMProvider } from "../llm/types.ts";
import type { Identity } from "../flash-command/types.ts";
import type { Envelope } from "../types/index.ts";
import type { GroupCustomerLookup, GroupLookupInput, IdentityResolver } from "../auth/types.ts";
import type { MemoryRecall, MemoryScope, RecalledFact } from "../state/types.ts";
import type { Broadcaster, BroadcastTarget } from "../broadcast/types.ts";
import { TypingFactory } from "../broadcast/typing-factory.ts";
import { MemoryBroker, MemoryHistoryStore } from "../bootstrap/deps-memory.ts";
import { SkillRegistry } from "../skills/registry.ts";
import { buildAgentRegistry } from "../agents/registry.ts";
import type { AgentConfig } from "../agents/types.ts";
import { ConversationLock } from "./lock.ts";
import { handleEnvelope } from "./handler.ts";
import type { WorkerContext } from "./types.ts";

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const CFG: AgentConfig = { maxTokens: 100, effort: "low", agentMaxIterations: 4 };
// Registry skill rỗng: test worker không phụ thuộc filesystem skill def.
const SKILLS = new SkillRegistry();
// Typing factory rỗng (fallback noop): test không assert typing, chỉ cần thoả kiểu WorkerContext.
const TYPING = new TypingFactory();

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

describe("handleEnvelope", () => {
  function makeCtx(provider: LLMProvider, identity: Identity, history: MemoryHistoryStore): {
    ctx: WorkerContext;
    broadcaster: CapturingBroadcaster;
  } {
    const broadcaster = new CapturingBroadcaster();
    const ctx: WorkerContext = {
      history,
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
      ts: 1,
    });
    const ctx: WorkerContext = {
      history,
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
      ts: 1,
    });
    const memory = new RecordingMemory();
    const ctx: WorkerContext = {
      history,
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
      { customerId: "cusX", channel: "zalo", conversationId: "g1" },
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

  test("chat 1-1 → không tra group_map, không recall", async () => {
    const groups = new FakeGroupCustomer("cusX");
    const memory = await runWith(
      groups,
      { role: "guest", senderId: "u1" },
      makeEnvelope({ isGroup: false }),
    );
    expect(groups.calls).toHaveLength(0);
    expect(memory.scopes).toHaveLength(0);
  });
});
