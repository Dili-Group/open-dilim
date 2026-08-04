// Test worker: MemoryBroker consume, order-lock theo phòng, handleEnvelope end-to-end.
// Provider/identity/broadcaster đều giả — không network, không DB, không config runtime.

import { describe, expect, test } from "bun:test";
import type { ChatRequest, ChatResult, LLMProvider } from "../llm/types.ts";
import type { Identity } from "../flash-command/types.ts";
import type { Envelope } from "../types/index.ts";
import type { IdentityResolver } from "../auth/types.ts";
import type { Broadcaster, BroadcastTarget } from "../broadcast/types.ts";
import { MemoryBroker, MemoryHistoryStore } from "../bootstrap/deps-memory.ts";
import { buildAgentRegistry } from "../agents/registry.ts";
import { ConversationLock } from "./lock.ts";
import { handleEnvelope } from "./handler.ts";
import type { WorkerContext } from "./types.ts";

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

describe("MemoryBroker consume", () => {
  test("take chờ tới khi publish", async () => {
    const broker = new MemoryBroker();
    const pending = broker.take();
    await broker.publish(makeEnvelope({ msgId: "mx" }));
    expect((await pending)?.msgId).toBe("mx");
  });

  test("publish trước, take sau (FIFO)", async () => {
    const broker = new MemoryBroker();
    await broker.publish(makeEnvelope({ msgId: "a" }));
    await broker.publish(makeEnvelope({ msgId: "b" }));
    expect((await broker.take())?.msgId).toBe("a");
    expect((await broker.take())?.msgId).toBe("b");
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
      agents: buildAgentRegistry(provider, { maxTokens: 100, effort: "low", agentMaxIterations: 4 }),
      broadcaster,
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

    await handleEnvelope(ctx, makeEnvelope());

    expect(broadcaster.sent).toHaveLength(1);
    expect(broadcaster.sent[0]!.text).toBe("xin chào bạn");
    expect(broadcaster.sent[0]!.target.conversationId).toBe("c1");
  });

  test("history rỗng → bỏ qua, không broadcast", async () => {
    const provider = new ScriptedProvider([
      { stopReason: "end_turn", content: [{ type: "text", text: "x" }] },
    ]);
    const { ctx, broadcaster } = makeCtx(provider, { role: "guest", senderId: "u1" }, new MemoryHistoryStore());
    await handleEnvelope(ctx, makeEnvelope({ conversationId: "trong" }));
    expect(broadcaster.sent).toHaveLength(0);
  });
});
