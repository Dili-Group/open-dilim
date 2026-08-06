// index.ts — dựng tool cho 1 request. Identity bind SERVER-SIDE ở đây (closure), rồi tool chỉ
// thấy tham số nghiệp vụ. Thêm tool = thêm file impl/ + 1 factory ở đây, rồi khai vào bộ tool
// của agent cần nó (agents/roots/*.ts) — KHÔNG phải tool nào cũng đi tới mọi agent.

import { ToolRegistry } from "./registry.ts";
import type { Tool, ToolContext, ToolFactory } from "./types.ts";
import { buildWhoamiTool } from "./impl/whoami.ts";
import { buildUseSkillTool } from "./impl/use-skill.ts";
import { buildUseReferenceTool } from "./impl/use-reference.ts";

/** Bộ tool ai cũng có: biết mình là ai + đọc skill/reference. Không chạm dữ liệu nghiệp vụ. */
export const COMMON_TOOLS: readonly ToolFactory[] = [
  (ctx: ToolContext): Tool => buildWhoamiTool(ctx.identity),
  (ctx: ToolContext): Tool => buildUseSkillTool(ctx.skills),
  (ctx: ToolContext): Tool => buildUseReferenceTool(ctx.skills),
];

/**
 * Dựng registry tool cho request hiện tại từ bộ factory của agent. Factory chạy Ở ĐÂY (không ở
 * bootstrap) vì tool closure identity — dùng lại instance giữa hai người gõ là act-as nhầm người.
 */
export function buildToolRegistry(
  factories: readonly ToolFactory[],
  ctx: ToolContext,
): ToolRegistry {
  return new ToolRegistry(factories.map((build) => build(ctx)));
}

export { ToolRegistry } from "./registry.ts";
export { runToolCall } from "./runner.ts";
export { readStringField } from "./input.ts";
export type { Tool, ToolResult, ToolContext, ToolFactory } from "./types.ts";
