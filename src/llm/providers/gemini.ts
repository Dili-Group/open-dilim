// gemini.ts — impl LLMProvider bằng Gemini `generateContent` qua REST (chưa có SDK Google trong
// deps → fetch thẳng, giống gemini-vision.ts / gemini-embedder.ts).
//
// PHẠM VI: lượt phụ text-only (nén hội thoại ngắn hạn). KHÔNG hỗ trợ tool — gặp tool schema hay
// tool block là throw rõ ràng (seam), không im lặng bỏ tool rồi để model trả lời chay. Agent loop
// đầy đủ trên Gemini vẫn là việc riêng (llm/registry.ts case "gemini").
//
// Response từ ngoài = UNTRUSTED → validate shape, không tin blind (CLAUDE.md).

import {
  LLMError,
  type ChatRequest,
  type ChatResult,
  type LLMProvider,
  type LlmContentBlock,
  type LlmUsage,
  type StopReason,
} from "../types.ts";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// Lượt phụ chạy SAU broadcast nên không ai chờ trực tiếp, nhưng vẫn nằm trong khoá phòng → phải
// có trần riêng, cùng cỡ với vision (30s).
const DEFAULT_TIMEOUT_MS = 30_000;

/** Shape body `generateContent`. Chỉ khai phần dùng — không chép cả API surface về. */
interface GeminiBody {
  readonly systemInstruction?: { readonly parts: readonly { readonly text: string }[] };
  readonly contents: readonly {
    readonly role: "user" | "model";
    readonly parts: readonly { readonly text: string }[];
  }[];
  readonly generationConfig: { readonly maxOutputTokens: number };
}

export class GeminiChat implements LLMProvider {
  readonly name = "gemini";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
    const body = toGeminiBody(req, this.name);

    const url = `${BASE_URL}/models/${this.model}:generateContent`;
    const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const merged = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        // Key qua header (x-goog-api-key), KHÔNG nhét query string → không lọt vào log URL.
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: merged,
      });
    } catch (err) {
      const reason = timeoutSignal.aborted ? `timeout ${DEFAULT_TIMEOUT_MS}ms` : describeErr(err);
      throw new LLMError(`Gemini chat thất bại (${reason})`, this.name, 0);
    }

    const raw = await response.text();
    if (!response.ok) {
      throw new LLMError(
        `Gemini chat trả ${response.status}: ${raw.slice(0, 500)}`,
        this.name,
        response.status,
      );
    }
    return parseChatResult(raw, this.name);
  }
}

/**
 * Map ChatRequest trung lập → body Gemini. Thuần để test không network (giống toApiSystem bên
 * anthropic.ts). `effort` bỏ qua: REST v1beta không có nấc tương ứng, và lượt phụ đều chạy low.
 */
export function toGeminiBody(req: ChatRequest, provider: string): GeminiBody {
  if (req.tools.length > 0) {
    throw new LLMError("GeminiChat chưa hỗ trợ tool — chỉ dùng cho lượt text-only.", provider, 0);
  }

  const contents = req.messages.map((message) => {
    const parts = message.content.map((block) => {
      if (block.type !== "text") {
        throw new LLMError(
          `GeminiChat chưa hỗ trợ block '${block.type}' — chỉ dùng cho lượt text-only.`,
          provider,
          0,
        );
      }
      return { text: block.text };
    });
    return { role: message.role === "assistant" ? ("model" as const) : ("user" as const), parts };
  });

  const system = req.system.map((block) => block.text).join("\n");
  return {
    ...(system === "" ? {} : { systemInstruction: { parts: [{ text: system }] } }),
    contents,
    generationConfig: { maxOutputTokens: req.maxTokens },
  };
}

/** Parse response → ChatResult. Không candidate = model cụt/safety → content rỗng, không throw. */
export function parseChatResult(raw: string, provider: string): ChatResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LLMError("Gemini chat response không phải JSON", provider, 0);
  }
  if (!isRecord(parsed)) {
    throw new LLMError("Gemini chat response không phải object", provider, 0);
  }

  const usage = parseUsage(parsed.usageMetadata);

  const candidates = parsed.candidates;
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  if (!isRecord(first)) return { content: [], stopReason: "other", usage };

  const content: LlmContentBlock[] = [];
  if (isRecord(first.content) && Array.isArray(first.content.parts)) {
    for (const part of first.content.parts) {
      if (isRecord(part) && typeof part.text === "string" && part.text !== "") {
        content.push({ type: "text", text: part.text });
      }
    }
  }
  return { content, stopReason: toStopReason(first.finishReason), usage };
}

function toStopReason(finishReason: unknown): StopReason {
  switch (finishReason) {
    case "STOP":
      return "end_turn";
    case "MAX_TOKENS":
      return "max_tokens";
    default:
      return "other";
  }
}

/**
 * usageMetadata → LlmUsage. `promptTokenCount` GỘP cả phần trúng cache → tách lại để input chỉ
 * còn cache miss (khớp cách Anthropic báo, và khớp cách pricing tính). Gemini không báo riêng
 * cache write → 0. `thoughtsTokenCount` tính giá output → cộng vào output.
 */
function parseUsage(meta: unknown): LlmUsage {
  if (!isRecord(meta)) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const prompt = numberOrZero(meta.promptTokenCount);
  const cached = numberOrZero(meta.cachedContentTokenCount);
  return {
    input: Math.max(prompt - cached, 0),
    output: numberOrZero(meta.candidatesTokenCount) + numberOrZero(meta.thoughtsTokenCount),
    cacheRead: cached,
    cacheWrite: 0,
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
