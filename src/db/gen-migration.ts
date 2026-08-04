// gen-migration.ts — generate migrations/0001_init.sql từ schema.ts (single source of truth).
// Chạy: bun run src/db/gen-migration.ts
// Đổi tên table/column/index? Sửa schema.ts rồi chạy lại — .sql tự đồng bộ.

import { buildInitSql } from "./schema.ts";

const OUT = new URL("../../migrations/0001_init.sql", import.meta.url);

await Bun.write(OUT, buildInitSql());
console.log(`wrote ${Bun.fileURLToPath(OUT)}`);
