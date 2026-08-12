// pricing.ts — bảng giá model + quy đổi token → tiền. ĐÂY LÀ CHỖ DUY NHẤT biết giá; mọi nơi khác
// chỉ chuyền `LlmUsage` (token thô) rồi gọi `costPicoUsd`.
//
// Đơn vị nội bộ là PICO-USD (1e-12 USD), số nguyên. Lý do:
//  - Bộ đếm chạy trên Redis INCRBY → chỉ nhận số nguyên.
//  - Cộng dồn float qua hàng nghìn lượt là trôi số, mà đây là tiền.
//  - Token rẻ nhất ($0,0048/1M = 4,8e-9 USD/token) chỉ ra số nguyên từ mức pico trở xuống;
//    dùng nano là mất phần lẻ trên đúng loại token chiếm ~90% lưu lượng.
//
// Trần an toàn: 1 phòng/ngày ~4e11 pico, 1 phòng/năm ~1,4e14 — dưới Number.MAX_SAFE_INTEGER
// (9,007e15). Query TỔNG toàn hệ nhiều năm thì vượt → chỗ báo cáo phải chia ra USD ngay trong SQL.

import type { LlmUsage } from "../llm/types.ts";

export const PICO_PER_USD = 1_000_000_000_000;

/**
 * Giá mỗi TOKEN, đơn vị pico-USD. Nguồn: bảng giá gateway đang dùng (ANTHROPIC_BASE_URL).
 * Đổi model/gateway = sửa đúng bốn hằng này.
 *
 * $0,0048 / 1M token = 4,8e-9 USD/token = 4800 pico.
 */
const PICO_PER_CACHE_READ = 2_800; // $0,0048 / 1M — cache hit
const PICO_PER_INPUT = 130_000; // $0,28   / 1M — cache miss
const PICO_PER_OUTPUT = 240_000; // $0,48   / 1M

/**
 * Gateway chưa công bố giá ghi cache riêng. Tạm tính BẰNG giá cache miss: tính dư thì chặn sớm,
 * tính thiếu thì vỡ ngân sách âm thầm — chọn hướng sai an toàn.
 */
const PICO_PER_CACHE_WRITE = PICO_PER_INPUT;

/** Token thô → pico-USD. Số nguyên (mọi hệ số là số nguyên, mọi token count là số nguyên). */
export function costPicoUsd(usage: LlmUsage): number {
  return (
    usage.input * PICO_PER_INPUT +
    usage.output * PICO_PER_OUTPUT +
    usage.cacheRead * PICO_PER_CACHE_READ +
    usage.cacheWrite * PICO_PER_CACHE_WRITE
  );
}

/**
 * Trần khai bằng VND (người vận hành nghĩ bằng VND), sổ sách chạy bằng pico-USD (nhà cung cấp
 * tính bằng USD). Quy đổi ĐÚNG MỘT LẦN lúc dựng config — không đổi mỗi request: tỉ giá nhích
 * giữa ngày mà quy đổi mỗi lần thì hạn mức nhảy lung tung giữa các lượt trong cùng một ngày.
 */
export function vndToPicoUsd(vnd: number, usdVndRate: number): number {
  if (usdVndRate <= 0) throw new Error(`tỉ giá USD/VND không hợp lệ: ${usdVndRate}`);
  return Math.floor((vnd / usdVndRate) * PICO_PER_USD);
}

/** pico-USD → VND, để in ra log/báo cáo cho người đọc. */
export function picoUsdToVnd(pico: number, usdVndRate: number): number {
  return (pico / PICO_PER_USD) * usdVndRate;
}
