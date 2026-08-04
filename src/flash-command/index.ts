// index.ts — lắp registry flash-command. Điểm vào duy nhất cho ingest/worker.
//
// Thêm lệnh mới: tạo file trong commands/, import + register ở đây. Không sửa registry.ts.

import huyKetnoi from "./commands/huy-ketnoi.ts";
import ketnoiDaily from "./commands/ketnoi-daily.ts";
import ketnoiHethong from "./commands/ketnoi-hethong.ts";
import { FlashRegistry } from "./registry.ts";

/** Registry mặc định, đã nạp lệnh hiện có. Dùng chung toàn app (stateless — an toàn share). */
export const flashRegistry = new FlashRegistry()
  .register(ketnoiHethong)
  .register(ketnoiDaily)
  .register(huyKetnoi);

export { FlashRegistry, parseCommand } from "./registry.ts";
export type { DispatchInput, ParsedCommand } from "./registry.ts";
export * from "./types.ts";
