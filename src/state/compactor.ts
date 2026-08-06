// compactor.ts — NÉN hội thoại ngắn hạn (§7). Phần trôi khỏi cửa sổ đọc không biến mất im lặng
// mà cô lại thành một bản tóm cuộn, đứng trước history trong system prompt.
//
// KHÁC đường ghi dài hạn (memory-writer.ts): distiller rút FACT BỀN của KHÁCH và ghi pgvector,
// chạy theo MemoryScope; compactor giữ MẠCH HỘI THOẠI của PHÒNG trên Redis, chạy theo
// conversationId. Phòng chưa `/ketnoi-daily` không có scope nên không distill — nhưng vẫn compact
// được. Đó là lý do hai đường tách nhau, không gộp làm một.
//
// Ngưỡng đo bằng KÝ TỰ, không token: đếm token thật là 1 network call count_tokens mỗi lượt
// (cùng lý do với cap khối memory ở context/memory-block.ts).

import { singleSystem, type LLMProvider } from "../llm/types.ts";
import type { HistoryEntry } from "../types/index.ts";
import type { RedisCommand } from "../redis/types.ts";

const KEY_PREFIX = "dilim:summary:";

/**
 * Tổng ký tự cửa sổ hội thoại vượt mức này thì nén. ~12k ký tự ≈ 4–5k token tiếng Việt.
 *
 * KHÔNG chọn theo trần context của model: agent chạy Opus 4.8 (1M token) nên trần model còn cách
 * vài trăm lần — lấy ngưỡng theo đó thì compact không bao giờ chạy. Ngưỡng này chọn theo CHI PHÍ:
 * mỗi lượt gửi lại toàn bộ cửa sổ, nên cửa sổ phình là trả tiền cho model đọc lại chuyện phiếm.
 * Thấp hơn ~8k thì compact chạy quá dày, mỗi lần một call LLM cho một nhúm tin.
 */
export const COMPACT_TRIGGER_CHARS = 12_000;

/** Số entry cuối GIỮ NGUYÊN VĂN — khớp cửa sổ đọc của worker (HISTORY_LIMIT). */
export const KEEP_RECENT_ENTRIES = 20;

/** Trần bản tóm. Bằng cap khối memory: cả hai đều là thứ chen vào trước history mỗi lượt. */
export const SUMMARY_MAX_CHARS = 1_200;

/** Bản tóm nguội theo phòng, cùng hạn với buffer history (state/session.ts). */
const TTL_SEC = 7 * 24 * 60 * 60;

function summaryKey(conversationId: string): string {
  return `${KEY_PREFIX}${conversationId}`;
}

/** Đọc bản tóm để lắp vào context (bước STATE). Tách khỏi cổng ghi: assembler chỉ cần đọc. */
export interface SummaryReader {
  get(conversationId: string): Promise<string | undefined>;
}

export interface SummaryStore extends SummaryReader {
  set(conversationId: string, summary: string): Promise<void>;
}

/** Nén cửa sổ hội thoại sau lượt. Gọi mỗi lượt; tự quyết định lượt này có nén thật hay không. */
export interface ConversationCompactor {
  afterTurn(
    conversationId: string,
    entries: readonly HistoryEntry[],
    signal?: AbortSignal,
  ): Promise<void>;
}

export class RedisSummaryStore implements SummaryStore {
  constructor(private readonly send: RedisCommand) {}

  async get(conversationId: string): Promise<string | undefined> {
    const raw = await this.send("GET", [summaryKey(conversationId)]);
    return typeof raw === "string" && raw !== "" ? raw : undefined;
  }

  async set(conversationId: string, summary: string): Promise<void> {
    await this.send("SET", [summaryKey(conversationId), summary, "EX", String(TTL_SEC)]);
  }
}

const SYSTEM_PROMPT = [
  "Bạn là bộ nén hội thoại. Viết lại phần hội thoại CŨ thành một bản tóm ngắn để trợ lý đọc",
  "trước khi trả lời tiếp — người dùng KHÔNG đọc bản này.",
  "",
  "Giữ: việc đang làm dở và ai chờ ai, dữ kiện đã chốt (số, ngày, tên, mã đơn), yêu cầu chưa xong,",
  "quyết định đã ra. Ghi rõ AI nói gì — bản tóm mất chủ ngữ là bản tóm hỏng.",
  "BỎ: câu xã giao, nội dung tool trả thô, thứ đã có trong phần hội thoại gần đây.",
  "",
  "Có bản tóm trước thì GỘP vào, không viết nối tiếp thành hai đoạn rời.",
  `Viết văn xuôi liền mạch, dưới ${SUMMARY_MAX_CHARS} ký tự. Không bịa. Chỉ trả bản tóm.`,
].join("\n");

/**
 * Nén bằng con nhẹ (MEMORY_MODEL). Chạy SAU khi đã broadcast reply nên chậm cũng không ai chờ.
 *
 * Best-effort: lỗi provider trả về lặng lẽ (log) thay vì throw — mất một nhịp nén chỉ làm ngữ cảnh
 * cũ thưa đi, không được phép làm hỏng lượt đã trả lời xong.
 */
export class LlmCompactor implements ConversationCompactor {
  constructor(
    private readonly provider: LLMProvider,
    private readonly store: SummaryStore,
    private readonly triggerChars: number = COMPACT_TRIGGER_CHARS,
    private readonly keepRecent: number = KEEP_RECENT_ENTRIES,
  ) {}

  async afterTurn(
    conversationId: string,
    entries: readonly HistoryEntry[],
    signal?: AbortSignal,
  ): Promise<void> {
    if (totalChars(entries) < this.triggerChars) return;

    // Phần sắp trôi khỏi cửa sổ đọc. Rỗng = cửa sổ dài nhưng toàn tin gần đây → chưa có gì để nén.
    const older = entries.slice(0, -this.keepRecent);
    if (older.length === 0) return;

    const previous = await this.store.get(conversationId);
    const summary = await this.summarize(previous, older, signal);
    if (summary === "") return;

    await this.store.set(conversationId, summary.slice(0, SUMMARY_MAX_CHARS));
  }

  private async summarize(
    previous: string | undefined,
    older: readonly HistoryEntry[],
    signal?: AbortSignal,
  ): Promise<string> {
    const sections = previous === undefined ? [] : [`BẢN TÓM TRƯỚC:\n${previous}\n`];
    sections.push(`HỘI THOẠI CŨ:\n${renderEntries(older)}`);

    try {
      const result = await this.provider.chat(
        {
          system: singleSystem(SYSTEM_PROMPT),
          messages: [{ role: "user", content: [{ type: "text", text: sections.join("\n") }] }],
          tools: [],
          // Trần output theo trần bản tóm (ký tự → token, ước lượng rộng tay để không cắt giữa câu).
          maxTokens: 1024,
          effort: "low",
        },
        signal,
      );
      return extractText(result.content);
    } catch (err) {
      console.error("[state] nén hội thoại lỗi:", err);
      return "";
    }
  }
}

function totalChars(entries: readonly HistoryEntry[]): number {
  let sum = 0;
  for (const entry of entries) sum += entry.text.length;
  return sum;
}

/** Lượt agent hiện tên "agent"; lượt người dùng giữ senderId để bản tóm biết ai nói gì. */
function renderEntries(entries: readonly HistoryEntry[]): string {
  return entries
    .filter((entry) => entry.text.trim() !== "")
    .map((entry) => `[${entry.role === "agent" ? "agent" : entry.senderId}] ${entry.text}`)
    .join("\n");
}

function extractText(content: readonly { type: string }[]): string {
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}
