-- 0010 — thêm llm_usage_log cho DB đã tạo trước khi bảng này có mặt.
-- Migration incremental viết TAY (không generate từ schema.ts): 0001 chỉ chạy 1 lần trên volume
-- rỗng. Volume rỗng chạy 0001 (đã có bảng) rồi 0010 (no-op nhờ IF NOT EXISTS).
-- Chạy: psql "$DATABASE_URL" -f migrations/0010_llm_usage_log.sql

BEGIN;

-- llm_usage_log — sổ cái chi phí LLM, mỗi lượt agent một row.
--
-- Đây là NGUỒN SỰ THẬT của rate limit: bộ đếm Redis chỉ là cache, mất Redis thì hạn mức trong
-- ngày dựng lại bằng SUM trên bảng này (nếu không thì mọi phòng reset về 0 và tiêu thoải mái).
--
-- Lưu CẢ token thô LẪN thành tiền: token là sự thật bất biến, tiền suy ra từ bảng giá lúc đó.
-- Đổi giá/đổi model sau này vẫn tính lại được lịch sử, và đối soát được với hoá đơn gateway.
CREATE TABLE IF NOT EXISTS llm_usage_log (
  id                  bigserial   PRIMARY KEY,
  conversation_id     text        NOT NULL,   -- PHÒNG: đơn vị gom hạn mức (không phải người gõ)
  agent_type          text        NOT NULL,   -- dealer | warehouse | ... → tra trần (usage/budget.ts)
  msg_id              text        NOT NULL,   -- envelope thật sự chạy LLM; chống ghi trùng khi retry
  -- NGÀY THEO GIỜ VN, app tính rồi bind vào. KHÔNG dùng CURRENT_DATE: server chạy UTC thì mốc
  -- nửa đêm lệch 7 tiếng → hạn mức reset lúc 7h sáng, đúng giờ nhóm đại lý bắt đầu làm việc.
  usage_day           date        NOT NULL,
  input_tokens        integer     NOT NULL,   -- cache miss
  output_tokens       integer     NOT NULL,
  cache_read_tokens   integer     NOT NULL,   -- cache hit
  cache_write_tokens  integer     NOT NULL,
  -- Thành tiền chốt theo bảng giá LÚC GHI, đơn vị pico-USD (1e-12 USD). bigint vì pico:
  -- một phòng một ngày ~4e11, integer (2,1e9) tràn ngay.
  cost_pico_usd       bigint      NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: một msgId chỉ vào sổ một lần dù broker giao lại lượt bao nhiêu lần.
CREATE UNIQUE INDEX IF NOT EXISTS llm_usage_log_msg_id_key
  ON llm_usage_log (msg_id);

-- Phục vụ đúng một query nóng: SUM chi phí của phòng trong ngày (dựng lại bộ đếm Redis).
CREATE INDEX IF NOT EXISTS llm_usage_log_room_day_idx
  ON llm_usage_log (conversation_id, usage_day);

COMMIT;
