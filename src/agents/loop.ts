// loop.ts — vòng lặp agent: LLM ⇄ tools tới khi model dừng gọi tool (design §agents loop.ts).
// Loop KHÔNG lắp ngữ cảnh: `system` + `messages` do context/ dựng sẵn (xem context/assembler.ts).
// Tool_use → chạy tool, nối tool_result, lặp. Chặn ở agentMaxIterations để không loop vô hạn.

import type { Effort } from "../config.ts";
import type {
  LLMProvider,
  LlmContentBlock,
  LlmMessage,
  LlmToolUseBlock,
} from "../llm/types.ts";
import { runToolCall, type ToolRegistry } from "../tools/index.ts";

export interface AgentLoopInput {
  readonly provider: LLMProvider;
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  readonly registry: ToolRegistry;
  readonly maxTokens: number;
  readonly effort: Effort;
  readonly maxIterations: number;
  /** Nhịp gọi TRƯỚC mỗi bước (báo "đang xử lý" về kênh). Best-effort — xem `pulse`. */
  readonly onStep?: () => Promise<void>;
  readonly signal?: AbortSignal;
}

const REFUSAL_REPLY = "Xin lỗi, mình không thể xử lý yêu cầu này.";
const TRUNCATED_REPLY = "Phản hồi quá dài — bạn thu hẹp yêu cầu giúp mình nhé.";
const EXHAUSTED_REPLY = "Xử lý vượt số bước cho phép, bạn thử lại sau nhé.";

/**
 * Chạy loop, trả text trả lời cuối. Lỗi TOOL đã cô lập ở `runner.ts` (thành tool_result isError
 * cho model tự sửa) — nhưng lỗi PROVIDER (`provider.chat` → LLMError) VẪN nổi ra ngoài, và được
 * bắt ở biên `RootAgent.run` (agents/registry.ts) để thành `AgentResult.failed`.
 */
export async function runAgentLoop(input: AgentLoopInput): Promise<string> {
  const { provider, system, registry, maxTokens, effort, maxIterations, onStep, signal } = input;
  let messages: LlmMessage[] = [...input.messages];

  for (let i = 0; i < maxIterations; i++) {
    // Nhịp "đang xử lý" mỗi bước — giữ typing sống suốt chuỗi tool dài (indicator platform hết
    // hạn sau vài giây nên phải refresh từng vòng).
    await pulse(onStep, signal);
    const result = await provider.chat(
      { system, messages, tools: registry.schemas(), maxTokens, effort },
      signal,
    );

    if (result.stopReason === "tool_use") {
      const toolUses = result.content.filter(isToolUse);
      const toolResults = await Promise.all(
        toolUses.map((call) => runToolCall(registry, call, signal)),
      );
      messages = [
        ...messages,
        { role: "assistant", content: result.content },
        { role: "user", content: toolResults },
      ];
      continue;
    }

    if (result.stopReason === "refusal") return REFUSAL_REPLY;
    const text = extractText(result.content);
    if (result.stopReason === "max_tokens" && text === "") return TRUNCATED_REPLY;
    return text;
  }

  return EXHAUSTED_REPLY;
}

/**
 * Gửi 1 nhịp báo tiến trình. Nuốt lỗi CÓ CHỦ ĐÍCH (log warn, không rethrow): typing là tín hiệu
 * cosmetic — hỏng nó KHÔNG được giết lượt trả lời. Đã abort → bỏ qua, không phát nhịp thừa.
 */
async function pulse(onStep: (() => Promise<void>) | undefined, signal?: AbortSignal): Promise<void> {
  if (onStep === undefined || signal?.aborted) return;
  try {
    await onStep();
  } catch (err) {
    console.warn("[agent] gửi typing hỏng (bỏ qua):", err);
  }
}

function isToolUse(block: LlmContentBlock): block is LlmToolUseBlock {
  return block.type === "tool_use";
}

function extractText(content: readonly LlmContentBlock[]): string {
  return content
    .filter((block): block is Extract<LlmContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}
