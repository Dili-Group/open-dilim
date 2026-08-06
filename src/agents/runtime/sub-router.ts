// sub-router.ts — bước định tuyến MỊN bên trong 1 root agent: chọn sub-agent xử lý lượt này
// (§4: root = theo domain/vai, sub = theo task). Một lượt LLM nhẹ, KHÔNG tool, KHÔNG memory —
// chỉ đọc câu hỏi mới nhất rồi trả về đúng một tên.
//
// Chỉ chạy khi root có sub-agent. Root không khai sub → không tốn lượt LLM nào (xem runtime/build-agent.ts).

import type { LLMProvider, LlmContentBlock } from "../../llm/types.ts";
import type { HistoryEntry } from "../../types/index.ts";
import type { SubAgent } from "../types.ts";

/** Trả lời mong đợi là 1 tên sub (hoặc NONE) — đủ dài cho tên dài nhất, không hơn. */
const ROUTE_MAX_TOKENS = 24;
/** Không có sub nào hợp → root tự trả lời. Là câu trả lời HỢP LỆ, không phải lỗi. */
const NO_MATCH = "none";

export interface OrchestrateInput {
  readonly provider: LLMProvider;
  readonly subAgents: readonly SubAgent[];
  readonly history: readonly HistoryEntry[];
  readonly signal?: AbortSignal;
}

/**
 * undefined = root tự xử lý. Trả undefined cho MỌI trường hợp không chắc (model trả tên lạ,
 * không có câu hỏi để phân loại) — định tuyến sai còn tệ hơn không định tuyến, vì sub cầm bộ
 * tool khác và trả lời bằng persona khác.
 *
 * Lỗi provider KHÔNG nuốt ở đây: nổi lên `buildRootAgent` để thành `AgentResult.failed` như mọi
 * lỗi LLM khác — im lặng fallback sẽ giấu mất việc orchestrator hỏng liên tục.
 */
export async function chooseSubAgent(input: OrchestrateInput): Promise<SubAgent | undefined> {
  const question = lastUserText(input.history);
  if (question === undefined) return undefined;

  const result = await input.provider.chat(
    {
      system: buildRouterPrompt(input.subAgents),
      messages: [{ role: "user", content: [{ type: "text", text: question }] }],
      tools: [],
      maxTokens: ROUTE_MAX_TOKENS,
      // Phân loại theo mô tả sẵn có, không cần suy luận sâu — trả nhanh, rẻ.
      effort: "low",
    },
    input.signal,
  );

  const picked = extractText(result.content).toLowerCase();
  if (picked === "" || picked === NO_MATCH) return undefined;
  return input.subAgents.find((sub) => sub.name.toLowerCase() === picked);
}

function buildRouterPrompt(subAgents: readonly SubAgent[]): string {
  const options = subAgents.map((sub) => `- ${sub.name}: ${sub.description}`).join("\n");
  return [
    "Bạn là bộ định tuyến nội bộ. Đọc tin nhắn của người dùng và chọn bộ phận xử lý phù hợp nhất.",
    "",
    "Các bộ phận:",
    options,
    "",
    `Trả về DUY NHẤT tên bộ phận, không giải thích, không dấu câu. Không bộ phận nào hợp → trả "${NO_MATCH}".`,
  ].join("\n");
}

/** Câu đi phân loại = lượt người dùng gần nhất; lượt agent không phải thứ cần định tuyến. */
function lastUserText(history: readonly HistoryEntry[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry === undefined || entry.role !== "user") continue;
    return entry.text.trim() === "" ? undefined : entry.text;
  }
  return undefined;
}

function extractText(content: readonly LlmContentBlock[]): string {
  return content
    .filter((block): block is Extract<LlmContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}
