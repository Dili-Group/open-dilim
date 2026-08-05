// identity-repo.ts — ghi định danh vào Postgres cho flash-command (user_binding / group_map /
// group_member). Impl của IdentityRepo (port ở flash-command/types.ts): flash-command KHÔNG tự mở
// DB — wiring cấp impl này. Upsert idempotent → gõ lại lệnh không nhân đôi row, giữ vết audit.
//
// SQL raw như resolver.ts (cùng tầng auth); `sql` tagged template auto-parameterize giá trị (chống
// injection). Tên bảng/cột hằng — không tham số hoá được, viết thẳng như resolver.

import { sql } from "../db/client.ts";
import type { IdentityRepo } from "../flash-command/types.ts";
import { firstString } from "./rows.ts";

export class SqlIdentityRepo implements IdentityRepo {
  /** Upsert (channel, sender_id) → user_id + op_token, clear revoked_at (bind lại sau đổi máy/token). */
  async bindUser(p: {
    channel: string;
    senderId: string;
    userId: string;
    opToken: string;
  }): Promise<void> {
    await sql`INSERT INTO user_binding (channel, sender_id, user_id, op_token, bound_at, revoked_at)
              VALUES (${p.channel}, ${p.senderId}, ${p.userId}, ${p.opToken}, now(), NULL)
              ON CONFLICT (channel, sender_id) DO UPDATE
                SET user_id = EXCLUDED.user_id,
                    op_token = EXCLUDED.op_token,
                    bound_at = now(),
                    revoked_at = NULL`;
  }

  /** True nếu (channel, sender_id) đang là nhân viên active (user_binding revoked_at IS NULL). */
  async isBoundUser(p: { channel: string; senderId: string }): Promise<boolean> {
    const userId = firstString(
      await sql`SELECT user_id FROM user_binding
                WHERE channel = ${p.channel} AND sender_id = ${p.senderId}
                  AND revoked_at IS NULL
                LIMIT 1`,
      "user_id",
    );
    return userId !== undefined;
  }

  /** Bearer hệ vận hành của nhân viên active. null = chưa bind / đã revoke / op_token trống. */
  async getOpToken(p: { channel: string; senderId: string }): Promise<string | null> {
    const token = firstString(
      await sql`SELECT op_token FROM user_binding
                WHERE channel = ${p.channel} AND sender_id = ${p.senderId}
                  AND revoked_at IS NULL
                LIMIT 1`,
      "op_token",
    );
    return token ?? null;
  }

  /** Upsert (channel, group_id) → customer_id, enabled=true. customer_id inject server-side. */
  async upsertGroupMap(p: { channel: string; groupId: string; customerId: string }): Promise<void> {
    await sql`INSERT INTO group_map (channel, group_id, customer_id, enabled, created_at, updated_at)
              VALUES (${p.channel}, ${p.groupId}, ${p.customerId}, true, now(), now())
              ON CONFLICT (channel, group_id) DO UPDATE
                SET customer_id = EXCLUDED.customer_id,
                    enabled = true,
                    updated_at = now()`;
  }

  /** Upsert group_member role=dai_ly active. `assignedBy` = user_id nhân viên gán (audit). */
  async assignDealer(p: {
    channel: string;
    groupId: string;
    senderId: string;
    assignedBy: string;
  }): Promise<void> {
    await sql`INSERT INTO group_member (channel, group_id, sender_id, role, assigned_by, assigned_at, revoked_at)
              VALUES (${p.channel}, ${p.groupId}, ${p.senderId}, 'dai_ly', ${p.assignedBy}, now(), NULL)
              ON CONFLICT (channel, group_id, sender_id) DO UPDATE
                SET role = 'dai_ly',
                    assigned_by = EXCLUDED.assigned_by,
                    assigned_at = now(),
                    revoked_at = NULL`;
  }

  /** Set group_member.revoked_at = now() (kế toán nghỉ). No-op nếu không có row dai_ly active. */
  async revokeDealer(p: { channel: string; groupId: string; senderId: string }): Promise<void> {
    await sql`UPDATE group_member
              SET revoked_at = now()
              WHERE channel = ${p.channel} AND group_id = ${p.groupId}
                AND sender_id = ${p.senderId} AND role = 'dai_ly'
                AND revoked_at IS NULL`;
  }
}
