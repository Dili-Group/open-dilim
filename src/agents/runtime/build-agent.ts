// build-agent.ts — bộ máy chạy lượt DÙNG CHUNG cho mọi root agent. Agent khác nhau ở DATA
// (prompt, tool, memorySpec, sub-agent) chứ không ở luồng chạy, nên luồng nằm đúng một chỗ:
//
//   orchestrate (nếu có sub) → assemble context → runAgentLoop
//
// Thêm agent = thêm 1 profile ở roots/, KHÔNG đụng file này.

import type { AgentResult } from "../../types/index.ts";
import { assembleTurnContext } from "../../context/assembler.ts";
import { buildToolRegistry } from "../../tools/index.ts";
import type { ToolFactory } from "../../tools/types.ts";
import type { DistillSpec } from "../../state/types.ts";
import { chooseSubAgent } from "./sub-router.ts";
import { runAgentLoop } from "./loop.ts";
import type { AgentDeps, AgentRunInput, RootAgent, RootAgentProfile } from "../types.ts";

class ProfileRootAgent implements RootAgent {
  readonly agentType: string;
  readonly directOnly: boolean;
  readonly memorySpec: DistillSpec;

  constructor(
    private readonly profile: RootAgentProfile,
    private readonly deps: AgentDeps,
  ) {
    this.agentType = profile.agentType;
    this.directOnly = profile.directOnly;
    this.memorySpec = profile.memorySpec;
  }

  async run(input: AgentRunInput): Promise<AgentResult> {
    try {
      // Chọn sub TRƯỚC khi lắp ngữ cảnh: sub đổi prompt nền, mà assemble xong mới đổi thì phải
      // recall memory (một lần gọi embed) hai lần cho cùng một lượt.
      const handler = await this.pickHandler(input);
      const context = await assembleTurnContext(
        {
          basePrompt: handler.prompt,
          skills: this.deps.skills,
          memory: this.deps.memory,
          agentType: this.agentType,
        },
        {
          history: input.history,
          summary: input.summary,
          memoryScope: input.memoryScope,
          pending: input.pending,
          signal: input.signal,
        },
      );
      const text = await runAgentLoop({
        provider: this.deps.provider,
        system: context.system,
        messages: context.messages,
        registry: buildToolRegistry(handler.tools, {
          skills: this.deps.skills,
          agentType: this.agentType,
          identity: input.identity,
          roomCustomerId: input.roomCustomerId,
          room: input.room,
          orders: this.deps.orders,
          dealer: this.deps.dealer,
          daily: this.deps.daily,
          workflow: this.deps.workflow,
        }),
        maxTokens: this.deps.config.maxTokens,
        effort: this.deps.config.effort,
        maxIterations: this.deps.config.agentMaxIterations,
        onStep: input.onStep,
        onAnnounce: input.onAnnounce,
        signal: input.signal,
      });
      return { status: "reply", text };
    } catch (err) {
      // Lỗi tool đã cô lập ở runner, nhưng provider.chat (loop lẫn orchestrator) VẪN throw
      // (LLMError) → chặn đúng biên hợp đồng RootAgent.run, không để rò ra worker.
      return {
        status: "failed",
        step: "agent",
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  /** Ai cầm lượt này: một sub-agent, hay chính root. Quyết định prompt + bộ tool của cả lượt. */
  private async pickHandler(
    input: AgentRunInput,
  ): Promise<{ prompt: string; tools: readonly ToolFactory[] }> {
    const subAgents = this.profile.subAgents ?? [];
    if (subAgents.length === 0) return this.profile;

    const sub = await chooseSubAgent({
      provider: this.deps.provider,
      subAgents,
      history: input.history,
      signal: input.signal,
    });
    return sub ?? this.profile;
  }
}

export function buildRootAgent(profile: RootAgentProfile, deps: AgentDeps): RootAgent {
  return new ProfileRootAgent(profile, deps);
}
