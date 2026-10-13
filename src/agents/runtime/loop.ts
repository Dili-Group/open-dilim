// loop.ts — vòng lặp agent: LLM ⇄ tools tới khi model dừng gọi tool (design §agents loop.ts).
// Loop KHÔNG lắp ngữ cảnh: `system` + `messages` do context/ dựng sẵn (xem context/assembler.ts).
// Tool_use → chạy tool, nối tool_result, lặp. Chặn ở agentMaxIterations để không loop vô hạn.

import type { Effort } from "../../config.ts";
import type {
  LLMProvider,
  LlmContentBlock,
  LlmMessage,
  LlmSystemBlock,
  LlmToolUseBlock,
} from "../../llm/types.ts";
import { runToolCall, type ToolRegistry } from "../../tools/index.ts";
import type { UsageMeter } from "../../usage/meter.ts";
import type { ReplyCheck } from "../types.ts";

export interface AgentLoopInput {
  readonly provider: LLMProvider;
  /** Root agent đang cầm lượt — vào prefix log để lọc trace/Sentry Logs theo agent. */
  readonly agentType: string;
  readonly system: readonly LlmSystemBlock[];
  readonly messages: readonly LlmMessage[];
  readonly registry: ToolRegistry;
  readonly maxTokens: number;
  readonly effort: Effort;
  readonly maxIterations: number;
  /** Nhịp gọi TRƯỚC mỗi bước (báo "đang xử lý" về kênh). Best-effort — xem `pulse`. */
  readonly onStep?: () => Promise<void>;
  /**
   * Gửi tin "đang làm X" khi model gọi tool có khai `announce`. Phát TỐI ĐA 1 LẦN mỗi lượt: chuỗi
   * tool dài mà lần nào cũng "dạ để em kiểm tra" thì thành spam. Best-effort — xem `announce`.
   */
  readonly onAnnounce?: (text: string) => Promise<void>;
  /**
   * Bộ cộng token của lượt. MỖI VÒNG một lần gọi model, đều bị tính tiền → cộng hết, không chỉ
   * vòng cuối. undefined = không đo (test, hoặc chưa nối tầng usage) — không phải lỗi.
   */
  readonly meter?: UsageMeter;
  /** Luật kiểm bản trả lời trước khi trả ra (xem `ReplyCheck`). Thiếu = trả thẳng. */
  readonly replyChecks?: readonly ReplyCheck[];
  readonly signal?: AbortSignal;
}

const REFUSAL_REPLY = "Xin lỗi, mình không thể xử lý yêu cầu này.";
const TRUNCATED_REPLY = "Phản hồi quá dài — bạn thu hẹp yêu cầu giúp mình nhé.";
const EXHAUSTED_REPLY = "Xử lý vượt số bước cho phép, bạn thử lại sau nhé.";
// Mỗi lần sửa là thêm một lượt gọi model (vài giây khách chờ). Sửa 2 lần chưa xong thì lần 3 cũng
// khó xong — gửi bản cuối còn hơn bắt khách chờ tiếp.
const MAX_REPLY_FIXES = 2;

/**
 * Chạy loop, trả text trả lời cuối. Lỗi TOOL đã cô lập ở `runner.ts` (thành tool_result isError
 * cho model tự sửa) — nhưng lỗi PROVIDER (`provider.chat` → LLMError) VẪN nổi ra ngoài, và được
 * bắt ở biên `RootAgent.run` (agents/registry.ts) để thành `AgentResult.failed`.
 */
