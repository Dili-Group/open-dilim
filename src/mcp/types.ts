// types.ts — hợp đồng tầng MCP: "server ngoài khai tool, agent gọi được tool đó".
//
// File LÁ: config.ts, tools/ và bootstrap cùng import từ đây nên không tạo cycle.
//
// NGUYÊN TẮC: server MCP là BÊN NGOÀI. Cả tên tool, mô tả tool lẫn kết quả trả về đều là dữ liệu
// người khác viết ra và đều đi thẳng vào prompt → coi như untrusted:
//   - Danh sách tool KHÔNG lấy hết, chỉ lấy đúng tool đã khai trong `tools` (allowlist, fail-closed).
//   - Mô tả tool bị cắt trần độ dài trước khi vào prompt.
//   - Kết quả trả về được đóng khung nói rõ đó là dữ liệu, không phải chỉ thị.

/**
 * Một server MCP đã khai trong env. `tools` là ALLOWLIST — chỉ tool có tên trong đây mới được đưa
 * cho model, phần còn lại server có khai bao nhiêu cũng bỏ. Rỗng = không dùng tool nào của server
 * đó (config.ts từ chối luôn, vì khai một server rồi không bật tool nào là gõ nhầm chứ không phải
 * chủ đích).
 */
export interface McpServerConfig {
  readonly name: string;
  readonly url: string;
  /** Bearer token gửi kèm mọi request tới server. undefined = server không cần xác thực. */
  readonly token?: string;
  readonly tools: readonly string[];
}

/** Một tool của server MCP, ĐÃ qua allowlist. `inputSchema` là JSON Schema do server cấp. */
export interface McpToolInfo {
  readonly server: string;
  /** Tên gốc phía server (dùng khi gọi `tools/call`). */
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** Kết quả một lần gọi tool. `isError` = server báo lỗi NGHIỆP VỤ → trả lời model, không throw. */
export interface McpCallResult {
  readonly text: string;
  readonly isError: boolean;
}

/**
 * Cổng MCP cho tầng tool. Chỉ hai việc: liệt kê tool đã nối được (đọc từ cache dựng lúc boot) và
 * gọi một tool. KHÔNG có `connect` — nối/đóng là việc của bootstrap.
 */
export interface McpPort {
  /** Tool của một server. Server chưa nối được/không khai = mảng rỗng. */
  tools(server: string): readonly McpToolInfo[];
  call(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult>;
}

/** Tình trạng MỘT server MCP đã khai trong env, sau lượt nối lúc boot. */
export interface McpServerStatus {
  readonly name: string;
  /** false = nối hỏng lúc boot (hoặc không tool nào bật được) → agent không thấy tool nào của nó. */
  readonly connected: boolean;
  /** Tool đang thật sự dùng được (đã qua allowlist + hợp lệ schema). */
  readonly tools: readonly string[];
  /** Tool bật trong config mà server KHÔNG khai (đổi tên, hạ bản) hoặc schema hỏng nên bị bỏ. */
  readonly missing: readonly string[];
}

/**
 * Cổng SOÁT tình trạng MCP — cho flash command `/mcp`. Tách khỏi `McpPort` có chủ đích: agent chỉ
 * cần gọi tool, không cần biết server nào chết. Người vận hành thì ngược lại.
 */
export interface McpStatusPort {
  status(): readonly McpServerStatus[];
}

/**
 * Một kết nối tới MỘT server MCP. Tách interface để `mcp/registry.ts` không phụ thuộc SDK — bản
 * thật ở `mcp/client.ts`, test bơm bản giả.
 */
export interface McpServerConnection {
  readonly name: string;
  listTools(signal?: AbortSignal): Promise<readonly McpToolInfo[]>;
  call(
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult>;
  close(): Promise<void>;
}

/**
 * Lỗi HẠ TẦNG khi làm việc với server MCP (không nối được, timeout, giao thức sai). Ném ra để
 * runner bắt → log + Sentry: đây là sự cố, không phải câu trả lời cho model.
 *
 * Lỗi NGHIỆP VỤ của tool (thiếu tham số, không tìm thấy) đi đường khác: server trả `isError` và
 * nó thành `McpCallResult.isError` → model tự sửa.
 */
export class McpError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "McpError";
  }
}
