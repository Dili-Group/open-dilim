// read.ts — reader dùng chung khi bóc JSON `unknown` của API vận hành.
//
// Tách khỏi order-api.ts để endpoint mới (profile-api.ts) không phải chép lại luật đọc: field
// thiếu/sai kiểu → `undefined` (nơi gọi bỏ dòng đó khi render), KHÔNG bịa giá trị mặc định.
// File LÁ: không import config.ts, không import client HTTP.

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // Backend có thể trả bigint/enum dạng chuỗi số — nhận, nhưng chỉ khi là số nguyên thuần.
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

export function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

/** Tiền: NUMERIC(15,2) → chuỗi. Nhận cả number (giữ nguyên chữ số, KHÔNG tính toán gì lên nó). */
export function readMoney(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function readList(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

/** Backend có thể trả id bigint dạng số. Giữ nguyên chữ số, không tính toán gì lên nó. */
export function numberAsString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = readNumber(record, key);
  return value === undefined ? undefined : String(value);
}

export function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
