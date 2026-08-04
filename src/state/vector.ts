// vector.ts — helper thuần cho pgvector. Tách để test không cần DB.

/**
 * Format số[] → literal pgvector `[1,2,3]`. Bind như text param rồi cast `$n::vector` ở query.
 * Chặn giá trị không hữu hạn (NaN/Infinity) — embedder lỗi không được lọt thành vector rác.
 */
export function toVectorLiteral(values: readonly number[]): string {
  if (values.length === 0) throw new Error("toVectorLiteral: vector rỗng");
  for (const v of values) {
    if (!Number.isFinite(v)) throw new Error(`toVectorLiteral: giá trị không hữu hạn (${v})`);
  }
  return `[${values.join(",")}]`;
}

// Ngưỡng cosine distance coi 2 fact là TRÙNG (near-dup) → không ghi bản sao. pgvector `<=>` trả
// [0,2]: 0 = trùng khít. 0.05 ≈ gần như y hệt ý → bỏ; khác ý rõ thì > 0.05, giữ lại.
export const DEDUP_COSINE_DISTANCE = 0.05;
