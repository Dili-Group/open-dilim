// client.ts — Redis client dùng Bun.RedisClient native (không dep bên thứ 3), đối xứng
// db/client.ts. Redis giữ: ingress stream (broker), short-term history, dedupe key.
//
// HAI loại connection:
//  - `redis`   : mọi lệnh KHÔNG blocking (XADD/XACK/SET/LRANGE...), auto-pipelining.
//  - blocking  : lệnh giữ connection tới khi trả (XREADGROUP BLOCK). Dùng chung với `redis` thì
//                mọi lệnh khác xếp hàng sau nó → mỗi consumer phải có connection riêng.

import { RedisClient } from "bun";
import { CONFIG } from "../config.ts";
import type { RedisCommand } from "./types.ts";

const CONNECT_TIMEOUT_MS = 10_000;

/** Client chung cho lệnh non-blocking. Lazy connect — mở ở lệnh đầu tiên. */
export const redis = new RedisClient(CONFIG.redisUrl, {
  connectionTimeout: CONNECT_TIMEOUT_MS,
});

// Giữ để đóng sạch lúc shutdown (client blocking không nằm trong singleton trên).
const blockingClients: RedisClient[] = [];

/**
 * Connection riêng cho lệnh blocking. `idleTimeout: 0` để không bị đóng giữa lúc đang BLOCK;
 * tắt auto-pipelining để lệnh khác không vô tình xếp sau lệnh đang chờ.
 */
export function createBlockingClient(): RedisClient {
  const client = new RedisClient(CONFIG.redisUrl, {
    connectionTimeout: CONNECT_TIMEOUT_MS,
    idleTimeout: 0,
    enableAutoPipelining: false,
  });
  blockingClients.push(client);
  return client;
}

/**
 * Bọc `client.send` (Bun khai trả `any`) thành RedisCommand trả `unknown` → chặn `any` lan ra
 * ngoài NGAY tại biên, đúng luật "reply hạ tầng là untrusted, narrow trước khi dùng".
 */
export function commandOf(client: RedisClient): RedisCommand {
  return async (name, args) => {
    const raw: unknown = await client.send(name, args);
    return raw;
  };
}

/** Kiểm tra Redis sống. Dùng cho healthcheck lúc khởi động (fail-fast). */
export async function pingRedis(): Promise<void> {
  await redis.ping();
}

/** Đóng mọi connection khi shutdown. */
export function closeRedis(): void {
  for (const client of blockingClients) client.close();
  blockingClients.length = 0;
  redis.close();
}
