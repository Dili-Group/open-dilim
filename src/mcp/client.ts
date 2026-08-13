// client.ts — kết nối THẬT tới một server MCP qua Streamable HTTP (@modelcontextprotocol/sdk).
//
// Chỗ DUY NHẤT trong repo biết tới SDK MCP. registry.ts chỉ thấy `McpServerConnection` nên đổi
// transport (stdio, SSE) hay đổi SDK đều gói gọn ở file này.
//
// CỐ Ý CHỈ HTTP: transport stdio phải spawn process con — đụng luật sandbox `CONFIG.workdir`, và
// biến một dòng env thành đường chạy lệnh tuỳ ý trên máy chủ. Cần stdio thì bọc server đó sau một
// endpoint HTTP, đừng mở cửa đó ở đây.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  McpError,
  type McpCallResult,
  type McpServerConfig,
  type McpServerConnection,
  type McpToolInfo,
} from "./types.ts";

/** Danh tính client gửi lên server MCP lúc bắt tay. Server dùng nó để nhận diện/ghi log. */
const CLIENT_NAME = "dilim-agent";
const CLIENT_VERSION = "0.0.1";

/** Trần số trang `tools/list` — server khai nhiều tool tới mức này là bất thường, dừng để khỏi treo boot. */
const MAX_TOOL_PAGES = 10;

/** Trần độ dài chữ trả về từ MỘT lần gọi tool. Chữ này đi thẳng vào context của lượt sau. */
const MAX_RESULT_CHARS = 8_000;

export interface McpConnectOptions {
  /** Trần thời gian bắt tay + `tools/list` lúc boot. Server chết không được làm chậm cả app. */
  readonly connectTimeoutMs: number;
  /** Trần thời gian MỘT lần `tools/call`. Phải nhỏ hơn `TURN_TIMEOUT_MS` để lượt còn kịp trả lời. */
  readonly callTimeoutMs: number;
}

/**
 * Mở kết nối tới một server MCP. Lỗi (server chết, URL sai, 401) → ném `McpError`; bootstrap bắt
 * và bỏ qua server đó, KHÔNG chặn boot.
 */
export async function openStreamableHttp(
  config: McpServerConfig,
  options: McpConnectOptions,
): Promise<McpServerConnection> {
  const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    ...(config.token === undefined
      ? {}
      : { requestInit: { headers: { Authorization: `Bearer ${config.token}` } } }),
  });

  try {
    await client.connect(transport, { timeout: options.connectTimeoutMs });
  } catch (err) {
    // KHÔNG kèm token vào message: message này đi lên log/Sentry.
    throw new McpError(`Không nối được server MCP "${config.name}" (${config.url})`, {
      cause: err,
    });
  }

  return new StreamableHttpConnection(config.name, client, options.callTimeoutMs);
}

class StreamableHttpConnection implements McpServerConnection {
  constructor(
    readonly name: string,
    private readonly client: Client,
    private readonly callTimeoutMs: number,
  ) {}

  async listTools(signal?: AbortSignal): Promise<readonly McpToolInfo[]> {
    const found: McpToolInfo[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const response = await this.client.listTools(cursor === undefined ? {} : { cursor }, {
        timeout: this.callTimeoutMs,
        ...(signal === undefined ? {} : { signal }),
      });
      for (const tool of response.tools) {
        found.push({
          server: this.name,
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema,
        });
      }
      cursor = response.nextCursor;
      if (cursor === undefined) break;
    }

    return found;
  }

  async call(
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult> {
    let result;
    try {
      result = await this.client.callTool({ name: tool, arguments: args }, CallToolResultSchema, {
        timeout: this.callTimeoutMs,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (err) {
      throw new McpError(`Gọi tool MCP "${this.name}/${tool}" hỏng`, { cause: err });
    }

    return {
      text: renderContent(result.content),
      isError: result.isError === true,
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Content block của MCP → một khối chữ cho model. Chỉ chữ đi tiếp: ảnh/âm thanh về dạng base64,
 * nhét nguyên vào context là đốt token mà model text cũng không đọc được.
 */
function renderContent(content: unknown): string {
  // Content block do server ngoài gửi: kiểu suy ra từ schema SDK vẫn là `unknown` ở đây, và tin
  // hình dạng của nó là tin bên ngoài. Narrow tay từng khối.
  const blocks: readonly unknown[] = Array.isArray(content) ? content : [];
  if (blocks.length === 0) return "(tool không trả về nội dung nào)";

  const parts: string[] = [];
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
      continue;
    }
    if (block.type === "resource" && isRecord(block.resource) && typeof block.resource.text === "string") {
      parts.push(block.resource.text);
      continue;
    }
    parts.push(`(bỏ qua một phần kết quả dạng "${String(block.type)}" — chỉ đọc được chữ)`);
  }

  const text = parts.join("\n").trim();
  if (text === "") return "(tool không trả về nội dung nào)";
  return text.length <= MAX_RESULT_CHARS
    ? text
    : `${text.slice(0, MAX_RESULT_CHARS)}\n(… kết quả dài quá nên bị cắt)`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
