// registry.ts — AgentRegistry: map agentType → root agent (+ default). Worker gọi
// resolve(agentType).run(). CHỈ lo việc tra cứu — cách một agent chạy lượt nằm ở
// runtime/build-agent.ts, còn agent nào tồn tại nằm ở roots/*.

import { buildRootAgent } from "./runtime/build-agent.ts";
import { bossProfile } from "./roots/boss.ts";
import { dealerProfile } from "./roots/dealer.ts";
import { defaultProfile } from "./roots/default.ts";
import { operationsProfile } from "./roots/operations.ts";
import { warehouseProfile } from "./roots/warehouse.ts";
import { personalProfile } from "./roots/personal.ts";
import type { AgentDeps, RootAgent, RootAgentProfile } from "./types.ts";

/** Thêm root agent = thêm 1 file ở roots/ + 1 dòng ở đây. Không đụng bộ máy chạy lượt. */
const PROFILES: readonly RootAgentProfile[] = [
  operationsProfile,
  dealerProfile,
  personalProfile,
  bossProfile,
  warehouseProfile,
];

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

  /**
   * Mọi agent có thể chạy, GỒM cả default. Bootstrap dựa vào đây để dựng đồ per-agent (đường ghi
   * trí nhớ theo `memorySpec`) — thêm agent mới là tự có, không phải nhớ sửa thêm chỗ nào.
   */
  all(): readonly RootAgent[] {
    return [this.defaultAgent, ...this.byType.values()];
  }
}

export function buildAgentRegistry(deps: AgentDeps): AgentRegistry {
  const registry = new AgentRegistry(buildRootAgent(defaultProfile, deps));
  for (const profile of PROFILES) {
    registry.register(buildRootAgent(profile, deps));
  }
  return registry;
}
