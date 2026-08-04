// client.ts — Postgres client dùng Bun.sql native (không dep bên thứ 3).
// Query LUÔN qua tagged template `sql`...${x}`` → auto-parameterize, chống SQL injection.
// KHÔNG nối string vào query. KHÔNG dùng sql.unsafe() với input untrusted.

import { SQL } from "bun";
import { CONFIG } from "../config.ts";

// Pool size mặc định. Agent worker pool concurrent → giữ đủ connection, tránh cạn.
const MAX_CONNECTIONS = 10;
const IDLE_TIMEOUT_SEC = 30;
const CONNECT_TIMEOUT_SEC = 10;

/**
 * Singleton pool. Bun.sql tự quản connection + prepared-statement cache.
 * Lazy connect — connection mở ở query đầu tiên.
 */
export const sql = new SQL({
  url: CONFIG.databaseUrl,
  max: MAX_CONNECTIONS,
  idleTimeout: IDLE_TIMEOUT_SEC,
  connectionTimeout: CONNECT_TIMEOUT_SEC,
});

/** Kiểm tra kết nối DB sống. Dùng cho healthcheck lúc khởi động. */
export async function pingDb(): Promise<void> {
  await sql`SELECT 1`;
}

/** Đóng pool sạch khi shutdown. Chờ query đang chạy xong. */
export async function closeDb(): Promise<void> {
  await sql.close();
}
