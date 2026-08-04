// resolver.ts — resolve senderId → vai qua Postgres (design §5 L303-307, dừng ở match đầu):
//   1. user_binding active            → nhân viên (userId)
//   2. group_member role=dai_ly active + group_map enabled → đại lý (customerId derive group_map)
//   3. còn lại                        → guest
// Query dùng tagged template `sql` → auto-parameterize (chống injection). Bảng rỗng → guest.

import { sql } from "../db/client.ts";
import type { Identity } from "../flash-command/types.ts";
import type { IdentityResolver, ResolveInput } from "./types.ts";

export class SqlIdentityResolver implements IdentityResolver {
  async resolve({ channel, senderId, groupId }: ResolveInput): Promise<Identity> {
    const userId = firstString(
      await sql`SELECT user_id FROM user_binding
                WHERE channel = ${channel} AND sender_id = ${senderId}
                  AND revoked_at IS NULL
                LIMIT 1`,
      "user_id",
    );
    if (userId !== undefined) return { role: "nhan_vien", senderId, userId };

    if (groupId !== undefined) {
      const role = firstString(
        await sql`SELECT role FROM group_member
                  WHERE channel = ${channel} AND group_id = ${groupId}
                    AND sender_id = ${senderId} AND role = 'dai_ly'
                    AND revoked_at IS NULL
                  LIMIT 1`,
        "role",
      );
      if (role !== undefined) {
        const customerId = firstString(
          await sql`SELECT customer_id FROM group_map
                    WHERE channel = ${channel} AND group_id = ${groupId} AND enabled = true
                    LIMIT 1`,
          "customer_id",
        );
        // Đại lý cần cả membership dai_ly VÀ group_map enabled để derive customerId.
        if (customerId !== undefined) return { role: "dai_ly", senderId, customerId };
      }
    }

    return { role: "guest", senderId };
  }
}

/** Lấy string ở cột `key` của row đầu. Rows là kết quả query (untrusted shape) → narrow runtime. */
function firstString(rows: unknown, key: string): string | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const row: unknown = rows[0];
  if (typeof row !== "object" || row === null) return undefined;
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
