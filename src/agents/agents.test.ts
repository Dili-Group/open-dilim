// Test agent loop: LLM⇄tools, dừng đúng theo stop_reason. Provider giả (scripted), không network.
// KHÔNG import config.ts runtime (fail-fast env) — chỉ type + prompt tách rời.

import { describe, expect, test } from "bun:test";
import { singleSystem, type ChatRequest, type ChatResult, type LLMProvider, type LlmMessage } from "../llm/types.ts";
import type { Identity } from "../flash-command/types.ts";
import type { HistoryEntry } from "../types/index.ts";
import { SkillRegistry } from "../skills/registry.ts";
import { COMMON_TOOLS, buildToolRegistry } from "../tools/index.ts";
import type { ToolFactory } from "../tools/types.ts";
import { customerSupportSpec, internalOpsSpec } from "../state/specs.ts";
import { runAgentLoop } from "./runtime/loop.ts";
import { buildAgentRegistry } from "./registry.ts";
import { buildRootAgent } from "./runtime/build-agent.ts";
import { resolveAgentType } from "./router.ts";
import { AgentType, type RootAgentProfile, type SubAgent } from "./types.ts";
import type { AgentConfig, AgentDeps } from "./types.ts";

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

/** System giờ là nhiều khối (khối ổn định mang breakpoint cache) — test soi nội dung thì gộp lại. */
function systemText(req: ChatRequest | undefined): string {
  return (req?.system ?? []).map((block) => block.text).join("\n\n");
}

const GUEST: Identity = { role: "guest", senderId: "u1" };
const HISTORY: HistoryEntry[] = [
  { conversationId: "c1", msgId: "m1", senderId: "u1", text: "bạn là ai", isGroup: false, role: "user", ts: 1 },
];
const CFG: AgentConfig = { maxTokens: 100, effort: "low", agentMaxIterations: 4 };

// Registry skill rỗng: test loop/agent không phụ thuộc filesystem skill def.
const SKILLS = new SkillRegistry();
const MESSAGES: LlmMessage[] = [{ role: "user", content: [{ type: "text", text: "bạn là ai" }] }];

function loop(provider: LLMProvider) {
  return runAgentLoop({
    provider,
    agentType: "test_agent",
    system: singleSystem("s"),
    messages: MESSAGES,
    registry: buildToolRegistry(COMMON_TOOLS, { skills: SKILLS, identity: GUEST }),
    maxTokens: CFG.maxTokens,
    effort: CFG.effort,
    maxIterations: CFG.agentMaxIterations,
  });
}

function agentDeps(provider: LLMProvider): AgentDeps {
  return { provider, config: CFG, skills: SKILLS };
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

describe("announce giữa lượt", () => {
  /** Tool "chậm" giả: khai announce để loop báo khách trước khi chạy. */
  const slowTool: ToolFactory = () => ({
    name: "cham",
    description: "tool chậm",
    inputSchema: { type: "object", properties: {} },
    announce: "Dạ để em kiểm tra ạ.",
    run: () => Promise.resolve({ content: "xong" }),
  });
  const toolTurn: ChatResult = {
    stopReason: "tool_use",
    content: [{ type: "tool_use", id: "t1", name: "cham", input: {} }],
  };

  function loopWith(
    factories: readonly ToolFactory[],
    script: readonly ChatResult[],
    onAnnounce: (text: string) => Promise<void>,
  ): Promise<string> {
    return runAgentLoop({
      provider: new ScriptedProvider(script),
      agentType: "test_agent",
      system: singleSystem("s"),
      messages: MESSAGES,
      registry: buildToolRegistry(factories, { skills: SKILLS, identity: GUEST }),
      maxTokens: CFG.maxTokens,
      effort: CFG.effort,
      maxIterations: CFG.agentMaxIterations,
      onAnnounce,
    });
  }

  test("tool có announce → gửi ĐÚNG 1 LẦN dù gọi tool nhiều vòng", async () => {
    const sent: string[] = [];
    const text = await loopWith([slowTool], [toolTurn, toolTurn, { stopReason: "end_turn", content: [{ type: "text", text: "rồi ạ" }] }], (t) => {
      sent.push(t);
      return Promise.resolve();
    });
    expect(text).toBe("rồi ạ");
    expect(sent).toEqual(["Dạ để em kiểm tra ạ."]);
  });

  test("tool KHÔNG khai announce → không gửi gì", async () => {
    const sent: string[] = [];
    await loopWith(
      COMMON_TOOLS,
      [
        { stopReason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "whoami", input: {} }] },
        { stopReason: "end_turn", content: [{ type: "text", text: "ok" }] },
      ],
      (t) => {
        sent.push(t);
        return Promise.resolve();
      },
    );
    expect(sent).toEqual([]);
  });

  test("gửi announce hỏng → lượt vẫn trả lời bình thường", async () => {
    const text = await loopWith([slowTool], [toolTurn, { stopReason: "end_turn", content: [{ type: "text", text: "vẫn xong" }] }], () =>
      Promise.reject(new Error("kênh chết")),
    );
    expect(text).toBe("vẫn xong");
  });
});

