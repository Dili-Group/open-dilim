// identity-repo.ts — ghi định danh vào Postgres cho flash-command (user_binding / group_map /
// group_member). Impl của IdentityRepo (port ở flash-command/types.ts): flash-command KHÔNG tự mở
// DB — wiring cấp impl này. Upsert idempotent → gõ lại lệnh không nhân đôi row, giữ vết audit.
//
// SQL raw như resolver.ts (cùng tầng auth); `sql` tagged template auto-parameterize giá trị (chống
// injection). Tên bảng/cột hằng — không tham số hoá được, viết thẳng như resolver.

import { sql } from "../db/client.ts";
import type { IdentityRepo } from "../flash-command/types.ts";
import type { RedisCommand } from "../redis/types.ts";
import { authCacheKey } from "./cached-resolver.ts";
import { firstString } from "./rows.ts";

export class SqlIdentityRepo implements IdentityRepo {
  // Gán/gỡ đại lý đổi vai → xoá cache auth để CachedIdentityResolver không trả vai cũ tới hết TTL.
  constructor(private readonly send: RedisCommand) {}

  /** Upsert (channel, sender_id) → user_id + op_token, clear revoked_at (bind lại sau đổi máy/token). */
  async bindUser(p: {
    channel: string;
    senderId: string;
    userId: string;
    opToken: string;
    roleSlug?: string;
    fullName?: string;
  }): Promise<void> {
    // roleSlug/fullName undefined → NULL trong VALUES, nhưng COALESCE lúc UPDATE giữ giá trị cũ:
    // verify lần sau thiếu field không được xoá tên/vai đã lưu.
    const roleSlug = p.roleSlug ?? null;
    const fullName = p.fullName ?? null;
    await sql`INSERT INTO user_binding
                (channel, sender_id, user_id, op_token, role_slug, full_name, bound_at, revoked_at)
              VALUES (${p.channel}, ${p.senderId}, ${p.userId}, ${p.opToken}, ${roleSlug}, ${fullName}, now(), NULL)
              ON CONFLICT (channel, sender_id) DO UPDATE
                SET user_id = EXCLUDED.user_id,
                    op_token = EXCLUDED.op_token,
                    role_slug = COALESCE(EXCLUDED.role_slug, user_binding.role_slug),
                    full_name = COALESCE(EXCLUDED.full_name, user_binding.full_name),
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
    await this.send("DEL", [authCacheKey(p.channel, p.senderId, p.groupId)]);
  }

  /** Set group_member.revoked_at = now() (kế toán nghỉ). No-op nếu không có row dai_ly active. */
  async revokeDealer(p: { channel: string; groupId: string; senderId: string }): Promise<void> {
    await sql`UPDATE group_member
              SET revoked_at = now()
              WHERE channel = ${p.channel} AND group_id = ${p.groupId}
                AND sender_id = ${p.senderId} AND role = 'dai_ly'
                AND revoked_at IS NULL`;
    await this.send("DEL", [authCacheKey(p.channel, p.senderId, p.groupId)]);
  }

  /** Upsert group_block — có row = nhóm đang bị chặn. Gõ /block lại chỉ đổi ai chặn + thời điểm. */
  async blockGroup(p: { channel: string; groupId: string; blockedBy: string }): Promise<void> {
    await sql`INSERT INTO group_block (channel, group_id, blocked_by, blocked_at)
              VALUES (${p.channel}, ${p.groupId}, ${p.blockedBy}, now())
              ON CONFLICT (channel, group_id) DO UPDATE
                SET blocked_by = EXCLUDED.blocked_by,
                    blocked_at = now()`;
  }

  /** Xoá row group_block (không giữ vết: chặn là trạng thái tạm, không phải quyền). */
  async unblockGroup(p: { channel: string; groupId: string }): Promise<void> {
    await sql`DELETE FROM group_block
              WHERE channel = ${p.channel} AND group_id = ${p.groupId}`;
  }

  /** True = có row group_block. Worker gọi mỗi tin nhóm nhắm agent → query chạy thẳng PK. */
  async isGroupBlocked(p: { channel: string; groupId: string }): Promise<boolean> {
    const groupId = firstString(
      await sql`SELECT group_id FROM group_block
                WHERE channel = ${p.channel} AND group_id = ${p.groupId}
                LIMIT 1`,
      "group_id",
    );
    return groupId !== undefined;
  }
}
