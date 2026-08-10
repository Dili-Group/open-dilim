// memory-writer.ts — ĐƯỜNG GHI trí nhớ dài hạn (§7). Nối ngắn hạn → dài hạn: chưng cất phần
// hội thoại chưa chưng cất, embed rồi ghi pgvector.
//
// KÍCH HOẠT theo ĐỔI NGƯỜI NÓI, không theo số lượt cố định: một người nói 5 câu rồi người khác
// đáp lại một câu — chỗ đó mới là một nhịp trao đổi trọn vẹn, và fact đáng nhớ nằm ở nhịp đó.
// Đếm cứng 6 lượt thì cắt ngang giữa lượt độc thoại, rút ra fact cụt.
//
// Ai phát hiện đổi người nói: ingest (nơi duy nhất thấy MỌI tin, kể cả tin không nhắm agent) —
// xem message-ingest/gateway.ts. File này chỉ giữ CHỐT CUỐI: phần chưa chưng cất có đủ dài không.
//
// Cursor (msgId đã chưng cất tới) nằm ở Redis, không phải biến in-mem: nhiều worker process cùng
// phục vụ một phòng. Cùng cơ chế với cursor của compactor, khác key.

import type { HistoryEntry } from "../types/index.ts";
import type { RedisCommand } from "../redis/types.ts";
import type {
  Distiller,
  DistillSpec,
  DistillTurn,
  MemoryScope,
  MemoryStore,
  MemoryWriter,
  MemoryWriterLookup,
} from "./types.ts";

const KEY_PREFIX = "dilim:distill-cursor:";

/**
 * Số tin CHƯA chưng cất tối thiểu thì mới chạy. Chặn trường hợp hai người đối đáp một câu một
 * (A → B → A): mỗi tin là một lần đổi người nói, không có ngưỡng thì mỗi tin một call LLM.
 * 3 = đủ để có một trao đổi có nội dung, chưa đủ để bỏ sót nhịp ngắn.
 */
export const DISTILL_MIN_PENDING = 3;

/**
 * Số turn transcript đưa vào distiller. Rộng hơn phần pending (gồm cả đuôi lô trước) để fact rút
 * ra không bị cụt ngữ cảnh. Phải ≤ HISTORY_WINDOW_TURNS (session.ts).
 */
export const DISTILL_WINDOW_TURNS = 12;

/** Phòng ngừng nói thì cursor tự hết hạn — hội thoại mới coi như chưa chưng cất gì. */
const CURSOR_TTL_SEC = 7 * 24 * 60 * 60;

function cursorKey(scope: MemoryScope): string {
  return `${KEY_PREFIX}${scope.channel}:${scope.conversationId}`;
}

/** Vạch "đã chưng cất tới đâu" mỗi phòng. Tách interface để test không cần Redis. */
export interface DistillCursor {
  /** msgId cuối đã chưng cất. undefined = chưa từng chưng cất phòng này. */
  get(scope: MemoryScope): Promise<string | undefined>;
  set(scope: MemoryScope, msgId: string): Promise<void>;
}

export class RedisDistillCursor implements DistillCursor {
  constructor(private readonly send: RedisCommand) {}

  async get(scope: MemoryScope): Promise<string | undefined> {
    const reply = await this.send("GET", [cursorKey(scope)]);
    return typeof reply === "string" && reply !== "" ? reply : undefined;
  }

  async set(scope: MemoryScope, msgId: string): Promise<void> {
    await this.send("SET", [cursorKey(scope), msgId, "EX", String(CURSOR_TTL_SEC)]);
  }
}

/**
 * Chưng cất phần hội thoại CHƯA chưng cất. Gọi khi ingest thấy đổi người nói, và ở cuối lượt agent
 * (agent trả lời = một người khác vừa lên tiếng).
 *
 * KHÔNG nuốt lỗi: distill lỗi tự trả [] (best-effort trong LlmDistiller), nhưng lỗi ghi DB/embed
 * ném ra cho worker log — worker đã broadcast reply trước đó nên lượt của khách không hỏng.
 */
