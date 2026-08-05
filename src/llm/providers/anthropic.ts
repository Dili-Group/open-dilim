// anthropic.ts — impl LLMProvider bằng @anthropic-ai/sdk. Dịch type trung lập ⇄ Messages API.
// Non-streaming (đủ cho loop tối thiểu; stream để sau). thinking omit → opus-4-8 chạy không
// thinking, khỏi phải echo thinking block qua từng turn. KHÔNG gửi temperature (400 trên 4.8).

import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatRequest,
  ChatResult,
  LLMProvider,
  LlmContentBlock,
  LlmMessage,
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
    console.log('req:: ', req)
    const message = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
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

    return {
      content: fromApiContent(message.content),
      stopReason: mapStopReason(message.stop_reason),
    };
  }
}

function toApiMessage(msg: LlmMessage): Anthropic.MessageParam {
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
  }
}

/** Chỉ giữ text + tool_use (bỏ thinking/khác). Đây là block model SINH ra. */
function fromApiContent(content: readonly Anthropic.ContentBlock[]): LlmContentBlock[] {
  const out: LlmContentBlock[] = [];
  for (const block of content) {
    if (block.type === "text") {
      out.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      out.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
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
