// rooms.ts — quét `group_map` ra danh sách nhóm đại lý sẽ nhận tin phát chung.
// Query dùng tagged template `sql` → auto-parameterize (chống injection).

import { sql } from "../db/client.ts";
import type { DealerRoom, DealerRoomLookup } from "./types.ts";

export class SqlDealerRoomLookup implements DealerRoomLookup {
  /**
   * Ba điều kiện, mỗi cái chặn một kiểu gửi sai:
   *
   *  1. `enabled = true` — nhóm đã gỡ binding thì không còn là nhóm đại lý.
   *  2. `NOT EXISTS group_block` — nhóm đã `/block` là nhóm vận hành CỐ Ý tắt agent; bơm tin
   *     phát chung vào đó là đi vòng qua quyết định đó. Bảng tách riêng nên `enabled` không phủ.
   *  3. `DISTINCT ON (customer_id)` — một đại lý có thể có nhiều nhóm (nhóm cũ chưa gỡ, nhóm ở
   *     kênh khác; xem auth/group-customer.ts). Không gộp thì họ nhận hai ba bản cùng một tin.
   *     Lấy nhóm `updated_at` mới nhất, khớp đúng lựa chọn của `SqlCustomerRoomLookup.roomOf`.
   */
  async allEnabled(): Promise<readonly DealerRoom[]> {
    const rows: unknown = await sql`SELECT DISTINCT ON (gm.customer_id)
                                      gm.channel, gm.group_id, gm.customer_id
                                    FROM group_map gm
                                    WHERE gm.enabled = true
                                      AND NOT EXISTS (
                                        SELECT 1 FROM group_block gb
                                        WHERE gb.channel = gm.channel
                                          AND gb.group_id = gm.group_id
                                      )
                                    ORDER BY gm.customer_id, gm.updated_at DESC`;
    if (!Array.isArray(rows)) return [];

    const out: DealerRoom[] = [];
    for (const row of rows) {
      const room = toDealerRoom(row);
      // Row thiếu cột / sai kiểu thì BỎ QUA chứ không throw: một row rác không được làm hỏng cả
      // đợt phát. Nhưng phải log — nhóm biến mất khỏi danh sách một cách im lặng là lỗi vô hình.
      if (room === undefined) {
        console.error("[announcements] bỏ qua row group_map sai shape:", row);
        continue;
      }
      out.push(room);
    }
    return out;
  }
}

/** Narrow một row DB (`unknown`) → DealerRoom. Thiếu bất kỳ cột nào → undefined. */
function toDealerRoom(row: unknown): DealerRoom | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const rec = row as Record<string, unknown>;
  const channel = rec["channel"];
  const groupId = rec["group_id"];
  const customerId = rec["customer_id"];
  if (typeof channel !== "string" || typeof groupId !== "string" || typeof customerId !== "string") {
    return undefined;
  }
  return { channel, groupId, customerId };
}
