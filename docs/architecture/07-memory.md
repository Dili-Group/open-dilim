# 7. Memory (ngắn hạn & dài hạn)

Hai tầng, khác bản chất — không nhét chung.

| | Ngắn hạn (working) | Dài hạn (persistent) |
|---|---|---|
| Phạm vi | 1 `conversationId` (phòng) | cross-session, theo `(owner_kind, owner_id, channel, conversation_id)` |
| Nội dung | N turn gần nhất **verbatim** + rolling summary (`compactor.ts`) | **fact đã chưng cất** (không phải log thô) |
| Store | **Redis** (ephemeral, bounded, TTL/evict) | **Postgres + pgvector** |
| Module | `state/session.ts` | `state/memory.ts` |
| Recall | đọc thẳng theo `conversationId` | semantic search top-K theo embedding |

## Ngắn hạn

Buffer hội thoại trên **Redis** (key theo `conversationId`, TTL): giữ N turn gần nhất verbatim.
Group: mỗi turn gắn `senderId` (đa speaker). KHÔNG cần vector/embedding.

### Nén (rolling summary) — `state/compactor.ts`

Worker chỉ đọc 20 tin cuối. Phần trôi ra ngoài cửa sổ đó KHÔNG được biến mất im lặng: sau mỗi
lượt, compactor cô nó lại thành một bản tóm cuộn (Redis, 1 key/phòng), và bước STATE nạp bản tóm
đó vào system prompt trước khối memory.

```
afterTurn(conversationId, [...history, reply]):
  tổng ký tự < COMPACT_TRIGGER_CHARS  → thoát, KHÔNG gọi LLM
  còn lại → phần cũ = entries.slice(0, -KEEP_RECENT_ENTRIES)
            (rỗng = cửa sổ dài nhưng toàn tin gần đây → chưa có gì để nén)
          → con nhẹ GỘP (bản tóm cũ + phần cũ) → 1 bản tóm ≤ SUMMARY_MAX_CHARS → Redis
```

| Hằng | Giá trị | Vì sao |
|---|---|---|
| `COMPACT_TRIGGER_CHARS` | 12.000 | ~4–5k token tiếng Việt |
| `KEEP_RECENT_ENTRIES` | 20 | Giữ nguyên văn; khớp `HISTORY_LIMIT` của worker |
| `SUMMARY_MAX_CHARS` | 1.200 | Bằng cap khối memory — cả hai đều chen vào trước history mỗi lượt |

**Ngưỡng KHÔNG chọn theo trần context của model.** Agent chạy Opus 4.8 (1M token input) nên một
lượt hiện dùng ~2–4k token — còn cách trần vài trăm lần. Lấy ngưỡng theo đó thì nén không bao giờ
chạy. Ngưỡng chọn theo **chi phí**: mỗi lượt gửi lại toàn bộ cửa sổ, cửa sổ phình = trả tiền cho
model đọc lại chuyện phiếm. (Con nhẹ nén là Haiku 4.5, 200K token — bản tóm cũ + phần cắt ra ≈ 5k
token, thừa sức.)

Đo bằng **ký tự, không token**: đếm token thật là một network call `count_tokens` mỗi lượt — cùng
lý do với cap khối memory.

**Nén theo PHÒNG, không theo `MemoryScope`.** Đây là khác biệt then chốt với đường ghi dài hạn:
nhóm chưa `/ketnoi-daily` không distill được (không biết fact của khách nào), nhưng vẫn phải giữ
được mạch hội thoại. Hai đường tách nhau vì thế, không gộp làm một.

Best-effort: nén hỏng → log rồi thôi. Reply đã gửi đi; mất một nhịp nén chỉ làm ngữ cảnh cũ thưa
đi, không được phép làm hỏng lượt đã trả lời xong.

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
-- record: { id, owner_kind, owner_id, channel, conversation_id, type, text,
--           embedding vector(1536), source_msg_id, confidence, created_at }
-- gemini-embedding-001: output dim = 1536 (Matryoshka) → ≤2000, HNSW index thẳng, không halfvec
CREATE INDEX ON memory USING hnsw (embedding vector_cosine_ops);

SELECT text, type, created_at FROM memory
WHERE owner_kind = $1 AND owner_id = $2       -- TENANCY: cứng, không lọt cross-owner
  AND channel = $3 AND conversation_id = $4
  AND embedding <=> $5::vector < $6           -- ngưỡng liên quan lọc TRONG SQL
ORDER BY embedding <=> $5::vector             -- cosine, top-K liên quan
LIMIT $7;
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

1. **Partition theo CHỦ SỞ HỮU.** Mọi read/write memory filter `(owner_kind, owner_id, channel, conversation_id)` — cả 4, không phải logic app tự nhớ.

   Có **hai loại chủ sở hữu**, và chúng nằm ở hai không gian định danh khác nhau:

   | `owner_kind` | `owner_id` | Khi nào | Fact là của |
   |--------------|-----------|---------|-------------|
   | `customer` | `customer_id` (derive từ `group_map`) | nhóm đã `/ketnoi-daily` | **PHÒNG** — phòng có cả nhân viên lẫn khách nói chung một mạch, nên fact là của phòng; ai nói chỉ là chi tiết ghi trong text fact |
   | `user` | `senderId` | agent `directOnly` (trợ lý riêng) chat 1-1 | **MỘT NGƯỜI** — không phòng khách nào sở hữu |

   `owner_kind` KHÔNG thừa: `customer_id` và `senderId` là chuỗi từ hai hệ khác nhau, trùng giá trị là chuyện có thể xảy ra — thiếu nó thì fact riêng tư của một người lọt vào phòng đại lý trùng id mà không cách nào phát hiện.

   Luật dựng scope (`worker/handler.ts`):
   ```
   agent directOnly + chat 1-1   → owner = user:senderId
   agent directOnly + nhóm       → KHÔNG scope (agent 1-1 lạc vào nhóm: không rõ fact của ai)
   nhóm đã /ketnoi-daily         → owner = customer:customer_id
   còn lại                       → KHÔNG scope
   ```
   `customer_id` derive từ `group_map` theo phòng, **không** lấy từ Identity người gõ (nhân viên không mang `customer_id`). Không có scope = **không đọc, không ghi** — không có rổ chung để đoán vào. Cùng một người ở hai phòng khác nhau **không** dùng chung trí nhớ; chat 1-1 với agent KHÔNG `directOnly` cũng không nhớ gì.
2. **DB-first — memory ≠ fact động.** KHÔNG lưu trạng thái động (tình trạng đơn, số dư, tồn kho) vào memory — thiu. Cái đó query DB lúc chạy. Memory chỉ giữ: sở thích, ngữ cảnh bền, tóm tắt episode.
3. **Memory informs, không authorizes.** Recalled memory có thể cũ/sai. Agent làm WRITE thật (refund/hủy) không được dựa memory → re-verify từ DB + qua [approval](./06-approval.md).

---

[← Mục lục kiến trúc](../ARCHITECTURE.md)
