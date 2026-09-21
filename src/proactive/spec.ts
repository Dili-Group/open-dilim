// spec.ts — tra ProactiveSpec theo CHANNEL. Phễu proactive là tính năng CỦA AGENT (khai trên
// RootAgentProfile.proactive, mặc định đóng); channel → agent đã có bảng ở agents/router.ts nên
// ở đây chỉ ghép hai lượt tra thuần, không I/O.

import type { DedicatedRoom } from "../agents/dedicated-rooms.ts";
import { PROFILES } from "../agents/registry.ts";
import { resolveAgentType } from "../agents/router.ts";
import type { ProactiveSpec } from "../agents/types.ts";

const SPEC_BY_AGENT: ReadonlyMap<string, ProactiveSpec> = new Map(
  PROFILES.flatMap((p) => (p.proactive === undefined ? [] : [[p.agentType, p.proactive] as const])),
);

/**
 * undefined = channel không map agent nào, hoặc agent đó không khai phễu → phễu tắt.
 *
 * Phải tra theo CẢ nhóm: nhóm chuyên dụng nằm trên kênh của agent khác, bỏ `groupId` thì phễu
 * của agent kênh (đại lý) chạy trong nhóm nội bộ — nhảy vào mọi câu tán gẫu của sale.
 */
export function proactiveSpecFor(
  channel: string,
  groupId?: string,
  rooms: readonly DedicatedRoom[] = [],
): ProactiveSpec | undefined {
  const agentType = resolveAgentType(channel, groupId, rooms);
  return agentType === undefined ? undefined : SPEC_BY_AGENT.get(agentType);
}
