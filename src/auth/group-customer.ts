// group-customer.ts — tra (channel, group_id) → customer_id qua group_map (PK, lookup chạy thẳng).
// Chỉ nhóm `enabled = true` mới tính: tắt binding là tắt luôn quyền lẫn memory của nhóm đó.
// Query dùng tagged template `sql` → auto-parameterize (chống injection).

import { sql } from "../db/client.ts";
import { firstString } from "./rows.ts";
import type {
  CustomerRoom,
  CustomerRoomLookup,
  GroupCustomerLookup,
  GroupLookupInput,
} from "./types.ts";

export class SqlGroupCustomerLookup implements GroupCustomerLookup {
  async customerIdOf({ channel, groupId }: GroupLookupInput): Promise<string | undefined> {
    return firstString(
      await sql`SELECT customer_id FROM group_map
                WHERE channel = ${channel} AND group_id = ${groupId} AND enabled = true
                LIMIT 1`,
      "customer_id",
    );
  }
}

/**
 * Chiều ngược: khách → nhóm để hệ thống chủ động nhắn. Chạy trên index `group_map_customer`.
 *
 * Một khách CÓ THỂ có nhiều nhóm (nhóm cũ chưa gỡ, nhóm ở kênh khác) → lấy nhóm được cập nhật
 * GẦN NHẤT. Chốt một thứ tự tường minh là để hai lần tra cùng một khách không ra hai nhóm khác
 * nhau; nhắn đúng nhóm "mới nhất" cũng là phỏng đoán an toàn nhất khi vận hành re-map.
 */
export class SqlCustomerRoomLookup implements CustomerRoomLookup {
  async roomOf(customerId: string): Promise<CustomerRoom | undefined> {
    const rows: unknown = await sql`SELECT channel, group_id FROM group_map
                                    WHERE customer_id = ${customerId} AND enabled = true
                                    ORDER BY updated_at DESC
                                    LIMIT 1`;
    const channel = firstString(rows, "channel");
    const groupId = firstString(rows, "group_id");
    return channel === undefined || groupId === undefined ? undefined : { channel, groupId };
  }
}
