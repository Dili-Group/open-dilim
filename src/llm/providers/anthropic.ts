// anthropic.ts — impl LLMProvider bằng @anthropic-ai/sdk. Dịch type trung lập ⇄ Messages API.
// Non-streaming (đủ cho loop tối thiểu; stream để sau). KHÔNG gửi temperature (400 trên 4.8).
//
// Thinking: không bật param nào, nhưng model reasoning sau endpoint Anthropic-compatible
// (DeepSeek v4…) TỰ trả block thinking và bắt buộc echo lại trong vòng tool-use — thiếu là 400
// "thinking must be passed back". Vì vậy block thinking đi QUA nguyên vẹn (fromApiContent giữ,
// toApiBlock trả lại y nguyên); model không think thì không có block nào, hành vi như cũ.

import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatRequest,
  ChatResult,
  LLMProvider,
  LlmContentBlock,
  LlmMessage,
  LlmSystemBlock,
  LlmUsage,
  StopReason,
} from "../types.ts";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string, baseURL?: string) {
    this.client = new Anthropic({ apiKey, ...(baseURL === undefined ? {} : { baseURL }) });
    this.model = model;
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
    const message = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: req.maxTokens,
        system: toApiSystem(req.system),
        output_config: { effort: req.effort },
        messages: req.messages.map(toApiMessage),
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: { type: "object" as const, ...t.inputSchema },
        })),
      },
      { signal },
    );

    const usage = fromApiUsage(message.usage);
    logCacheUsage(usage);
    return {
      content: fromApiContent(message.content),
      stopReason: mapStopReason(message.stop_reason),
      usage,
    };
  }
}

/**
 * Khối system → text block, khối `cache` mang `cache_control` (breakpoint prompt cache).
 *
 * Thứ tự render của API là tools → system → messages, nên breakpoint ở khối system cuối cùng của
 * phần ổn định cache LUÔN CẢ tool schema. Cache ephemeral: TTL 5 phút, write 1.25×, read 0.1× →
 * hoà vốn từ request thứ 2 trong cùng phòng/agent.
 *
 * Prefix ngắn hơn ngưỡng tối thiểu của model (opus-4-8: 1024 token) thì API LẶNG LẼ không cache —
 * không lỗi, chỉ là `cache_read_input_tokens` mãi bằng 0. Đó là lý do có logCacheUsage.
 */
export function toApiSystem(blocks: readonly LlmSystemBlock[]): Anthropic.TextBlockParam[] {
  return blocks.map((block) => ({
    type: "text" as const,
    text: block.text,
    ...(block.cache === true ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

/**
 * Số liệu cache mỗi lượt — CHỈ con số, không nội dung (không rò PII). Đây là cách duy nhất biết
 * cache có trúng hay không: `read` mãi bằng 0 giữa các lượt cùng phòng = prefix đang bị phá
 * (prompt lệch byte, đổi bộ tool giữa chừng) hoặc prefix chưa đủ dài để cache.
 */
function logCacheUsage(usage: LlmUsage): void {
  // Dòng SỐ LIỆU, không phải log debug: không có nó thì không biết prompt cache trúng hay trượt.
  // eslint-disable-next-line no-console
  console.log(
    `[llm] tokens in=${usage.input} out=${usage.output} ` +
      `cache_read=${usage.cacheRead} cache_write=${usage.cacheWrite}`,
  );
}

/**
 * `usage` của API → type trung lập. BỐN field rời, không gộp:
 *  - `input_tokens` là phần CHƯA cache, KHÔNG phải cỡ prompt (prompt thật = cả ba field input).
 *  - hai field cache là optional trong SDK (null khi request không bật cache) → `?? 0`.
 */
function fromApiUsage(usage: Anthropic.Usage): LlmUsage {
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  };
}

export function toApiMessage(msg: LlmMessage): Anthropic.MessageParam {
  return { role: msg.role, content: msg.content.map(toApiBlock) };
}

function toApiBlock(block: LlmContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
    // Echo y nguyên (kể cả signature) — provider verify chữ ký của chính nó, đụng field là 400.
    // Endpoint compat không trả signature → gửi chuỗi rỗng (shape SDK bắt buộc field).
    case "thinking":
      return { type: "thinking", thinking: block.thinking, signature: block.signature ?? "" };
    case "redacted_thinking":
      return { type: "redacted_thinking", data: block.data };
  }
}

/** Giữ text + tool_use + thinking (echo bắt buộc với model reasoning). Block model SINH ra. */
export function fromApiContent(content: readonly Anthropic.ContentBlock[]): LlmContentBlock[] {
  const out: LlmContentBlock[] = [];
  for (const block of content) {
    if (block.type === "text") {
      out.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      out.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
    } else if (block.type === "thinking") {
      // SDK khai các field là string, nhưng response đến từ endpoint COMPAT (DeepSeek…) là
      // untrusted — field có thể vắng ở runtime. `??` để không lưu undefined vào messages.
      out.push({
        type: "thinking",
        thinking: block.thinking ?? "",
        ...(block.signature === undefined ? {} : { signature: block.signature }),
      });
    } else if (block.type === "redacted_thinking") {
      out.push({ type: "redacted_thinking", data: block.data ?? "" });
    }
  }
  return out;
}

function mapStopReason(reason: Anthropic.Message["stop_reason"]): StopReason {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}