export class TurnoverMemoryWriter implements MemoryWriter {
  constructor(
    private readonly store: MemoryStore,
    private readonly distiller: Distiller,
    private readonly cursor: DistillCursor,
    private readonly minPending: number = DISTILL_MIN_PENDING,
    private readonly windowTurns: number = DISTILL_WINDOW_TURNS,
  ) {}

  async afterTurn(
    scope: MemoryScope,
    entries: readonly HistoryEntry[],
    signal?: AbortSignal,
  ): Promise<number> {
    const cursorMsgId = await this.cursor.get(scope);
    const pending = pendingSince(entries, cursorMsgId);
    if (pending.length < this.minPending) return 0;

    const last = entries.at(-1);
    if (last === undefined) return 0;

    // Đặt cursor TRƯỚC khi chưng cất: distill hỏng thì lần sau tính lại từ đây, không dồn ứ để rồi
    // lần nào cũng chạy (mỗi tin một call LLM) trong lúc model đang lỗi.
    await this.cursor.set(scope, last.msgId);

    // Transcript rộng hơn phần pending: fact cần ngữ cảnh trước đó mới tự đứng được.
    const turns = toDistillTurns(entries.slice(-this.windowTurns));
    if (turns.length === 0) return 0;
    const facts = await this.distiller.distill(turns, signal);
    if (facts.length === 0) return 0;
    return await this.store.write(scope, facts, last.msgId, signal);
  }
}

/**
 * Phần history nằm SAU cursor. Cursor không còn trong cửa sổ (phòng nói nhiều, tin cũ đã trôi) →
 * coi như cả cửa sổ là pending: thà chưng cất lại phần chồng lấn còn hơn bỏ mất một nhịp.
 */
function pendingSince(
  entries: readonly HistoryEntry[],
  cursorMsgId: string | undefined,
): readonly HistoryEntry[] {
  if (cursorMsgId === undefined) return entries;
  const at = entries.findIndex((entry) => entry.msgId === cursorMsgId);
  return at === -1 ? entries : entries.slice(at + 1);
}

/** History phòng → transcript cho distiller. Entry rỗng bị bỏ (không có gì để chưng cất). */
/**
 * Map agentType → writer của agent đó. Agent nhớ khác nhau (DistillSpec khác) thì phải ghi bằng
 * writer khác — spec đóng cứng vào distiller nên KHÔNG đổi được lúc chạy.
 *
 * Hai agent khai CÙNG một spec (vận hành và lãnh đạo cùng `internalOpsSpec`) thì dùng chung một
 * writer: dựng hai distiller y hệt chỉ tốn kết nối, không thêm hành vi nào.
 *
 * `build` truyền vào thay vì gọi thẳng `buildMemoryWriter` để file này không phải kéo theo
 * Redis/LLM provider — test dựng registry bằng writer giả.
 */
export class MemoryWriterRegistry implements MemoryWriterLookup {
  private readonly byAgentType = new Map<string, MemoryWriter>();

  constructor(specs: ReadonlyMap<string, DistillSpec>, build: (spec: DistillSpec) => MemoryWriter) {
    const bySpec = new Map<DistillSpec, MemoryWriter>();
    for (const [agentType, spec] of specs) {
      let writer = bySpec.get(spec);
      if (writer === undefined) {
        writer = build(spec);
        bySpec.set(spec, writer);
      }
      this.byAgentType.set(agentType, writer);
    }
  }

  for(agentType: string): MemoryWriter | undefined {
    return this.byAgentType.get(agentType);
  }
}

export function toDistillTurns(entries: readonly HistoryEntry[]): DistillTurn[] {
  const turns: DistillTurn[] = [];
  for (const entry of entries) {
    if (entry.text.trim() === "") continue;
    turns.push({
      senderId: entry.senderId,
      role: entry.role === "agent" ? "assistant" : "user",
      text: entry.text,
    });
  }
  return turns;
}
