// registry.ts — gom nhiều server MCP thành MỘT cổng `McpPort` cho tầng tool.
//
// Danh sách tool chốt MỘT LẦN lúc boot rồi cache. KHÔNG list lại mỗi lượt, vì hai lý do:
//   1. Schema tool render TRƯỚC system prompt (llm/types.ts) → danh sách đổi 1 byte là hỏng cache
//      prefix của cả lượt. Danh sách phải tĩnh và có thứ tự cố định (sort theo tên).
//   2. Mỗi lượt thêm một vòng gọi mạng ra server ngoài chỉ để biết thứ vừa biết xong.
//
// Server nào chết lúc boot thì BỎ server đó, không chặn boot: tool của nó vắng mặt, agent chạy
// tiếp bằng các tool còn lại (giống cách vision/memory degrade).

import {
  McpError,
  type McpCallResult,
  type McpPort,
  type McpServerConfig,
  type McpServerConnection,
  type McpServerStatus,
  type McpStatusPort,
  type McpToolInfo,
} from "./types.ts";
import { openStreamableHttp, type McpConnectOptions } from "./client.ts";

/**
 * Trần độ dài mô tả tool lấy từ server. Mô tả này là chữ BÊN NGOÀI viết, nằm trong system prefix
 * của MỌI lượt — vừa là tiền token cố định, vừa là mặt tiếp xúc prompt injection. Cắt cho gọn.
 */
const MAX_DESCRIPTION_CHARS = 512;

export class McpRegistry implements McpPort, McpStatusPort {
  constructor(
    private readonly connections: ReadonlyMap<string, McpServerConnection>,
    private readonly byServer: ReadonlyMap<string, readonly McpToolInfo[]>,
    /** Tình trạng MỌI server đã khai — gồm cả server nối hỏng, để `/mcp` báo được là nó hỏng. */
    private readonly statuses: readonly McpServerStatus[] = [],
  ) {}

  tools(server: string): readonly McpToolInfo[] {
    return this.byServer.get(server) ?? [];
  }

  status(): readonly McpServerStatus[] {
    return this.statuses;
  }

  async call(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult> {
    const connection = this.connections.get(server);
    if (connection === undefined) {
      throw new McpError(`Server MCP "${server}" chưa nối được — không gọi tool "${tool}" được.`);
    }
    // Chặn lần hai ở đường GỌI: allowlist đã lọc lúc dựng tool, nhưng tool name đến từ model.
    // Model bịa được tên → không có hàng rào này là gọi thẳng tool chưa bật.
    const allowed = this.tools(server).some((info) => info.name === tool);
    if (!allowed) {
      throw new McpError(`Tool "${tool}" không nằm trong danh sách bật của server MCP "${server}".`);
    }
    return connection.call(tool, args, signal);
  }

  /** Đóng mọi kết nối (shutdown). Một server đóng lỗi không chặn các server còn lại. */
  async close(): Promise<void> {
    await Promise.all(
      [...this.connections.values()].map(async (connection) => {
        try {
          await connection.close();
        } catch (err) {
          console.warn(`[mcp] đóng kết nối "${connection.name}" lỗi:`, err);
        }
      }),
    );
  }
}

/**
 * Nối mọi server đã khai, lọc theo allowlist, trả registry đã cache. Không throw: server hỏng chỉ
 * warn rồi bỏ qua.
 *
 * `open` bơm được để test không cần server thật.
 */
export async function buildMcpRegistry(
  servers: readonly McpServerConfig[],
  options: McpConnectOptions,
  open: (
    config: McpServerConfig,
    options: McpConnectOptions,
  ) => Promise<McpServerConnection> = openStreamableHttp,
): Promise<McpRegistry> {
  const connections = new Map<string, McpServerConnection>();
  const byServer = new Map<string, readonly McpToolInfo[]>();
  const statuses: McpServerStatus[] = [];

  for (const config of servers) {
    let connection: McpServerConnection;
    let listed: readonly McpToolInfo[];
    try {
      connection = await open(config, options);
      listed = await connection.listTools();
    } catch (err) {
      console.warn(`[mcp] bỏ qua server "${config.name}": ${describe(err)}`);
      statuses.push({ name: config.name, connected: false, tools: [], missing: config.tools });
      continue;
    }

    const picked = pickAllowed(config, listed);
    const names = picked.map((info) => info.name);
    const missing = config.tools.filter((name) => !names.includes(name));

    if (picked.length === 0) {
      console.warn(`[mcp] server "${config.name}" không có tool nào bật được → đóng kết nối.`);
      await connection.close();
      // Nối được nhưng không dùng được tool nào = với agent thì y hệt chưa nối.
      statuses.push({ name: config.name, connected: false, tools: [], missing });
      continue;
    }

    connections.set(config.name, connection);
    byServer.set(config.name, picked);
    statuses.push({ name: config.name, connected: true, tools: names, missing });
  }

  return new McpRegistry(connections, byServer, statuses);
}

/**
 * Lấy ĐÚNG các tool đã bật trong config, theo thứ tự ổn định. Tool khai trong config mà server
 * không có (đổi tên, hạ bản) → warn: im lặng ở đây là nghiệp vụ mất tool mà không ai biết.
 */
function pickAllowed(
  config: McpServerConfig,
  listed: readonly McpToolInfo[],
): readonly McpToolInfo[] {
  const enabled = new Set(config.tools);
  const picked: McpToolInfo[] = [];

  for (const info of listed) {
    if (!enabled.has(info.name)) continue;
    if (!isObjectSchema(info.inputSchema)) {
      // Schema hỏng đi lên LLM là hỏng CẢ LƯỢT (provider 400), không phải hỏng mỗi tool đó.
      console.warn(`[mcp] tool "${config.name}/${info.name}" có inputSchema lạ → bỏ.`);
      continue;
    }
    picked.push({ ...info, description: truncate(info.description) });
  }

  const missing = config.tools.filter((name) => !picked.some((info) => info.name === name));
  if (missing.length > 0) {
    console.warn(`[mcp] server "${config.name}" không khai tool: ${missing.join(", ")}`);
  }

  return picked.sort((a, b) => a.name.localeCompare(b.name));
}

function isObjectSchema(schema: Record<string, unknown>): boolean {
  return schema.type === "object";
}

function truncate(text: string): string {
  return text.length <= MAX_DESCRIPTION_CHARS ? text : `${text.slice(0, MAX_DESCRIPTION_CHARS)}…`;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
