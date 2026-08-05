// group-customer.ts — tra (channel, group_id) → customer_id qua group_map (PK, lookup chạy thẳng).
// Chỉ nhóm `enabled = true` mới tính: tắt binding là tắt luôn quyền lẫn memory của nhóm đó.
// Query dùng tagged template `sql` → auto-parameterize (chống injection).

import { sql } from "../db/client.ts";
import { firstString } from "./rows.ts";
import type { GroupCustomerLookup, GroupLookupInput } from "./types.ts";

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
