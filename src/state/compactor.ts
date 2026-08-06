// compactor.ts — NÉN hội thoại ngắn hạn (§7). Phần trôi khỏi cửa sổ đọc không biến mất im lặng
// mà cô lại thành một bản tóm cuộn, đứng trước history trong system prompt.
//
// KHÁC đường ghi dài hạn (memory-writer.ts): distiller rút FACT BỀN của KHÁCH và ghi pgvector,
// chạy theo MemoryScope; compactor giữ MẠCH HỘI THOẠI của PHÒNG trên Redis, chạy theo
// conversationId. Phòng chưa `/ketnoi-daily` không có scope nên không distill — nhưng vẫn compact
// được. Đó là lý do hai đường tách nhau, không gộp làm một.
//
// Đầu vào là CẢ BUFFER phòng (HISTORY_BUFFER_TURNS), không phải cửa sổ agent đọc: cửa sổ agent
// chỉ dôi ra 1 entry mỗi lượt nên nén theo nó là bỏ sót gần hết phần trôi. Mốc đã-nén-tới giữ ở
// Redis để không nén lại từ đầu buffer mỗi lượt.
//
// Ngưỡng đo bằng SỐ ENTRY (kèm chốt chặn ký tự), không token: đếm token thật là 1 network call
// count_tokens mỗi lượt (cùng lý do với cap khối memory ở context/memory-block.ts).

import { singleSystem, type LLMProvider } from "../llm/types.ts";
import { HISTORY_WINDOW_TURNS } from "./session.ts";
import type { HistoryEntry } from "../types/index.ts";
import type { RedisCommand } from "../redis/types.ts";

const KEY_PREFIX = "dilim:summary:";
// Tiền tố RIÊNG, không phải `dilim:summary:cursor:` — conversationId là id thô của kênh, nối
// thêm một tầng vào cùng namespace là mở đường cho phòng tên "cursor:x" đè lên cursor phòng khác.
const CURSOR_PREFIX = "dilim:summary-cursor:";

/**
 * Tổng ký tự phần CHƯA NÉN vượt mức này thì nén ngay, kể cả khi chưa đủ `COMPACT_MIN_ENTRIES`.
 * Chốt chặn cho hội thoại ít tin nhưng tin dài (agent trả cả bảng tra cứu): 12k ký tự ≈ 4–5k
 * token tiếng Việt — quá ngần đó mà nhét hết vào một bản tóm sau thì con nhẹ đọc không xuể.
 */
export const COMPACT_TRIGGER_CHARS = 12_000;

/**
 * Số entry đã TRÔI KHỎI cửa sổ đọc mà chưa nén, đủ để bỏ ra một call LLM. Đây mới là ngưỡng
 * thường chạy: chat Zalo tin ngắn (20–200 ký tự) thì ngưỡng ký tự gần như không bao giờ chạm.
 *
 * KHÔNG nén mỗi tin trôi ra (1 call LLM/lượt, bản tóm viết lại liên tục); cũng không để dồn tới
 * sát trần buffer (HISTORY_BUFFER_TURNS) vì entry bị LTRIM đẩy đi trước khi nén là mất thật.
 */
export const COMPACT_MIN_ENTRIES = 10;

/** Số entry cuối GIỮ NGUYÊN VĂN — đúng cửa sổ agent đọc, cùng nguồn hằng để không lệch. */
export const KEEP_RECENT_ENTRIES = HISTORY_WINDOW_TURNS;

/** Trần bản tóm. Bằng cap khối memory: cả hai đều là thứ chen vào trước history mỗi lượt. */
export const SUMMARY_MAX_CHARS = 1_200;

/** Ngưỡng nén — gom lại một chỗ thay vì ba tham số `number` cạnh nhau ở constructor. */
export interface CompactPolicy {
  readonly triggerChars: number;
  readonly minEntries: number;
  readonly keepRecent: number;
}

const DEFAULT_POLICY: CompactPolicy = {
  triggerChars: COMPACT_TRIGGER_CHARS,
  minEntries: COMPACT_MIN_ENTRIES,
  keepRecent: KEEP_RECENT_ENTRIES,
};

/** Bản tóm nguội theo phòng, cùng hạn với buffer history (state/session.ts). */
const TTL_SEC = 7 * 24 * 60 * 60;

function summaryKey(conversationId: string): string {
  return `${KEY_PREFIX}${conversationId}`;
}

function cursorKey(conversationId: string): string {
  return `${CURSOR_PREFIX}${conversationId}`;
}

