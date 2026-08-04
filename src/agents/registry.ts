// registry.ts — AgentRegistry: map agentType → root agent (+ default). Worker gọi
// resolve(agentType).run(). Hiện chỉ 1 root agent mặc định; thêm root = 1 file + 1 dòng register.

import type { Effort } from "../config.ts";
import type { LLMProvider } from "../llm/types.ts";
import type { Identity } from "../flash-command/types.ts";
import type { HistoryEntry } from "../types/index.ts";
import type { DistillSpec } from "../state/types.ts";
import { customerSupportSpec } from "../state/specs.ts";
import { buildToolRegistry } from "../tools/index.ts";
import { runAgentLoop } from "./loop.ts";
import { SYSTEM_PROMPT } from "./prompts.ts";

/** Config con agent cần (subset của CONFIG) — narrow để test khỏi dựng full Config. */
export interface AgentConfig {
  readonly maxTokens: number;
  readonly effort: Effort;
  readonly agentMaxIterations: number;
}

export interface AgentRunInput {
  readonly identity: Identity;
  readonly history: readonly HistoryEntry[];
  readonly signal?: AbortSignal;
}

export interface RootAgent {
  readonly agentType: string;
  /** Policy chưng cất trí nhớ CỦA agent này — bộ chưng cất tuỳ agent, không chung một kiểu. */
  readonly memorySpec: DistillSpec;
  run(input: AgentRunInput): Promise<string>;
}

export class AgentRegistry {
  private readonly byType = new Map<string, RootAgent>();

  constructor(private readonly defaultAgent: RootAgent) {}

  register(agent: RootAgent): this {
    this.byType.set(agent.agentType, agent);
    return this;
  }

  /** Type sai/thiếu → default agent (design §4). */
  resolve(agentType?: string): RootAgent {
    const found = agentType === undefined ? undefined : this.byType.get(agentType);
    return found ?? this.defaultAgent;
  }
}

/** Root agent mặc định: dựng tool theo identity (act-as closure) rồi chạy loop. */
class DefaultAgent implements RootAgent {
  readonly agentType = "default";
  // Agent mặc định = hỗ trợ khách → chưng cất fact bền về khách. Agent khác khai spec riêng.
  readonly memorySpec = customerSupportSpec;

  constructor(
    private readonly provider: LLMProvider,
    private readonly config: AgentConfig,
  ) {}

  run(input: AgentRunInput): Promise<string> {
    return runAgentLoop({
      provider: this.provider,
      system: SYSTEM_PROMPT,
      history: input.history,
      registry: buildToolRegistry(input.identity),
      maxTokens: this.config.maxTokens,
      effort: this.config.effort,
      maxIterations: this.config.agentMaxIterations,
      signal: input.signal,
    });
  }
}

export function buildAgentRegistry(provider: LLMProvider, config: AgentConfig): AgentRegistry {
  return new AgentRegistry(new DefaultAgent(provider, config));
}
