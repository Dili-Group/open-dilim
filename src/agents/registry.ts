// registry.ts — AgentRegistry: map agentType → root agent (+ default). Worker gọi
// resolve(agentType).run(). CHỈ lo việc tra cứu — cách một agent chạy lượt nằm ở roots/*.

import { buildDefaultAgent } from "./roots/default.ts";
import type { AgentDeps, RootAgent } from "./types.ts";

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

export function buildAgentRegistry(deps: AgentDeps): AgentRegistry {
  return new AgentRegistry(buildDefaultAgent(deps));
}
