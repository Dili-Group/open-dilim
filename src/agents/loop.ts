// loop.ts — vòng lặp agent: LLM ⇄ tools tới khi model dừng gọi tool (design §agents loop.ts).
// History phòng = chuỗi turn user (in-mem chưa lưu reply agent). Tool_use → chạy tool, nối
// tool_result, lặp. Chặn ở agentMaxIterations để không loop vô hạn.

import type { Effort } from "../config.ts";
import type {
  LLMProvider,
  LlmContentBlock,
  LlmMessage,
  LlmToolUseBlock,
} from "../llm/types.ts";
import type { HistoryEntry } from "../types/index.ts";
import { runToolCall, type ToolRegistry } from "../tools/index.ts";

export interface AgentLoopInput {
  readonly provider: LLMProvider;
  readonly system: string;
  readonly history: readonly HistoryEntry[];
  readonly registry: ToolRegistry;
  readonly maxTokens: number;
  readonly effort: Effort;
  readonly maxIterations: number;
  readonly signal?: AbortSignal;
}

const REFUSAL_REPLY = "Xin lỗi, mình không thể xử lý yêu cầu này.";
const TRUNCATED_REPLY = "Phản hồi quá dài — bạn thu hẹp yêu cầu giúp mình nhé.";
const EXHAUSTED_REPLY = "Xử lý vượt số bước cho phép, bạn thử lại sau nhé.";

/** Chạy loop, trả text trả lời cuối. Không bao giờ throw ra ngoài vì lỗi model/tool đã cô lập. */
export async function runAgentLoop(input: AgentLoopInput): Promise<string> {
  const { provider, system, registry, maxTokens, effort, maxIterations, signal } = input;
  let messages: LlmMessage[] = input.history.map(toUserMessage);

  for (let i = 0; i < maxIterations; i++) {
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

/** 1 turn history → 1 message user. Group đa speaker: gắn senderId để model phân biệt người. */
function toUserMessage(entry: HistoryEntry): LlmMessage {
  const text = entry.isGroup ? `${entry.senderId}: ${entry.text}` : entry.text;
  return { role: "user", content: [{ type: "text", text }] };
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
