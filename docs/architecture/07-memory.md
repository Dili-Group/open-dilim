# 7. Memory (ngắn hạn & dài hạn)

Hai tầng, khác bản chất — không nhét chung.

| | Ngắn hạn (working) | Dài hạn (persistent) |
|---|---|---|
| Phạm vi | 1 `conversationId` (phòng) | cross-session, theo `(customer_id, channel, conversation_id)` |
| Nội dung | N turn gần nhất **verbatim** + rolling summary | **fact đã chưng cất** (không phải log thô) |
| Store | **Redis** (ephemeral, bounded, TTL/evict) | **Postgres + pgvector** |
| Module | `state/session.ts` | `state/memory.ts` |
| Recall | đọc thẳng theo `conversationId` | semantic search top-K theo embedding |

## Ngắn hạn

Buffer hội thoại trên **Redis** (key theo `conversationId`, TTL): giữ N turn gần nhất verbatim;
tràn context → tóm tắt cuộn (rolling summary), đẩy phần cũ ra. Group: mỗi turn gắn `senderId`
(đa speaker). KHÔNG cần vector/embedding.

## Dài hạn — pattern claude-mem (distill → index → recall → prime)

**Write path** (sau turn/hội thoại): distiller rút fact bền → record, embed bằng
**`gemini-embedding-001`** → lưu pgvector. KHÔNG lưu log thô.

> **Mỗi agent nhớ một kiểu.** `DistillSpec` ("agent này giữ GÌ, bỏ gì") đi thẳng vào system
> prompt của distiller, và được đóng cứng vào distiller lúc dựng — KHÔNG đổi được giữa chừng.
> Nên đường ghi là **một writer cho mỗi `RootAgent.memorySpec`**, không phải một writer toàn hệ:
>
> ```
> bootstrap:  agents.all() → Map<agentType, memorySpec> → buildMemoryWriters(store, specs)
>             spec trùng nhau (vận hành + lãnh đạo cùng internalOpsSpec) → dùng chung 1 writer
> worker:     ctx.memoryWriters.for(agent.agentType).afterTurn(...)
>             không có writer khớp → BỎ ghi, không mượn writer agent khác
> ```
>
> Dùng chung một writer cho mọi agent = agent lãnh đạo bị chưng cất bằng prompt "rút sở thích
> của khách" — fact ra lệch hoặc rỗng, và hỏng âm thầm (không có lỗi nào bắn ra).

> **Model của distiller.** Distiller (và rolling summary ngắn hạn) là việc nhẹ — rút gọn/phân
> loại — nhưng chạy ngầm sau *mỗi* turn, tần suất cao. Nên KHÔNG dùng con mạnh của agent loop mà
> dùng **con nhẹ riêng**: `CONFIG.memoryModel` (env `MEMORY_MODEL`, mặc định = `MODEL`), cùng
> provider với agent qua `LLMProvider`. `Embedder` thì luôn `gemini-embedding-001`, độc lập lựa
> chọn này. Chạy async, ngoài critical path → không bắt khách chờ.

**Read path** (bước STATE của [life cycle](./05-message-lifecycle.md)): embed câu hỏi → semantic
search top-K memory **của CHÍNH user này** → inject bản gọn vào context (progressive disclosure;
chi tiết fetch khi cần).

**Prime**: bootstrap hội thoại nạp profile khách compact (giống SessionStart hook claude-mem).

```sql
-- record: { id, user_id, type, text, embedding vector(1536), source_msg_id, confidence, ts }
-- gemini-embedding-001: output dim = 1536 (Matryoshka) → ≤2000, HNSW index thẳng, không halfvec
CREATE INDEX ON memory USING hnsw (embedding vector_cosine_ops);

SELECT text, ts FROM memory
WHERE user_id = $1                 -- TENANCY: cứng, không lọt cross-user
ORDER BY embedding <=> $2          -- cosine, top-K liên quan
LIMIT 8;
```

`Embedder` interface (giống `LLMProvider`) → swap Gemini ↔ self-host không sửa memory core.

## Chunking & chống ảo giác

Đây là memory hội thoại, KHÔNG phải RAG tài liệu → **không chunk cơ học** (cắt N token + overlap).
Cắt theo size gây ảo giác: to → vector nhiễu; nhỏ → mảnh cụt mất chủ ngữ, agent tự lấp.

**Đơn vị = 1 atomic fact self-contained** (semantic, không theo size):
- Distill 1 record = 1 ý trọn, tự đủ nghĩa (~1–3 câu, 1 chủ đề, không đại từ mồ côi).
- Message dài nhiều ý → tách nhiều fact, mỗi cái độc lập. KHÔNG overlap (fact rời rạc).
- Lưu hội thoại thô (để trace) → cắt theo ranh giới **turn** (1 turn/chunk, kèm `senderId`), không cắt giữa turn.

**4 chốt chống ảo giác** (quan trọng hơn chunk size):
1. **Similarity threshold — bỏ rác.** Recall chỉ lấy chunk > ngưỡng cosine (~0.7, tune). Dưới ngưỡng → vứt, KHÔNG nhồi context. Thà thiếu còn hơn context sai.
2. **Provenance.** Mỗi record kèm `source_msg_id + ts`; render prompt "(ghi ngày X)" → LLM hạ tin cậy fact cũ, cite được, không bịa.
3. **DB-first.** Fact động query DB lúc chạy, không recall từ memory (đã là nguyên tắc).
4. **Rỗng → hỏi lại.** Recall trống / dưới ngưỡng → agent nói không chắc, cấm suy diễn lấp chỗ.

**Read-time budget:**
```
context = short-term buffer (turn gần, verbatim)        ← ưu tiên 1
        + long-term recall (top-K=5–8, > threshold)     ← ưu tiên 2, có token cap
```
Cap token block memory. Ngắn hạn thắng dài hạn khi tràn. Không nhồi hết top-K bất kể liên quan.

## 3 rào bắt buộc

1. **Partition theo PHÒNG.** Mọi read/write memory filter `(customer_id, channel, conversation_id)` — cả 3, không phải logic app tự nhớ. Memory thuộc **phòng chat**, không thuộc người gõ: phòng có cả nhân viên lẫn khách nói chung một mạch, nên fact rút ra là của phòng; ai nói chỉ là chi tiết ghi trong text fact. Hệ quả: `customer_id` derive từ `group_map` theo phòng (**không** lấy từ Identity người gõ — nhân viên không mang `customer_id`); nhóm chưa `/ketnoi-dilim` và chat 1-1 thì **không có scope → không đọc, không ghi** (không có rổ chung để đoán vào); cùng một người ở hai phòng khác nhau **không** dùng chung trí nhớ.
2. **DB-first — memory ≠ fact động.** KHÔNG lưu trạng thái động (tình trạng đơn, số dư, tồn kho) vào memory — thiu. Cái đó query DB lúc chạy. Memory chỉ giữ: sở thích, ngữ cảnh bền, tóm tắt episode.
3. **Memory informs, không authorizes.** Recalled memory có thể cũ/sai. Agent làm WRITE thật (refund/hủy) không được dựa memory → re-verify từ DB + qua [approval](./06-approval.md).

---

[← Mục lục kiến trúc](../ARCHITECTURE.md)
