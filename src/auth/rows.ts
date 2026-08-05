// rows.ts — narrow kết quả query. Rows từ DB là `unknown` shape với TypeScript → không tin blind.

/** Lấy string ở cột `key` của row đầu. Không có row / sai kiểu → undefined. */
export function firstString(rows: unknown, key: string): string | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const row: unknown = rows[0];
  if (typeof row !== "object" || row === null) return undefined;
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
