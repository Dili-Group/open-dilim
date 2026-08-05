// index.ts — dựng tool cho 1 request. Identity bind SERVER-SIDE ở đây (closure), rồi tool chỉ
// thấy tham số nghiệp vụ. Thêm tool = thêm file impl/ + 1 dòng ở buildTools.

import type { Identity } from "../flash-command/types.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import { ToolRegistry } from "./registry.ts";
import { buildWhoamiTool } from "./impl/whoami.ts";
import { buildUseSkillTool } from "./impl/use-skill.ts";
import { buildUseReferenceTool } from "./impl/use-reference.ts";

/**
 * Dựng registry tool cho request hiện tại. Thứ tự tham số: app-scoped (`skills`) trước,
 * per-request (`identity`) sau. Cả hai vào bằng CLOSURE — không cái nào lộ ra inputSchema.
 */
export function buildToolRegistry(skills: SkillRegistry, identity: Identity): ToolRegistry {
  return new ToolRegistry([
    buildWhoamiTool(identity),
    buildUseSkillTool(skills),
    buildUseReferenceTool(skills),
  ]);
}

export { ToolRegistry } from "./registry.ts";
export { runToolCall } from "./runner.ts";
export { readStringField } from "./input.ts";
export type { Tool, ToolResult } from "./types.ts";