export async function runAgentLoop(input: AgentLoopInput): Promise<string> {
  const { provider, agentType, system, registry, maxTokens, effort, maxIterations, onStep, signal } =
    input;
  let messages: LlmMessage[] = [...input.messages];
  let announced = false;
  let fixes = 0;
  // Bản nháp gần nhất bị check trả về sửa. Hết vòng giữa chừng thì gửi nó — câu trả lời thật dù
  // còn lỗi vẫn hơn câu "vượt số bước".
  let lastDraft: string | undefined;
  const startedAt = Date.now();

  for (let i = 0; i < maxIterations; i++) {
    // Nhịp "đang xử lý" mỗi bước — giữ typing sống suốt chuỗi tool dài (indicator platform hết
    // hạn sau vài giây nên phải refresh từng vòng).
    await pulse(onStep, signal);
    const llmAt = Date.now();
    const result = await provider.chat(
      { system, messages, tools: registry.schemas(), maxTokens, effort },
      signal,
    );
    const llmMs = Date.now() - llmAt;
    // Cộng NGAY sau khi có kết quả: vòng sau có thể throw (timeout/abort) và thoát loop, nhưng
    // token của vòng này thì đã bị tính tiền rồi.
    const usage = result?.usage;
    if (usage !== undefined) input.meter?.add(usage);

    // Provider compat có thể trả thiếu field (xem anthropic.ts) → bóc bằng `?.`, coi như rỗng.
    const content = result?.content ?? [];
    const stopReason = result?.stopReason;

    if (stopReason === "tool_use") {
      const toolUses = content.filter(isToolUse);
      trace(agentType, i, maxIterations, `llm=${llmMs}ms → tool: ${toolUses.map((c) => c.name).join(", ")}`);
      // Báo TRƯỚC khi chạy tool: giá trị của câu "dạ để em kiểm tra" nằm ở chỗ nó tới sớm.
      if (!announced) {
        announced = await announce(registry, toolUses, input.onAnnounce, signal);
      }
      const toolsAt = Date.now();
      const toolResults = await Promise.all(
        toolUses.map((call) => runToolCall(registry, call, signal)),
      );
      trace(agentType, i, maxIterations, `tool xong=${Date.now() - toolsAt}ms`);
      messages = [
        ...messages,
        { role: "assistant", content },
        { role: "user", content: toolResults },
      ];
      continue;
    }

    trace(
      agentType,
      i,
      maxIterations,
      `llm=${llmMs}ms → ${stopReason}, tổng=${Date.now() - startedAt}ms`,
    );
    if (stopReason === "refusal") return REFUSAL_REPLY;
    const text = extractText(content);
    if (stopReason === "max_tokens" && text === "") return TRUNCATED_REPLY;

    const violations = text === "" ? [] : findViolations(input.replyChecks ?? [], text);
    if (violations.length === 0) return text;
    const names = violations.map((violation) => violation.name).join(", ");
    if (fixes >= MAX_REPLY_FIXES) {
      console.warn(`[agent:${agentType}] check vẫn trượt sau ${fixes} lần sửa, gửi bản cuối: ${names}`);
      return text;
    }
    fixes += 1;
    lastDraft = text;
    console.warn(`[agent:${agentType}] check trượt, nhờ model sửa lần ${fixes}/${MAX_REPLY_FIXES}: ${names}`);
    messages = [
      ...messages,
      { role: "assistant", content },
      { role: "user", content: [{ type: "text", text: fixRequest(violations) }] },
    ];
  }

  trace(agentType, maxIterations - 1, maxIterations, `hết vòng, tổng=${Date.now() - startedAt}ms`);
  return lastDraft ?? EXHAUSTED_REPLY;
}

interface ReplyViolation {
  readonly name: string;
  readonly reason: string;
}

function findViolations(checks: readonly ReplyCheck[], reply: string): ReplyViolation[] {
  const violations: ReplyViolation[] = [];
  for (const check of checks) {
    const reason = check.check(reply);
    if (reason !== undefined) violations.push({ name: check.name, reason });
  }
  return violations;
}

/**
 * Tin nhờ sửa đi vai `user` vì đó là lượt kế tiếp hợp lệ sau assistant. Nói rõ khách không thấy
 * tin này, kẻo model trả lời "dạ em xin lỗi đã nhắc…" ra cho khách. "Chỉ sửa đúng chỗ" để model
 * không viết lại cả câu trả lời rồi sinh lỗi mới ở chỗ đang đúng.
 */
function fixRequest(violations: readonly ReplyViolation[]): string {
  const reasons = violations.map((violation) => `- ${violation.reason}`).join("\n");
  return (
    "[Kiểm tra nội bộ — khách KHÔNG thấy tin này] Câu trả lời vừa soạn chưa được gửi vì:\n" +
    `${reasons}\n` +
    "Viết lại câu trả lời gửi khách: chỉ sửa đúng chỗ trên, giữ nguyên phần còn lại. " +
    "Không nhắc tới việc kiểm tra này."
  );
}

/**
 * Vết chạy từng vòng — CHỈ tên tool + thời gian, không input/output (không rò PII). Deadline lượt
 * (TURN_TIMEOUT_MS) cắt ngang thành AbortError trần trụi; không có dòng này thì không biết nó
 * chết ở LLM call hay ở tool nào.
 */
function trace(
  agentType: string,
  iteration: number,
  maxIterations: number,
  detail: string,
): void {
  // eslint-disable-next-line no-console
  console.log(`[agent:${agentType}] vòng ${iteration + 1}/${maxIterations} ${detail}`);
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

/**
 * Gửi câu báo của tool ĐẦU TIÊN có khai `announce` trong đợt gọi này. Trả true = đã gửi (lượt này
 * thôi báo). Lỗi gửi KHÔNG rethrow: câu trả lời thật vẫn phải tới, mất câu trấn an không đáng
 * giết lượt — nhưng trả true để không thử lại vòng sau (kênh hỏng thì vòng nào cũng hỏng).
 */
async function announce(
  registry: ToolRegistry,
  toolUses: readonly LlmToolUseBlock[],
  onAnnounce: ((text: string) => Promise<void>) | undefined,
  signal?: AbortSignal,
): Promise<boolean> {
  if (onAnnounce === undefined || signal?.aborted) return false;
  const text = toolUses
    .map((call) => registry.get(call.name)?.announce)
    .find((value): value is string => value !== undefined && value !== "");
  if (text === undefined) return false;
  try {
    await onAnnounce(text);
  } catch (err) {
    console.error("[agent] gửi tin báo tiến trình lỗi (bỏ qua):", err);
  }
  return true;
}

function isToolUse(block: LlmContentBlock): block is LlmToolUseBlock {
  return block?.type === "tool_use";
}

function extractText(content: readonly LlmContentBlock[]): string {
  return content
    .filter((block): block is Extract<LlmContentBlock, { type: "text" }> => block?.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}
