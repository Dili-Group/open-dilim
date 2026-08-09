// resolver.ts — resolve senderId → vai qua Postgres (design §5 L303-307, dừng ở match đầu):
//   1. user_binding active            → nhân viên (userId)
//   2. group_member role=dai_ly active + group_map enabled → đại lý (customerId derive group_map)
//   3. còn lại                        → guest
// Query dùng tagged template `sql` → auto-parameterize (chống injection). Bảng rỗng → guest.

import { sql } from "../db/client.ts";
import type { Identity } from "../flash-command/types.ts";
import { SqlGroupCustomerLookup } from "./group-customer.ts";
import { firstString } from "./rows.ts";
import type { GroupCustomerLookup, IdentityResolver, ResolveInput } from "./types.ts";

export class SqlIdentityResolver implements IdentityResolver {
  // Cùng phép tra nhóm→khách mà worker dùng để dựng MemoryScope → một nguồn sự thật, không hai
  // query group_map lệch nhau về điều kiện `enabled`.
  constructor(private readonly groups: GroupCustomerLookup = new SqlGroupCustomerLookup()) {}

  async resolve({ channel, senderId, groupId }: ResolveInput): Promise<Identity> {
    // Lấy luôn full_name + role_slug trong cùng query: tên đi vào ngữ cảnh agent
    // (context/speaker-block.ts) để model gọi đúng tên nhân viên thay vì "anh/chị"; role_slug là
    // chức danh hệ vận hành, tool nào chỉ dành cho một chức danh thì gate theo nó.
    // NULL (bind cũ, verify chưa trả field) → undefined, không phải lỗi — tool tự fail-closed.
    const staffRows: unknown = await sql`SELECT user_id, full_name, role_slug FROM user_binding
                WHERE channel = ${channel} AND sender_id = ${senderId}
                  AND revoked_at IS NULL
                LIMIT 1`;
    const userId = firstString(staffRows, "user_id");
    if (userId !== undefined) {
      return {
        role: "nhan_vien",
        senderId,
        userId,
        fullName: firstString(staffRows, "full_name"),
        roleSlug: firstString(staffRows, "role_slug"),
      };
    }

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
        const customerId = await this.groups.customerIdOf({ channel, groupId });
        // Đại lý cần cả membership dai_ly VÀ group_map enabled để derive customerId.
        if (customerId !== undefined) return { role: "dai_ly", senderId, customerId };
      }
    }

    return { role: "guest", senderId };
  }
}
