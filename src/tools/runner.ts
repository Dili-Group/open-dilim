// runner.ts — nhận tool_use từ LLM → chạy tool → trả tool_result (design §tools runner.ts).
// Lỗi tool KHÔNG throw ra agent loop: gói thành tool_result isError để model tự sửa (CLAUDE.md).

import type { LlmToolResultBlock, LlmToolUseBlock } from "../llm/types.ts";
import type { ToolRegistry } from "./registry.ts";

export async function runToolCall(
  registry: ToolRegistry,
  call: LlmToolUseBlock,
  signal?: AbortSignal,
): Promise<LlmToolResultBlock> {
  const tool = registry.get(call.name);
  if (tool === undefined) {
    return {
      type: "tool_result",
      toolUseId: call.id,
      content: `Không có tool tên "${call.name}".`,
      isError: true,
    };
  }

  try {
    const result = await tool.run(call.input, signal);
    return {
      type: "tool_result",
      toolUseId: call.id,
      content: result.content,
      isError: result.isError,
    };
  } catch (err) {
    // Cô lập lỗi tool: trả structured cho LLM, không làm rớt loop/worker.
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[tool:${call.name}] chạy lỗi:`, err);
    return {
      type: "tool_result",
      toolUseId: call.id,
      content: `Lỗi khi chạy tool "${call.name}": ${reason}`,
      isError: true,
    };
  }
}
