// index.ts — điểm vào tầng MCP. Bootstrap dựng 1 registry lúc boot, share cho mọi lượt agent.

export { buildMcpRegistry, McpRegistry } from "./registry.ts";
export { openStreamableHttp, type McpConnectOptions } from "./client.ts";
export { McpError } from "./types.ts";
export type {
  McpCallResult,
  McpPort,
  McpServerConfig,
  McpServerConnection,
  McpServerStatus,
  McpStatusPort,
  McpToolInfo,
} from "./types.ts";
