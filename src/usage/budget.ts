// budget.ts — trần chi phí LLM mỗi PHÒNG mỗi NGÀY, khai theo agent.
//
// Đây là POLICY, để hằng ở đây chứ không nhét env — cùng lý do với bảng định tuyến
// (agents/router.ts): đọc được, review được, test được. Env chỉ giữ tỉ giá và cờ bật/tắt.
//
// Gom theo PHÒNG (conversationId) chứ không theo người: một nhóm đại lý có nhiều người gõ, mà
// chi phí thật là của cả nhóm (prompt cache, history, bản tóm đều dùng chung).

import { AgentType } from "../agents/types.ts";

/**
 * Trần VND/phòng/ngày. `null` = KHÔNG chặn.
 *
 * Nhóm NỘI BỘ (sếp, kho, vận hành) để `null` có chủ đích: chặn người trong nhà giữa việc tệ hơn
 * nhiều so với vượt vài nghìn đồng, và số lượng nhóm nội bộ là hữu hạn nên không phải bề mặt
 * abuse. Chỉ chặn nhóm NGOÀI (đại lý, cá nhân) — nơi số phòng tăng không giới hạn.
 *
 * Chi phí đọc ảnh (`xem_anh`) chạy qua Gemini nên KHÔNG vào sổ này; kho là nhóm gọi nhiều nhất,
 * thêm một lý do nữa để không đặt trần ở đó bằng số liệu thiếu.
 */
export const DAILY_BUDGET_VND: Readonly<Record<string, number | null>> = {
  [AgentType.Dealer]: 10_000,
  [AgentType.Personal]: 10_000,
  [AgentType.Warehouse]: null,
  [AgentType.Operations]: null,
  [AgentType.Boss]: null,
};

/** Agent không có trong bảng (kể cả `default`) dùng mức này. */
const FALLBACK_BUDGET_VND = 10_000;

export function dailyBudgetVnd(agentType: string): number | null {
  const found = DAILY_BUDGET_VND[agentType];
  // `undefined` = chưa khai (agent mới) → mức thủ; `null` = khai rõ là không chặn.
  return found === undefined ? FALLBACK_BUDGET_VND : found;
}

// Mốc ngày theo giờ VN. KHÔNG dùng CURRENT_DATE/UTC: server chạy UTC thì nửa đêm lệch 7 tiếng,
// hạn mức reset lúc 7h sáng — đúng giờ nhóm đại lý bắt đầu làm việc.
const TIME_ZONE = "Asia/Ho_Chi_Minh";
const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Ngày sổ sách dạng `YYYY-MM-DD` theo giờ VN.
 *
 * Ghép từ `formatToParts` chứ KHÔNG lấy nguyên chuỗi `format()`: máy thiếu locale data thì Intl
 * lặng lẽ rơi về locale khác và trả `08/11/2026` — không lỗi, chỉ là khoá ngày sai, và sổ cái
 * sẽ gom nhầm ngày mà không có gì báo. Đọc theo `type` thì locale nào cũng ra đúng.
 */
export function usageDay(now: Date = new Date()): string {
  const parts = DAY_FORMAT.formatToParts(now);
  const at = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${at("year")}-${at("month")}-${at("day")}`;
}

const SECONDS_PER_DAY = 86_400;

/**
 * Số giây còn lại tới nửa đêm VN — TTL của bộ đếm Redis. Hết ngày thì key tự rụng, không cần
 * job dọn. Luôn ≥ 1 để không SET một key hết hạn ngay.
 */
export function secondsUntilNextDay(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const at = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = at("hour") * 3600 + at("minute") * 60 + at("second");
  return Math.max(1, SECONDS_PER_DAY - elapsed);
}
