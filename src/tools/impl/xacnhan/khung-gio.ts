// khung-gio.ts — POLICY khung giờ xác nhận của BS Sơn. Để hằng ở đây, KHÔNG nhét env: cùng lý do
// với bảng định tuyến (agents/router.ts) và trần ngân sách (usage/budget.ts) — đọc được, review
// được, test được. Đổi giờ = sửa một bảng, có test đỡ lưng.
//
// File LÁ: không import config.ts, không import db. Nhờ vậy test chạy được mà không cần env.
//
// Mốc giờ tính theo GIỜ VN qua Intl, KHÔNG `Date.getHours()`: server chạy UTC thì 11h VN là 4h
// sáng UTC — lệch 7 tiếng là xếp nhầm cả hàng đợi.

import type { SlotId } from "../../../operational/types.ts";

const TIME_ZONE = "Asia/Ho_Chi_Minh";

/** Cửa sổ mỗi slot, tính bằng PHÚT kể từ 0h VN. T2–T7; Chủ nhật OFF (không slot nào). */
const SLOT_WINDOW: Readonly<Record<SlotId, { readonly start: number; readonly end: number }>> = {
  trua: { start: 11 * 60, end: 12 * 60 },
  chieu: { start: 16 * 60, end: 17 * 60 },
};

export const SLOT_LABEL: Readonly<Record<SlotId, string>> = {
  trua: "11h–12h",
  chieu: "16h–17h",
};

export const SLOT_IDS: readonly SlotId[] = ["trua", "chieu"];

const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Ngày sổ `YYYY-MM-DD` theo giờ VN.
 *
 * Ghép từ `formatToParts` chứ không lấy nguyên chuỗi `format()` — máy thiếu locale data thì Intl
 * lặng lẽ trả `18/09/2026`, không lỗi gì, chỉ là khoá ngày sai (cùng bẫy đã gặp ở usage/budget.ts).
 */
export function vnDay(now: Date = new Date()): string {
  const parts = DAY_FORMAT.formatToParts(now);
  const at = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${at("year")}-${at("month")}-${at("day")}`;
}

/** Phút đã trôi qua kể từ 0h VN của hôm nay. */
export function vnMinutes(now: Date = new Date()): number {
  const parts = CLOCK_FORMAT.formatToParts(now);
  const at = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return at("hour") * 60 + at("minute");
}

/**
 * Thứ trong tuần của một ngày sổ (0 = Chủ nhật). Đọc từ CHUỖI ngày, không từ Date hiện tại: ngày
 * đã chốt dạng `YYYY-MM-DD` thì không còn múi giờ nào để lệch.
 */
export function weekdayOf(day: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) return undefined;
  const [, year, month, date] = match;
  if (year === undefined || month === undefined || date === undefined) return undefined;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(date));
  const parsed = new Date(utc);
  // Date.UTC không kiểm ngày ảo: 2026-02-31 cuộn sang tháng 3. Soi ngược để bắt.
  if (parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(date)) {
    return undefined;
  }
  return parsed.getUTCDay();
}

/** Chủ nhật BS Sơn OFF (quy trình §3). Ngày sai định dạng cũng coi là không nhận. */
export function isOffDay(day: string): boolean {
  const weekday = weekdayOf(day);
  // Ngày sai định dạng cũng vào nhánh này: không đọc được ngày thì không dám xếp vào khung nào.
  return weekday === undefined || weekday === 0;
}

/** Slot đang mở ngay lúc này, undefined = ngoài giờ xác nhận hoặc Chủ nhật. */
export function currentSlot(now: Date = new Date()): SlotId | undefined {
  if (isOffDay(vnDay(now))) return undefined;
  const minutes = vnMinutes(now);
  return SLOT_IDS.find((slot) => {
    const window = SLOT_WINDOW[slot];
    return minutes >= window.start && minutes < window.end;
  });
}

/**
 * Đăng ký này có KỊP khung đã xin hay không (quy trình §5: sai khung thì xác nhận sau các trường
 * hợp đúng khung — KHÔNG từ chối, vì từ chối là làm mất dòng sổ).
 *
 * Kịp = xin cho ngày mai trở đi, hoặc xin hôm nay mà slot chưa đóng. Muộn = slot đã đóng, xin cho
 * ngày đã qua, hoặc rơi vào Chủ nhật.
 */
export function isOnTime(input: {
  readonly slot: SlotId;
  readonly day: string;
  readonly now?: Date;
}): boolean {
  if (isOffDay(input.day)) return false;
  const now = input.now ?? new Date();
  const today = vnDay(now);
  if (input.day > today) return true;
  if (input.day < today) return false;
  return vnMinutes(now) < SLOT_WINDOW[input.slot].end;
}

/**
 * Sale gõ khung giờ mỗi người một kiểu ("12h", "11-12h", "16-17h", "khung trưa", "chiều") — quy
 * về một trong hai slot. Không khớp → undefined để tool hỏi lại, KHÔNG đoán bừa: đoán nhầm slot
 * là khách chờ nhầm giờ.
 */
export function normalizeSlot(raw: string | undefined): SlotId | undefined {
  if (raw === undefined) return undefined;
  const text = stripDiacritics(raw.toLowerCase());
  if (text.includes("trua")) return "trua";
  if (text.includes("chieu")) return "chieu";
  // Giờ đồng hồ: lấy số đầu tiên rồi soi xem nó thuộc cửa sổ nào. "11-12h" → 11, "16-17h" → 16.
  const hour = /(\d{1,2})\s*(?:h|:|-|–)/.exec(text)?.[1] ?? /^(\d{1,2})$/.exec(text.trim())?.[1];
  if (hour === undefined) return undefined;
  const value = Number(hour);
  if (value === 11 || value === 12) return "trua";
  if (value === 16 || value === 17) return "chieu";
  return undefined;
}

function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
}
