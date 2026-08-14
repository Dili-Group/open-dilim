// input.ts — đọc tham số từ input LLM sinh. Input model = UNTRUSTED → validate ở boundary, không
// tin blind, không `as` ép kiểu (CLAUDE.md). Sai shape trả undefined để tool tự trả isError.

/**
 * Field số NGUYÊN trong object input. Model hay trả số dạng chuỗi ("6") → nhận, nhưng chỉ khi là
 * số nguyên thuần. Sai shape / số thực / rác → undefined để tool tự trả isError.
 */
export function readIntegerField(input: unknown, key: string): number | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[key];
  if (typeof value === "number") return Number.isInteger(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

/**
 * Field cờ true/false trong object input. Model hay trả `"true"`/`"false"` dạng chuỗi → nhận.
 * Thiếu / rác → false: cờ lọc chỉ bật khi model nói rõ là bật.
 */
export function readBooleanField(input: unknown, key: string): boolean {
  if (typeof input !== "object" || input === null) return false;
  const value = (input as Record<string, unknown>)[key];
  if (typeof value === "boolean") return value;
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

/**
 * Field MẢNG chuỗi trong object input. Phần tử nào không phải chuỗi non-empty → loại cả mảng
 * (undefined), KHÔNG lọc bỏ âm thầm: tool ghi dữ liệu phải thấy đúng danh sách model định gửi.
 */
export function readStringListField(input: unknown, key: string): readonly string[] | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    const trimmed = item.trim();
    if (trimmed === "") return undefined;
    items.push(trimmed);
  }
  return items;
}

/** Field chuỗi non-empty trong object input. Không phải object / thiếu / sai kiểu → undefined. */
export function readStringField(input: unknown, key: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
