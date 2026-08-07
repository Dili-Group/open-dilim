// distiller.ts — bộ MÁY chung rút atomic fact bằng con nhẹ (CONFIG.memoryModel). NỘI DUNG chưng
// cất (giữ gì/bỏ gì, vocab loại) KHÔNG nhồi ở đây mà đến từ DistillSpec do AGENT cấp — mỗi agent
// nhớ thứ khác nhau. Chạy ngầm sau turn: KHÔNG throw ra ngoài (lỗi model/parse → [] + log).
// Output model = UNTRUSTED → validate.

import type { Effort } from "../config.ts";
import { singleSystem, type LLMProvider, type LlmContentBlock } from "../llm/types.ts";
import type { DistilledFact, DistillSpec, DistillTurn, Distiller } from "./types.ts";

// Distill là việc nhẹ → effort thấp, output ngắn (fact vài câu, không văn xuôi).
const DISTILL_EFFORT: Effort = "medium";
const DISTILL_MAX_TOKENS = 1024;
const DEFAULT_CONFIDENCE = 0.5;

// Khung output CHUNG mọi agent — append vào system của spec. Spec lo NỘI DUNG, khung lo ĐỊNH DẠNG.
function outputContract(spec: DistillSpec): string {
  const vocab = spec.allowedTypes.length > 0 ? spec.allowedTypes.join(" | ") : "(tự do)";
  return [
    "",
    'CHỈ trả JSON array, không văn xuôi. Phần tử: {"type","text","confidence"}.',
    `type ∈ ${vocab}. text tự đủ nghĩa (không đại từ mồ côi). confidence ∈ [0,1].`,
    "Không có gì đáng nhớ → trả [].",
  ].join("\n");
}

export class LlmDistiller implements Distiller {
  constructor(
    private readonly provider: LLMProvider,
    private readonly spec: DistillSpec,
  ) {}

  async distill(turns: readonly DistillTurn[], signal?: AbortSignal): Promise<DistilledFact[]> {
    if (turns.length === 0) return [];

    try {
      const result = await this.provider.chat(
        {
          system: singleSystem(this.spec.system + "\n" + outputContract(this.spec)),
          messages: [{ role: "user", content: [{ type: "text", text: renderTranscript(turns) }] }],
          tools: [],
          maxTokens: DISTILL_MAX_TOKENS,
          effort: DISTILL_EFFORT,
        },
        signal,
      );
      return parseFacts(extractText(result.content), this.spec);
    } catch (err) {
      // Best-effort: ghi nhớ hỏng KHÔNG được làm hỏng luồng trả lời. Log rồi nuốt.
      console.error("[distiller] rút fact lỗi:", err);
      return [];
    }
  }
}

/** Hội thoại → transcript phẳng cho model. role rõ để phân biệt bên nói. */
export function renderTranscript(turns: readonly DistillTurn[]): string {
  return turns
    .map((t) => `[${t.role === "assistant" ? "agent" : t.senderId}] ${t.text}`)
    .join("\n");
}

/**
 * Parse output model → DistilledFact[] theo spec. Chịu được model bọc văn xuôi quanh JSON. Phần
 * tử hỏng → BỎ (không throw). type ngoài vocab → spec.defaultType; confidence ngoài [0,1] → clamp.
 */
export function parseFacts(raw: string, spec: DistillSpec): DistilledFact[] {
  const arr = extractJsonArray(raw);
  if (arr === undefined) return [];

  const facts: DistilledFact[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (text === "") continue;
    facts.push({
      type: coerceType(record.type, spec),
      text,
      confidence: coerceConfidence(record.confidence),
    });
  }
  return facts;
}

function coerceType(value: unknown, spec: DistillSpec): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw === "") return spec.defaultType;
  // Vocab rỗng = agent chấp nhận mọi type; ngược lại phải nằm trong vocab.
  if (spec.allowedTypes.length === 0 || spec.allowedTypes.includes(raw)) return raw;
  return spec.defaultType;
}

function coerceConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CONFIDENCE;
  return Math.min(1, Math.max(0, value));
}

/** Lấy JSON array đầu tiên trong text (model có thể thêm chữ quanh nó). undefined nếu không có. */
function extractJsonArray(raw: string): unknown[] | undefined {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function extractText(content: readonly LlmContentBlock[]): string {
  return content
    .filter((block): block is Extract<LlmContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}
