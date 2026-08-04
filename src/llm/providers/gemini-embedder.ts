// gemini-embedder.ts — impl Embedder bằng Gemini `gemini-embedding-001` qua REST (chưa có SDK
// Google trong deps → fetch thẳng). batchEmbedContents: 1 call cho N text, giữ đúng thứ tự.
//
// outputDimensionality=1536 (Matryoshka) khớp cột pgvector(1536). Không tự chuẩn hoá vector:
// pgvector `<=>` là cosine (bất biến theo độ dài) nên không cần. Response từ ngoài = UNTRUSTED →
// validate shape, không tin blind (CLAUDE.md).

import { EMBEDDING_DIM } from "../../db/schema.ts";
import { LLMError, type Embedder, type EmbedRequest, type EmbedTaskType } from "../types.ts";

const MODEL = "gemini-embedding-001";
const MODEL_PATH = `models/${MODEL}`;
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT_MS = 30_000;

// Gemini taskType — asymmetric embedding cho retrieval.
const TASK_TYPE: Record<EmbedTaskType, string> = {
  document: "RETRIEVAL_DOCUMENT",
  query: "RETRIEVAL_QUERY",
};

export class GeminiEmbedder implements Embedder {
  readonly name = "gemini";
  readonly dim = EMBEDDING_DIM;

  constructor(private readonly apiKey: string) {}

  async embed(req: EmbedRequest): Promise<number[][]> {
    if (req.texts.length === 0) return [];

    const taskType = TASK_TYPE[req.taskType ?? "document"];
    const body = {
      requests: req.texts.map((text) => ({
        model: MODEL_PATH,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: EMBEDDING_DIM,
      })),
    };

    const url = `${BASE_URL}/${MODEL_PATH}:batchEmbedContents`;
    const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const signal = req.signal
      ? AbortSignal.any([req.signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        // Key qua header (x-goog-api-key), KHÔNG nhét query string → không lọt vào log URL.
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      const reason = timeoutSignal.aborted ? `timeout ${DEFAULT_TIMEOUT_MS}ms` : describe(err);
      throw new LLMError(`Gemini embed thất bại (${reason})`, this.name, 0);
    }

    const raw = await response.text();
    if (!response.ok) {
      throw new LLMError(
        `Gemini embed trả ${response.status}: ${raw.slice(0, 500)}`,
        this.name,
        response.status,
      );
    }

    const vectors = parseEmbeddings(raw, this.name);
    if (vectors.length !== req.texts.length) {
      throw new LLMError(
        `Gemini embed trả ${vectors.length} vector, cần ${req.texts.length}`,
        this.name,
        response.status,
      );
    }
    return vectors;
  }
}

/** Parse `{ embeddings: [{ values: number[] }] }` an toàn — response ngoài không tin blind. */
function parseEmbeddings(raw: string, provider: string): number[][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LLMError(`Gemini embed response không phải JSON`, provider, 0);
  }
  if (typeof parsed !== "object" || parsed === null || !("embeddings" in parsed)) {
    throw new LLMError(`Gemini embed response thiếu 'embeddings'`, provider, 0);
  }
  const embeddings = parsed.embeddings;
  if (!Array.isArray(embeddings)) {
    throw new LLMError(`Gemini embed 'embeddings' không phải mảng`, provider, 0);
  }
  return embeddings.map((entry) => toValues(entry, provider));
}

function toValues(entry: unknown, provider: string): number[] {
  if (typeof entry !== "object" || entry === null || !("values" in entry)) {
    throw new LLMError(`Gemini embed thiếu 'values'`, provider, 0);
  }
  const values = entry.values;
  if (!Array.isArray(values) || !values.every((v): v is number => typeof v === "number")) {
    throw new LLMError(`Gemini embed 'values' không phải number[]`, provider, 0);
  }
  return values;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
