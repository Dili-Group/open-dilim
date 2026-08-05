// input.ts — đọc tham số từ input LLM sinh. Input model = UNTRUSTED → validate ở boundary, không
// tin blind, không `as` ép kiểu (CLAUDE.md). Sai shape trả undefined để tool tự trả isError.

/** Field chuỗi non-empty trong object input. Không phải object / thiếu / sai kiểu → undefined. */
export function readStringField(input: unknown, key: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
