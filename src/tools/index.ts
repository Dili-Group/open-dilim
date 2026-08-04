// index.ts — dựng tool cho 1 request. Identity bind SERVER-SIDE ở đây (closure), rồi tool chỉ
// thấy tham số nghiệp vụ. Thêm tool = thêm file impl/ + 1 dòng ở buildTools.

import type { Identity } from "../flash-command/types.ts";
import { ToolRegistry } from "./registry.ts";
import { buildWhoamiTool } from "./impl/whoami.ts";

/** Dựng registry tool cho identity của request hiện tại. */
export function buildToolRegistry(identity: Identity): ToolRegistry {
  return new ToolRegistry([buildWhoamiTool(identity)]);
}

export { ToolRegistry } from "./registry.ts";
export { runToolCall } from "./runner.ts";
export type { Tool, ToolResult } from "./types.ts";
