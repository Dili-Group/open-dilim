// time.ts — mốc ngày/giờ VN cho kb-digest. Hàm thuần, offset cố định +7 (tái dùng hằng của
// scheduler) — không tz library, không phụ thuộc TZ của process (cùng lý do schedule.ts).

import { VN_UTC_OFFSET_MINUTES } from "../scheduler/schedule.ts";

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** Ngày VN 'YYYY-MM-DD' của mốc epoch ms. */
export function vnDateOf(nowMs: number): string {
  const shifted = new Date(nowMs + VN_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
  return shifted.toISOString().slice(0, 10);
}

/** [startMs, endMs) của một ngày VN. Input phải là 'YYYY-MM-DD' (từ vnDateOf, không phải user). */
export function vnDayBounds(day: string): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${day}T00:00:00+07:00`);
  if (Number.isNaN(startMs)) throw new Error(`ngày không hợp lệ: ${day}`);
  return { startMs, endMs: startMs + MS_PER_DAY };
}

/** Phút-trong-ngày theo giờ VN của mốc epoch ms (0..1439). */
export function vnMinutesOfDay(nowMs: number): number {
  const shifted = new Date(nowMs + VN_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** 'HH:MM' giờ VN của một tin — chỉ để render transcript, người đọc là model. */
export function vnClock(ts: number): string {
  const shifted = new Date(ts + VN_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * 'HH:MM' (hoặc 'HH' / 'HHhMM' kiểu /lich) → phút-trong-ngày. undefined = không parse được.
 * Chấp nhận cú pháp lỏng vì đây là input người gõ lệnh.
 */
export function parseRunTime(raw: string): number | undefined {
  const match = /^(\d{1,2})(?:[:hH](\d{2}))?$/.exec(raw.trim());
  if (match === null) return undefined;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

/** Ngược của parseRunTime — chuẩn hoá về 'HH:MM' để lưu/hiển thị thống nhất. */
export function formatRunTime(minutesOfDay: number): string {
  const hh = String(Math.floor(minutesOfDay / 60)).padStart(2, "0");
  const mm = String(minutesOfDay % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}
