// types.ts — port hẹp tới Redis. Module nghiệp vụ (broker/, state/) nhận HÀM GỬI LỆNH, không
// nhận RedisClient của Bun: test giả lập được bằng closure, và không kéo config.ts (env validate
// eager) vào file có test.

/** Gửi 1 lệnh Redis thô. Trả `unknown` — caller narrow tại biên, không tin blind reply. */
export type RedisCommand = (name: string, args: string[]) => Promise<unknown>;
