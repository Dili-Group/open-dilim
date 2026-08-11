// gemini-vision.ts — impl VisionReader bằng Gemini `generateContent` qua REST (chưa có SDK Google
// trong deps → fetch thẳng, giống gemini-embedder.ts).
//
// Ảnh đi lên dạng `inlineData` base64: Gemini KHÔNG tự tải link ngoài — `fileData.fileUri` chỉ nhận
// URI của Files API/GCS, nên link CDN phải được tải về trước rồi nhét bytes vào đây.
//
// Response từ ngoài = UNTRUSTED → validate shape, không tin blind (CLAUDE.md).

import { LLMError, type VisionReader, type VisionRequest } from "../types.ts";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// Ảnh nặng hơn text: 30s là đủ cho một ảnh chụp màn hình, và vẫn nằm dưới trần một lượt worker.
const DEFAULT_TIMEOUT_MS = 30_000;

// Trần chữ model trả về. Đọc ảnh là để lấy dữ kiện, không phải để viết luận — và kết quả này đi
// thẳng vào ngữ cảnh lượt sau, dài quá là đẩy history ra khỏi cửa sổ.
const MAX_OUTPUT_TOKENS = 2048;

// Đọc ảnh là việc CHÉP LẠI, không phải việc sáng tác: nhiệt độ thấp để cùng một ảnh cho cùng một
// kết quả, và để model bớt "điền cho trôi" khi chữ mờ.
const TEMPERATURE = 0.1;

export class GeminiVision implements VisionReader {
  readonly name = "gemini-vision";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async describe(req: VisionRequest): Promise<string> {
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: req.mimeType, data: req.imageBase64 } },
            { text: req.question },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: TEMPERATURE },
    };

    const url = `${BASE_URL}/models/${this.model}:generateContent`;
    const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const signal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal;

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
      throw new LLMError(`Gemini vision thất bại (${reason})`, this.name, 0);
    }

    const raw = await response.text();
    if (!response.ok) {
      throw new LLMError(
        `Gemini vision trả ${response.status}: ${raw.slice(0, 500)}`,
        this.name,
        response.status,
      );
    }
    return parseText(raw, this.name);
  }
}

/**
 * Gộp mọi part text của candidate đầu. Không có candidate nào = model từ chối (safety) hoặc cụt —
 * cả hai đều là "không đọc được ảnh", trả chuỗi rỗng để tầng trên tự diễn giải cho người dùng.
 */
function parseText(raw: string, provider: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LLMError("Gemini vision response không phải JSON", provider, 0);
  }
  if (!isRecord(parsed)) {
    throw new LLMError("Gemini vision response không phải object", provider, 0);
  }

  const candidates = parsed.candidates;
  if (!Array.isArray(candidates)) return "";
  const first = candidates[0];
  if (!isRecord(first) || !isRecord(first.content)) return "";

  const parts = first.content.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter((text) => text !== "")
    .join("\n")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
