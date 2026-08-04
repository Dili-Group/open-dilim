// env.ts — bước khởi động: xác nhận env + infra sẵn sàng TRƯỚC khi wiring.
//
// Env đã validate eager lúc import config.ts (required()/oneOf() throw nếu thiếu). loadConfig()
// biến side-effect đó thành 1 BƯỚC BOOT rõ ràng — bootstrap sở hữu điểm fail, không phụ thuộc
// thứ tự import rải rác. checkInfra() ping hạ tầng đã dựng (Postgres) → chết sớm nếu DB chưa lên.

import { CONFIG, type Config } from "../config.ts";
import { pingDb } from "../db/client.ts";

/** Trả CONFIG (đã validate lúc import). Gọi ở đầu bootstrap để fail-fast có chủ đích. */
export function loadConfig(): Config {
  return CONFIG;
}

/**
 * Kiểm tra hạ tầng đã dựng còn sống. Hiện chỉ Postgres (client thật, đã có).
 * Redis check thêm khi có client (broker/ chưa xây — bootstrap đang dùng in-mem thay thế).
 */
export async function checkInfra(): Promise<void> {
  await pingDb();
}
