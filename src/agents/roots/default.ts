// default.ts — root agent mặc định: lắp ngữ cảnh (context/) + dựng tool theo identity (act-as)
// rồi chạy loop. Thêm root agent = thêm 1 file ở đây + 1 dòng register, KHÔNG sửa registry.ts.

import type { AgentResult } from "../../types/index.ts";
import { customerSupportSpec } from "../../state/specs.ts";
import { assembleTurnContext } from "../../context/assembler.ts";
import { buildToolRegistry } from "../../tools/index.ts";
import { runAgentLoop } from "../loop.ts";
import { SYSTEM_PROMPT } from "../prompts.ts";
import type { AgentDeps, AgentRunInput, RootAgent } from "../types.ts";

class DefaultAgent implements RootAgent {
  readonly agentType = "default";
  // Agent mặc định = hỗ trợ khách → chưng cất fact bền về khách. Agent khác khai spec riêng.
  readonly memorySpec = customerSupportSpec;

  constructor(private readonly deps: AgentDeps) {}

  async run(input: AgentRunInput): Promise<AgentResult> {
    try {
      const context = await assembleTurnContext(
        { basePrompt: SYSTEM_PROMPT, skills: this.deps.skills, memory: this.deps.memory },
        { history: input.history, memoryScope: input.memoryScope, signal: input.signal },
      );
      const text = await runAgentLoop({
        provider: this.deps.provider,
        system: context.system,
        messages: context.messages,
        registry: buildToolRegistry(this.deps.skills, input.identity),
        maxTokens: this.deps.config.maxTokens,
        effort: this.deps.config.effort,
        maxIterations: this.deps.config.agentMaxIterations,
        onStep: input.onStep,
        signal: input.signal,
      });
      return { status: "reply", text };
    } catch (err) {
      // Lỗi tool đã cô lập ở runner, nhưng provider.chat VẪN throw (LLMError) → chặn đúng biên
      // hợp đồng RootAgent.run, không để rò ra worker.
      return {
        status: "failed",
        step: "agent",
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
}

export function buildDefaultAgent(deps: AgentDeps): RootAgent {
  return new DefaultAgent(deps);
}
