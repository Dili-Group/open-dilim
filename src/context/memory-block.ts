// memory-block.ts — 4 chốt chống ảo giác §7 và CHỈ nó: top-K, ngưỡng liên quan, token cap,
// provenance (ngày ghi), câu "rỗng → nói không chắc".
//
// Tách khỏi assembler vì đây là phần sẽ được tune (ngưỡng, cap) và là phần đáng test riêng với
// MemoryStore giả. Assembler không cần biết cosine distance là gì.

import { RECALL_MAX_COSINE_DISTANCE } from "../state/vector.ts";
import type { MemoryRecall, MemoryScope, RecalledFact } from "../state/types.ts";

// §7: top-K 5–8. 6 = giữa khoảng, đủ ngữ cảnh mà không loãng.
const RECALL_TOP_K = 6;

// Trần khối memory. Xấp xỉ theo KÝ TỰ, không token: đếm token thật là 1 network call
// (count_tokens) — round-trip mỗi lượt để chặn ~1KB là vô lý.
const MEMORY_BLOCK_MAX_CHARS = 1200;

const HEADER =
  "GHI NHỚ DÀI HẠN (đã lọc theo độ liên quan, kèm ngày ghi — fact cũ hãy hạ tin cậy):";

// §7 chốt #4: recall rỗng/dưới ngưỡng thì agent phải nói không chắc, CẤM suy diễn lấp chỗ.
const EMPTY_BLOCK =
  "GHI NHỚ DÀI HẠN: không có ghi nhớ nào đủ liên quan. Nếu thiếu dữ kiện, nói rõ là chưa chắc — KHÔNG suy đoán.";

/**
 * Khối memory cho system prompt. Lỗi recall → log + trả rỗng (best-effort như LlmDistiller):
 * ghi nhớ hỏng KHÔNG được làm hỏng câu trả lời. Luật "rỗng → nói không chắc" vẫn còn ở prompt nền.
 */
export async function renderMemoryBlock(
  memory: MemoryRecall,
  scope: MemoryScope,
  queryText: string,
  signal?: AbortSignal,
): Promise<string> {
  let facts: RecalledFact[];
  try {
    facts = await memory.recall(
      scope,
      queryText,
      { k: RECALL_TOP_K, maxDistance: RECALL_MAX_COSINE_DISTANCE },
      signal,
    );
  } catch (err) {
    console.error("[context] recall memory lỗi:", err);
    return "";
  }

  if (facts.length === 0) return EMPTY_BLOCK;
  return [HEADER, ...capLines(facts.map(renderFact))].join("\n");
}

/** 1 fact 1 dòng, kèm ngày ghi (§7 chốt #2 provenance) để model tự hạ tin cậy fact cũ. */
function renderFact(fact: RecalledFact): string {
  return `- (ghi ${formatDate(fact.createdAt)}) [${fact.type}] ${fact.text}`;
}

function formatDate(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, iso.indexOf("T"));
}

/**
 * Cắt cho vừa cap. Bỏ NGUYÊN dòng từ ĐUÔI (recall xếp theo độ liên quan → đuôi ít liên quan
 * nhất), không cắt giữa fact: fact cụt mất chủ ngữ chính là lỗi §7 cảnh báo.
 */
function capLines(lines: readonly string[]): string[] {
  const kept: string[] = [];
  let used = HEADER.length;
  for (const line of lines) {
    const next = used + line.length + 1; // +1 cho newline
    if (next > MEMORY_BLOCK_MAX_CHARS) break;
    kept.push(line);
    used = next;
  }
  return kept;
}
