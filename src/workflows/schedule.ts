// schedule.ts — số học thời gian dùng chung cho mọi workflow: mốc nhắc kế tiếp và hạn đóng.
//
// Tách khỏi poller vì đây là phép tính thuần, test được không cần DB. Chính sách CỤ THỂ (nhắc mấy
// tiếng, hạn mấy ngày, có tránh ban đêm không) nằm ở từng `WorkflowDef` — file này chỉ áp dụng.
//
// GIỜ VN CỐ ĐỊNH +07:00 (VN không có DST) → số học offset luôn đúng, không cần thư viện timezone.
// Cùng thủ pháp với scheduler/schedule.ts.

import { VN_UTC_OFFSET_MINUTES } from "../scheduler/schedule.ts";
import type { WorkflowDef } from "./types.ts";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const OFFSET_MS = VN_UTC_OFFSET_MINUTES * MS_PER_MINUTE;

/** Giờ hành chính (giờ VN). Ngoài khoảng này người ta không đọc mà vẫn bị ping. */
export const OFFICE_START_HOUR = 8;
export const OFFICE_END_HOUR = 18;

/**
 * Kéo một mốc vào giờ hành chính gần nhất KHÔNG SỚM HƠN nó: trước 8h → 8h cùng ngày, từ 18h trở
 * đi → 8h hôm sau, trong giờ → giữ nguyên.
 *
 * Luôn dịch VỀ SAU, không bao giờ về trước — dịch sớm lại là nhắc trước hạn.
 */
export function shiftIntoOfficeHours(ms: number, offsetMs: number = OFFSET_MS): number {
  const local = ms + offsetMs;
  // Epoch chia hết cho ngày tại 00:00 UTC → cộng offset xong, phép chia này ra 00:00 GIỜ VN.
  const dayStart = Math.floor(local / MS_PER_DAY) * MS_PER_DAY;
  const openAt = dayStart + OFFICE_START_HOUR * MS_PER_HOUR;
  if (local < openAt) return openAt - offsetMs;
  if (local >= dayStart + OFFICE_END_HOUR * MS_PER_HOUR) return openAt + MS_PER_DAY - offsetMs;
  return ms;
}

/**
 * Mốc nhắc kế tiếp theo chính sách của def, tính từ `fromMs` (lúc vừa hỏi / vừa nhắc xong).
 * undefined = def không nhắc (`remindIntervalMs = 0`) → chỉ chờ tới hạn rồi đóng.
 */
export function nextRemindAt(def: WorkflowDef, fromMs: number): Date | undefined {
  if (def.remindIntervalMs <= 0) return undefined;
  const raw = fromMs + def.remindIntervalMs;
  return new Date(def.officeHoursOnly ? shiftIntoOfficeHours(raw) : raw);
}

/**
 * Hạn đóng việc. KHÔNG kéo vào giờ hành chính: hết hạn là đóng im lặng, không nhắn ai, nên đóng
 * lúc nửa đêm cũng không làm phiền nhóm nào.
 */
export function expiresAt(def: WorkflowDef, fromMs: number): Date {
  return new Date(fromMs + def.ttlMs);
}
