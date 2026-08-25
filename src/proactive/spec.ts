// spec.ts — tra ProactiveSpec theo CHANNEL. Phễu proactive là tính năng CỦA AGENT (khai trên
// RootAgentProfile.proactive, mặc định đóng); channel → agent đã có bảng ở agents/router.ts nên
// ở đây chỉ ghép hai lượt tra thuần, không I/O.

import { PROFILES } from "../agents/registry.ts";
import { resolveAgentType } from "../agents/router.ts";
import type { ProactiveSpec } from "../agents/types.ts";

const SPEC_BY_AGENT: ReadonlyMap<string, ProactiveSpec> = new Map(
  PROFILES.flatMap((p) => (p.proactive === undefined ? [] : [[p.agentType, p.proactive] as const])),
);

/** undefined = channel không map agent nào, hoặc agent đó không khai phễu → phễu tắt. */
export function proactiveSpecFor(channel: string): ProactiveSpec | undefined {
  const agentType = resolveAgentType(channel);
  return agentType === undefined ? undefined : SPEC_BY_AGENT.get(agentType);
}
