// extractor.ts — rút vấn đề / giải pháp / đề xuất KB từ transcript một group một ngày.
// One-shot chat trên con nhẹ (CONFIG.memoryModel), KHÔNG agent loop — cùng thủ pháp LlmDistiller.
// Output model = UNTRUSTED → parse bao dung: phần tử hỏng bỏ, JSON vỡ trả undefined (caller đánh
// dấu lượt failed), KHÔNG throw ra ngoài.

import type { Effort } from "../config.ts";
import { singleSystem, type LLMProvider, type LlmContentBlock } from "../llm/types.ts";
import { vnClock } from "./time.ts";
import type { KbDigestExtraction, KbLoggedMessage } from "./types.ts";

const EXTRACT_EFFORT: Effort = "medium";
const EXTRACT_MAX_TOKENS = 2048;

/**
 * Trần transcript đưa vào model, GIỮ ĐUÔI: cuối ngày thường là phần chốt vấn đề. Một ngày group
 * nói nhiều hơn ngần này thì phần sáng sớm hy sinh — digest là tổng kết, không phải biên bản.
 */
export const TRANSCRIPT_MAX_CHARS = 16_000;
const TRUNCATION_MARKER = "(… đã cắt phần đầu ngày …)\n";

const SYSTEM = [
  "Bạn đọc log MỘT NGÀY chat của một nhóm đại lý với công ty (có nhân viên công ty tham gia).",
  "Nhiệm vụ: tổng kết cho đội kiểm duyệt nội bộ. Rút ra:",
  "",
  "1. van_de: các VẤN ĐỀ được nêu trong ngày (khiếu nại, vướng mắc, yêu cầu chưa xử lý).",
  "2. giai_phap: cách xử lý tương ứng — ai đã trả lời gì, việc gì đã chốt, việc gì CÒN TREO.",
  "3. kb: đề xuất entry knowledge base — CHỈ vấn đề CHÍNH SÁCH/QUY TRÌNH/SLA giữa công ty và",
  "   đại lý nói chung, thứ đáng ghi thành tri thức dùng lại. KHÔNG đưa: chi tiết đơn hàng cụ",
  "   thể, số liệu thương mại riêng của đại lý, chuyện chỉ đúng với một đơn một ngày.",
  "",
  "Entry kb phải ẨN DANH TUYỆT ĐỐI: không tên đại lý, không tên người, không mã đơn — viết",
  '"một số đại lý phản ánh…", "quy trình X đang gây vướng…". Mỗi entry tự đủ nghĩa, một câu gọn.',
  "",
  'CHỈ trả JSON object: {"van_de":["…"],"giai_phap":["…"],"kb":["…"]}. Không văn xuôi ngoài JSON.',
  "Ngày yên ổn không có gì đáng ghi → cả ba mảng rỗng.",
].join("\n");

export class KbDigestExtractor {
  constructor(private readonly provider: LLMProvider) {}

  /**
   * undefined = model hỏng/JSON vỡ — caller đánh dấu lượt failed (khác với extraction rỗng:
   * ngày yên ổn hợp lệ). Không transcript → rỗng luôn, khỏi tốn call.
   */
  async extract(
    messages: readonly KbLoggedMessage[],
    signal?: AbortSignal,
  ): Promise<KbDigestExtraction | undefined> {
    if (messages.length === 0) return { vanDe: [], giaiPhap: [], kb: [] };

    try {
      const result = await this.provider.chat(
        {
          system: singleSystem(SYSTEM),
          messages: [
            { role: "user", content: [{ type: "text", text: renderDayTranscript(messages) }] },
          ],
          tools: [],
          maxTokens: EXTRACT_MAX_TOKENS,
          effort: EXTRACT_EFFORT,
        },
        signal,
      );
      return parseExtraction(extractText(result.content));
    } catch (err) {
      console.error("[kb-digest] rút vấn đề lỗi:", err);
      return undefined;
    }
  }
}

/** Transcript phẳng `HH:MM tên|id: text`, cắt GIỮ ĐUÔI theo trần ký tự. */
export function renderDayTranscript(messages: readonly KbLoggedMessage[]): string {
  const lines = messages.map((m) => `${vnClock(m.ts)} ${m.senderName ?? m.senderId}: ${m.text}`);
  const full = lines.join("\n");
  if (full.length <= TRANSCRIPT_MAX_CHARS) return full;
  return TRUNCATION_MARKER + full.slice(full.length - TRANSCRIPT_MAX_CHARS);
}

/**
 * Parse output model. Chịu được văn xuôi bọc quanh JSON (lấy `{` đầu → `}` cuối). JSON vỡ /
 * không phải object → undefined. Mảng thiếu → rỗng; phần tử không phải string / rỗng → bỏ.
 */
export function parseExtraction(raw: string): KbDigestExtraction | undefined {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;

  const record = parsed as Record<string, unknown>;
  return {
    vanDe: stringList(record.van_de),
    giaiPhap: stringList(record.giai_phap),
    kb: stringList(record.kb),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function extractText(content: readonly LlmContentBlock[]): string {
  return content
    .filter((block): block is Extract<LlmContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}
