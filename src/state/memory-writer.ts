// memory-writer.ts — ĐƯỜNG GHI trí nhớ dài hạn (§7). Nối ngắn hạn → dài hạn: gom N lượt trong
// buffer Redis, chưng cất bằng con nhẹ, embed rồi ghi pgvector.
//
// Vì sao THEO LÔ chứ không mỗi lượt: distill 1 lượt lẻ ra fact vụn ("ok anh"), tốn 1 call LLM +
// 1 call embed cho mỗi tin. Gom lô vừa rẻ vừa cho model đủ ngữ cảnh để rút fact tự-đủ-nghĩa.
// Bộ đếm nằm ở Redis (không phải biến in-mem) vì nhiều worker process cùng phục vụ một phòng.

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

const KEY_PREFIX = "dilim:distill:";

/**
 * Số lượt NGƯỜI DÙNG tích luỹ thì chưng cất một lần. 6 ≈ một nhịp trao đổi trọn vẹn (hỏi → làm rõ
 * → chốt) — đủ để có fact đáng nhớ, chưa đủ lâu để khách chốt xong rồi agent quên mất.
 */
export const DISTILL_EVERY_TURNS = 6;

/**
 * Số turn transcript đưa vào distiller mỗi lần. Rộng hơn ngưỡng trên (gồm cả lượt agent trả và
 * phần đuôi của lô trước) để fact rút ra không bị cụt ngữ cảnh. Phải ≤ HISTORY_WINDOW_TURNS (session.ts).
 */
export const DISTILL_WINDOW_TURNS = 12;

/** Phòng ngừng nói thì bộ đếm dở tự hết — đếm cũ không còn ý nghĩa cho hội thoại mới. */
const COUNTER_TTL_SEC = 24 * 60 * 60;

function counterKey(scope: MemoryScope): string {
  return `${KEY_PREFIX}${scope.channel}:${scope.conversationId}`;
}

/** Đếm lượt chờ chưng cất mỗi phòng. Tách interface để test không cần Redis. */
export interface DistillCounter {
  /** +1 và trả số lượt đang tích luỹ (đã gồm lượt này). */
  bump(scope: MemoryScope): Promise<number>;
  reset(scope: MemoryScope): Promise<void>;
}

export class RedisDistillCounter implements DistillCounter {
  constructor(private readonly send: RedisCommand) {}

  async bump(scope: MemoryScope): Promise<number> {
    const key = counterKey(scope);
    const reply = await this.send("INCR", [key]);
    await this.send("EXPIRE", [key, String(COUNTER_TTL_SEC)]);
    // INCR trả integer; client có thể đưa về string → narrow tại biên, không tin blind.
    const value = typeof reply === "number" ? reply : Number(reply);
    return Number.isFinite(value) ? value : 0;
  }

  async reset(scope: MemoryScope): Promise<void> {
    await this.send("DEL", [counterKey(scope)]);
  }
}

/**
 * Ghi trí nhớ dài hạn theo lô. Gọi sau MỖI lượt; chỉ lượt thứ `everyTurns` mới thật sự chạy
 * distill + embed, còn lại chỉ tăng bộ đếm (2 lệnh Redis).
 *
 * KHÔNG nuốt lỗi: distill lỗi tự trả [] (best-effort trong LlmDistiller), nhưng lỗi ghi DB/embed
 * ném ra cho worker log — worker đã broadcast reply trước đó nên lượt của khách không hỏng.
 */
export class BatchedMemoryWriter implements MemoryWriter {
  constructor(
    private readonly store: MemoryStore,
    private readonly distiller: Distiller,
    private readonly counter: DistillCounter,
    private readonly everyTurns: number = DISTILL_EVERY_TURNS,
    private readonly windowTurns: number = DISTILL_WINDOW_TURNS,
  ) {}

  async afterTurn(
    scope: MemoryScope,
    turns: readonly DistillTurn[],
    sourceMsgId: string,
    signal?: AbortSignal,
  ): Promise<number> {
    const pending = await this.counter.bump(scope);
    if (pending < this.everyTurns) return 0;

    // Reset TRƯỚC khi chưng cất: distill hỏng thì lô sau vẫn đếm lại từ đầu, không dồn ứ để rồi
    // lần nào cũng chạy (mỗi lượt một call LLM) khi model đang lỗi.
    await this.counter.reset(scope);

    const window = turns.slice(-this.windowTurns);
    if (window.length === 0) return 0;
    const facts = await this.distiller.distill(window, signal);
    if (facts.length === 0) return 0;
    return await this.store.write(scope, facts, sourceMsgId, signal);
  }
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