describe("AgentRegistry", () => {
  test("resolve type lạ → default agent chạy được", async () => {
    const provider = new ScriptedProvider([
      { stopReason: "end_turn", content: [{ type: "text", text: "xin chào" }] },
    ]);
    const registry = buildAgentRegistry(agentDeps(provider));
    const result = await registry.resolve("khong_ton_tai").run({ identity: GUEST, history: HISTORY });
    expect(result).toEqual({ status: "reply", text: "xin chào" });
  });

  test("provider lỗi → run trả failed(agent), KHÔNG reject", async () => {
    // Script rỗng → ScriptedProvider throw ngay lượt đầu, mô phỏng LLMError xuyên qua loop.
    const registry = buildAgentRegistry(agentDeps(new ScriptedProvider([])));
    const result = await registry.resolve().run({ identity: GUEST, history: HISTORY });
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.step).toBe("agent");
  });

  test("default agent mang memorySpec riêng (chưng cất tuỳ agent)", () => {
    const provider = new ScriptedProvider([]);
    const registry = buildAgentRegistry(agentDeps(provider));
    expect(registry.resolve().memorySpec).toBe(customerSupportSpec);
  });

  test("đăng ký đủ 4 root agent, mỗi cái mang prompt+spec riêng", async () => {
    const registry = buildAgentRegistry(agentDeps(new ScriptedProvider([])));
    for (const type of Object.values(AgentType)) {
      expect(registry.resolve(type).agentType).toBe(type);
    }
    expect(registry.resolve(AgentType.Boss).memorySpec).toBe(internalOpsSpec);
    // Trợ lý riêng chỉ chạy 1-1 → worker bỏ qua group MemoryScope.
    expect(registry.resolve(AgentType.Personal).directOnly).toBe(true);
    expect(registry.resolve(AgentType.Dealer).directOnly).toBe(false);
  });

  test("agent dealer nạp đúng prompt của nó vào system", async () => {
    const provider = new ScriptedProvider([
      { stopReason: "end_turn", content: [{ type: "text", text: "dạ" }] },
    ]);
    const registry = buildAgentRegistry(agentDeps(provider));
    await registry.resolve(AgentType.Dealer).run({ identity: GUEST, history: HISTORY });
    expect(systemText(provider.seen[0])).toContain("ĐẠI LÝ");
  });
});

describe("resolveAgentType", () => {
  test("channel đã map → đúng agent, không phân biệt hoa thường", () => {
    expect(resolveAgentType("zalo")).toBe(AgentType.Dealer);
    expect(resolveAgentType("ZALO-SEP")).toBe(AgentType.Boss);
    expect(resolveAgentType("zalo-canhan")).toBe(AgentType.Personal);
  });

  test("channel lạ → undefined (registry rơi về default, không đoán agent)", () => {
    expect(resolveAgentType("telegram")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — sub-agent bên trong 1 root: chọn xong thì sub cầm TRỌN lượt (prompt + tool).
// ─────────────────────────────────────────────────────────────────────────────

const SUB_TOOL_NAME = "xem_bao_cao";
const SUB: SubAgent = {
  name: "bao_cao",
  description: "câu hỏi về báo cáo doanh số",
  prompt: "PROMPT_SUB",
  tools: [
    () => ({
      name: SUB_TOOL_NAME,
      description: "xem báo cáo",
      inputSchema: { type: "object", properties: {}, required: [] },
      run: () => Promise.resolve({ content: "ok" }),
    }),
  ],
};

const ROOT_WITH_SUB: RootAgentProfile = {
  agentType: "test_root",
  directOnly: false,
  prompt: "PROMPT_ROOT",
  memorySpec: customerSupportSpec,
  tools: COMMON_TOOLS,
  subAgents: [SUB],
};

/** Lượt LLM của orchestrator: chỉ trả về một tên. */
function routeTo(name: string): ChatResult {
  return { stopReason: "end_turn", content: [{ type: "text", text: name }] };
}

const FINAL_TURN: ChatResult = {
  stopReason: "end_turn",
  content: [{ type: "text", text: "xong" }],
};

describe("orchestrator (sub-agent)", () => {
  test("chọn được sub → sub cầm prompt + bộ tool của nó", async () => {
    const provider = new ScriptedProvider([routeTo("bao_cao"), FINAL_TURN]);
    const agent = buildRootAgent(ROOT_WITH_SUB, agentDeps(provider));

    expect(await agent.run({ identity: GUEST, history: HISTORY })).toEqual({
      status: "reply",
      text: "xong",
    });
    // Lượt 0 = định tuyến: không tool, không prompt agent.
    expect(provider.seen[0]?.tools).toEqual([]);
    // Lượt 1 = sub trả lời: prompt sub thay prompt root, tool cũng của sub.
    expect(systemText(provider.seen[1])).toContain("PROMPT_SUB");
    expect(systemText(provider.seen[1])).not.toContain("PROMPT_ROOT");
    expect(provider.seen[1]?.tools.map((t) => t.name)).toEqual([SUB_TOOL_NAME]);
  });

  test('trả "none" → root tự trả lời', async () => {
    const provider = new ScriptedProvider([routeTo("none"), FINAL_TURN]);
    await buildRootAgent(ROOT_WITH_SUB, agentDeps(provider)).run({
      identity: GUEST,
      history: HISTORY,
    });
    expect(systemText(provider.seen[1])).toContain("PROMPT_ROOT");
  });

  test("trả tên lạ → root tự trả lời (không đoán sub gần đúng)", async () => {
    const provider = new ScriptedProvider([routeTo("phong_ke_toan"), FINAL_TURN]);
    await buildRootAgent(ROOT_WITH_SUB, agentDeps(provider)).run({
      identity: GUEST,
      history: HISTORY,
    });
    expect(systemText(provider.seen[1])).toContain("PROMPT_ROOT");
  });

  test("root không khai sub → KHÔNG tốn lượt LLM định tuyến nào", async () => {
    const provider = new ScriptedProvider([FINAL_TURN]);
    const noSub: RootAgentProfile = { ...ROOT_WITH_SUB, subAgents: undefined };
    await buildRootAgent(noSub, agentDeps(provider)).run({ identity: GUEST, history: HISTORY });
    expect(provider.seen).toHaveLength(1);
    expect(systemText(provider.seen[0])).toContain("PROMPT_ROOT");
  });
});
