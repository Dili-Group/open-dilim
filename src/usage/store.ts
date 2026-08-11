// store.ts — sổ cái chi phí LLM. Postgres là NGUỒN SỰ THẬT, Redis chỉ là bộ đếm nóng.
//
// Vì sao hai tầng: gate chạy trước MỌI lượt nên phải rẻ (một GET Redis), nhưng Redis là bộ nhớ
// tạm — mất nó mà không có sổ cái thì mọi phòng reset hạn mức về 0 và cả ngày hôm đó tiêu thoải
// mái. Redis miss → dựng lại bằng SUM trên sổ cái.
//
// THỨ TỰ GHI: Postgres trước, Redis sau. Ngược lại (Redis trước) mà Postgres hỏng thì lần dựng
// lại sau sẽ TỤT con số xuống — cho không tiền đúng lúc hệ đang trục trặc.

import type { RedisCommand } from "../redis/types.ts";
import { costPicoUsd } from "./pricing.ts";
import { secondsUntilNextDay, usageDay } from "./budget.ts";
import type { UsageEntry, UsagePort } from "./types.ts";

/**
 * Chỉ phần Bun.sql mà store thật sự dùng: chạy tagged template, trả về các hàng. Hẹp lại thay vì
 * nhận cả `SQL` để test dựng được fake — và để rõ store CHỈ query, không mở transaction/pool.
 *
 * `unknown` chứ không phải mảng row có kiểu: reply của driver là biên untrusted, narrow tại chỗ.
 */
export type SqlRunner = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

const KEY_PREFIX = "dilim:cost:";

function counterKey(conversationId: string, day: string): string {
  return `${KEY_PREFIX}${conversationId}:${day}`;
}

export class SqlUsageStore implements UsagePort {
  constructor(
    private readonly sql: SqlRunner,
    private readonly send: RedisCommand,
  ) {}

  async spentTodayPicoUsd(conversationId: string): Promise<number> {
    const day = usageDay();
    const key = counterKey(conversationId, day);

    const cached = parseCounter(await this.send("GET", [key]));
    if (cached !== undefined) return cached;

    // Miss = key hết hạn (sang ngày mới) hoặc Redis vừa mất. Cả hai đều dựng lại từ sổ cái:
    // ngày mới thì SUM trả 0, Redis mất thì SUM trả đúng phần đã tiêu.
    const total = await this.sumFromLedger(conversationId, day);
    await this.send("SET", [key, String(total), "EX", String(secondsUntilNextDay())]);
    return total;
  }

  async record(entry: UsageEntry): Promise<void> {
    const day = usageDay();
    const cost = costPicoUsd(entry.usage);
    const u = entry.usage;

    // ON CONFLICT DO NOTHING + RETURNING: hàng trả về rỗng = msgId đã ghi rồi (broker giao lại)
    // → KHÔNG cộng bộ đếm lần hai. Đây là toàn bộ cơ chế idempotent, không cần khoá.
    const inserted = await this.sql`
      INSERT INTO llm_usage_log (
        conversation_id, agent_type, msg_id, usage_day,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_pico_usd
      ) VALUES (
        ${entry.conversationId}, ${entry.agentType}, ${entry.msgId}, ${day},
        ${u.input}, ${u.output}, ${u.cacheRead}, ${u.cacheWrite}, ${cost}
      )
      ON CONFLICT (msg_id) DO NOTHING
      RETURNING id
    `;
    if (!Array.isArray(inserted) || inserted.length === 0) return;

    const key = counterKey(entry.conversationId, day);
    const after = parseCounter(await this.send("INCRBY", [key, String(cost)]));
    // INCRBY trên key chưa tồn tại tự tạo key KHÔNG có TTL → phải set. Chỉ set khi giá trị sau
    // khi cộng đúng bằng phần vừa cộng, tức key vừa được tạo: đặt TTL mỗi lượt sẽ đẩy mốc hết
    // hạn trôi qua nửa đêm, hạn mức không bao giờ reset.
    if (after === cost) {
      await this.send("EXPIRE", [key, String(secondsUntilNextDay())]);
    }
  }

  /**
   * SUM(bigint) trong Postgres trả về `numeric`, mà driver đưa numeric về STRING để khỏi mất
   * chính xác → ép `::bigint` rồi vẫn phải narrow tay. Không tin thẳng kiểu trả về.
   */
  private async sumFromLedger(conversationId: string, day: string): Promise<number> {
    const rows = await this.sql`
      SELECT COALESCE(SUM(cost_pico_usd), 0)::bigint AS total
      FROM llm_usage_log
      WHERE conversation_id = ${conversationId} AND usage_day = ${day}
    `;
    if (!Array.isArray(rows) || rows.length === 0) return 0;
    const raw: unknown = (rows[0] as Record<string, unknown>)["total"];
    return toFiniteNumber(raw) ?? 0;
  }
}

/** Reply Redis là untrusted (string | number | null) → narrow trước khi dùng làm tiền. */
function parseCounter(reply: unknown): number | undefined {
  return toFiniteNumber(reply);
}

function toFiniteNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "bigint") return Number(raw);
  if (typeof raw === "string" && raw !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
