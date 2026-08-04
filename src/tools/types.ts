// types.ts — hợp đồng tool (design §tools): interface Tool { name, schema, run }.
//
// QUAN TRỌNG (chống confused-deputy): danh tính KHÔNG vào schema. Tool chỉ nhận tham số
// nghiệp vụ LLM sinh (mã đơn, ngày...). Act-as handle (userId/customerId) bind từ identity
// SERVER-SIDE qua closure lúc dựng tool cho request — xem buildTools(identity) trong index.ts.

export interface ToolResult {
  /** Nội dung trả về LLM (đã stringify). */
  readonly content: string;
  /** true = lỗi nghiệp vụ → LLM tự sửa, KHÔNG throw ra loop. */
  readonly isError?: boolean;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema object cho tham số nghiệp vụ (không chứa danh tính). */
  readonly inputSchema: Record<string, unknown>;
  run(input: unknown, signal?: AbortSignal): Promise<ToolResult>;
}
