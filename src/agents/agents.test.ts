// Test agent loop: LLM⇄tools, dừng đúng theo stop_reason. Provider giả (scripted), không network.
// KHÔNG import config.ts runtime (fail-fast env) — chỉ type + prompt tách rời.

import { describe, expect, test } from "bun:test";
import type { ChatRequest, ChatResult, LLMProvider } from "../llm/types.ts";
import type { Identity } from "../flash-command/types.ts";
import type { HistoryEntry } from "../types/index.ts";
import { buildToolRegistry } from "../tools/index.ts";
import { customerSupportSpec } from "../state/specs.ts";
import { runAgentLoop } from "./loop.ts";
import { buildAgentRegistry, type AgentConfig } from "./registry.ts";

class ScriptedProvider implements LLMProvider {
  readonly name = "scripted";
  readonly seen: ChatRequest[] = [];
  private index = 0;
  constructor(private readonly script: readonly ChatResult[]) {}
  chat(req: ChatRequest): Promise<ChatResult> {
    this.seen.push(req);
    const result = this.script[this.index];
    this.index += 1;
    if (result === undefined) throw new Error("scripted provider hết kịch bản");
    return Promise.resolve(result);
  }
}

const GUEST: Identity = { role: "guest", senderId: "u1" };
const HISTORY: HistoryEntry[] = [
  { conversationId: "c1", msgId: "m1", senderId: "u1", text: "bạn là ai", isGroup: false, ts: 1 },
];
const CFG: AgentConfig = { maxTokens: 100, effort: "low", agentMaxIterations: 4 };

function loop(provider: LLMProvider) {
  return runAgentLoop({
    provider,
    system: "s",
    history: HISTORY,
    registry: buildToolRegistry(GUEST),
    maxTokens: CFG.maxTokens,
    effort: CFG.effort,
    maxIterations: CFG.agentMaxIterations,
  });
}

describe("runAgentLoop", () => {
  test("text-only → trả text luôn, gọi LLM 1 lần", async () => {
    const provider = new ScriptedProvider([
      { stopReason: "end_turn", content: [{ type: "text", text: "chào bạn" }] },
    ]);
    expect(await loop(provider)).toBe("chào bạn");
    expect(provider.seen).toHaveLength(1);
  });

  test("tool_use → chạy whoami → end_turn; turn 2 mang tool_result", async () => {
    const provider = new ScriptedProvider([
      { stopReason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "whoami", input: {} }] },
      { stopReason: "end_turn", content: [{ type: "text", text: "bạn là khách" }] },
    ]);
    expect(await loop(provider)).toBe("bạn là khách");
    expect(provider.seen).toHaveLength(2);

    const secondTurn = provider.seen[1]!.messages;
    const lastMsg = secondTurn[secondTurn.length - 1]!;
    expect(lastMsg.role).toBe("user");
    const block = lastMsg.content[0]!;
    expect(block.type).toBe("tool_result");
    if (block.type === "tool_result") {
      expect(block.content).toContain("Khách");
      expect(block.isError).toBeFalsy();
    }
  });

  test("tool lạ → tool_result isError, loop tiếp tục không crash", async () => {
    const provider = new ScriptedProvider([
      { stopReason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "khong_co", input: {} }] },
      { stopReason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ]);
    expect(await loop(provider)).toBe("ok");
    const block = provider.seen[1]!.messages.at(-1)!.content[0]!;
    if (block.type === "tool_result") expect(block.isError).toBe(true);
  });

  test("refusal → câu xin lỗi", async () => {
    const provider = new ScriptedProvider([{ stopReason: "refusal", content: [] }]);
    expect(await loop(provider)).toContain("không thể xử lý");
  });

  test("model gọi tool mãi → chặn ở maxIterations", async () => {
    const toolTurn: ChatResult = {
      stopReason: "tool_use",
      content: [{ type: "tool_use", id: "t", name: "whoami", input: {} }],
    };
    const provider = new ScriptedProvider([toolTurn, toolTurn, toolTurn, toolTurn]);
    expect(await loop(provider)).toContain("vượt số bước");
    expect(provider.seen).toHaveLength(CFG.agentMaxIterations);
  });
});

describe("AgentRegistry", () => {
  test("resolve type lạ → default agent chạy được", async () => {
    const provider = new ScriptedProvider([
      { stopReason: "end_turn", content: [{ type: "text", text: "xin chào" }] },
    ]);
    const registry = buildAgentRegistry(provider, CFG);
    const reply = await registry.resolve("khong_ton_tai").run({ identity: GUEST, history: HISTORY });
    expect(reply).toBe("xin chào");
  });

  test("default agent mang memorySpec riêng (chưng cất tuỳ agent)", () => {
    const provider = new ScriptedProvider([]);
    const registry = buildAgentRegistry(provider, CFG);
    expect(registry.resolve().memorySpec).toBe(customerSupportSpec);
  });
});