/** Đọc bản tóm để lắp vào context (bước STATE). Tách khỏi cổng ghi: assembler chỉ cần đọc. */
export interface SummaryReader {
  get(conversationId: string): Promise<string | undefined>;
}

export interface SummaryStore extends SummaryReader {
  /**
   * Ghi bản tóm KÈM mốc đã nén tới (`cursorMsgId` = entry cuối nằm trong bản tóm). Đi cùng nhau
   * chứ không tách hai lời gọi: bản tóm ghi xong mà mốc chưa tiến thì lượt sau nén lại đúng đoạn
   * vừa nén, bản tóm phình bằng chính nội dung của nó.
   */
  set(conversationId: string, summary: string, cursorMsgId: string): Promise<void>;
  /** msgId cuối đã nằm trong bản tóm. undefined = chưa nén lần nào (hoặc mốc đã hết hạn). */
  getCursor(conversationId: string): Promise<string | undefined>;
}

/**
 * Nén hội thoại sau lượt. Gọi mỗi lượt với CẢ BUFFER phòng (không phải cửa sổ agent đọc); impl
 * tự quyết định lượt này có nén thật hay không.
 */
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

  async set(conversationId: string, summary: string, cursorMsgId: string): Promise<void> {
    await this.send("SET", [summaryKey(conversationId), summary, "EX", String(TTL_SEC)]);
    await this.send("SET", [cursorKey(conversationId), cursorMsgId, "EX", String(TTL_SEC)]);
  }

  async getCursor(conversationId: string): Promise<string | undefined> {
    const raw = await this.send("GET", [cursorKey(conversationId)]);
    return typeof raw === "string" && raw !== "" ? raw : undefined;
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
 * Nhận CẢ BUFFER phòng (HISTORY_BUFFER_TURNS), không phải cửa sổ 20 tin của agent: cửa sổ agent
 * chỉ dôi ra đúng 1 entry mỗi lượt, nên nén theo nó thì tin trôi khỏi vị trí thứ 20 không bao giờ
 * được nhìn lại — mất im lặng, đúng thứ tầng nén sinh ra để chặn.
 *
 * Mốc `cursor` (msgId cuối đã nén) giữ ở Redis vì buffer được đọc lại nguyên vẹn mỗi lượt: không
 * có mốc thì lần nào cũng nén lại từ đầu buffer, bản tóm bị viết đè bằng chính nội dung cũ.
 *
 * Best-effort: lỗi provider trả về lặng lẽ (log) thay vì throw — mất một nhịp nén chỉ làm ngữ cảnh
 * cũ thưa đi, không được phép làm hỏng lượt đã trả lời xong.
 */
export class LlmCompactor implements ConversationCompactor {
  private readonly policy: CompactPolicy;

  constructor(
    private readonly provider: LLMProvider,
    private readonly store: SummaryStore,
    policy: Partial<CompactPolicy> = {},
  ) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  async afterTurn(
    conversationId: string,
    entries: readonly HistoryEntry[],
    signal?: AbortSignal,
  ): Promise<void> {
    const pending = await this.pendingSince(conversationId, entries);
    // Phần đã trôi khỏi cửa sổ đọc của agent. Rỗng = chưa tin nào rơi ra → chưa có gì để nén.
    const older = pending.slice(0, -this.policy.keepRecent);
    const last = older.at(-1);
    if (last === undefined) return;
    if (older.length < this.policy.minEntries && totalChars(older) < this.policy.triggerChars) {
      return;
    }

    const previous = await this.store.get(conversationId);
    const summary = await this.summarize(previous, older, signal);
    // Nén hỏng → KHÔNG tiến mốc: đoạn này vẫn còn trong buffer, lượt sau nén lại.
    if (summary === "") return;

    await this.store.set(conversationId, summary.slice(0, SUMMARY_MAX_CHARS), last.msgId);
  }

  /**
   * Phần buffer chưa nằm trong bản tóm. Mốc không tìm thấy trong buffer = entry đó đã bị LTRIM
   * đẩy đi → mọi entry còn lại đều mới hơn mốc, xử như chưa nén (giống trường hợp mốc rỗng).
   */
  private async pendingSince(
    conversationId: string,
    entries: readonly HistoryEntry[],
  ): Promise<readonly HistoryEntry[]> {
    const cursor = await this.store.getCursor(conversationId);
    if (cursor === undefined) return entries;
    const idx = entries.findIndex((entry) => entry.msgId === cursor);
    return idx === -1 ? entries : entries.slice(idx + 1);
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
