-- 0011 — thêm message_log cho DB đã tạo trước khi bảng này có mặt.
-- Migration incremental viết TAY (không generate từ schema.ts): 0001 chỉ chạy 1 lần trên volume
-- rỗng. Volume rỗng chạy 0001 (đã có bảng) rồi 0011 (no-op nhờ IF NOT EXISTS).
-- Chạy: psql "$DATABASE_URL" -f migrations/0011_message_log.sql

BEGIN;

-- message_log — RAW LOG mọi tin nhắn qua ingest (tầng 1 của knowledge base). Append-only,
-- KHÔNG sửa/xoá từng row: digest cuối ngày + fact chưng cất đều derive từ đây, prompt/model
-- đổi thì chạy lại được từ raw.
--
-- Khác history Redis (LTRIM 40 entry + TTL 7 ngày, chỉ phục vụ cửa sổ agent đọc): bảng này
-- giữ bền. Retention xử lý sau theo dải ts.
CREATE TABLE IF NOT EXISTS message_log (
  id                  bigserial   PRIMARY KEY,
  channel             text        NOT NULL,
  msg_id              text        NOT NULL,
  conversation_id     text        NOT NULL,
  sender_id           text        NOT NULL,
  sender_name         text,                     -- tên hiển thị lúc gửi, payload có thể thiếu
  role                text        NOT NULL DEFAULT 'user', -- ingest chỉ ghi user; chờ sẵn cho reply agent
  is_group            boolean     NOT NULL,
  addressed_to_agent  boolean     NOT NULL,     -- audit: tin này agent có được gọi không
  text                text        NOT NULL,
  image_url           text,                     -- con trỏ CDN, không tải nội dung
  -- EVENT TIME ms epoch (Envelope.ts). Mốc ngày giờ VN app tự tính khi query (cùng lý do
  -- usage_day ở llm_usage_log: server UTC thì CURRENT_DATE lệch 7 tiếng).
  ts                  bigint      NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Chốt bền chống ghi trùng khi webhook retry (dedupe Redis có TTL, hết hạn là quên).
CREATE UNIQUE INDEX IF NOT EXISTS message_log_msg_id_key
  ON message_log (channel, msg_id);

-- Đọc lại hội thoại một phòng theo thời gian (kiểm duyệt truy vết, distill lại).
CREATE INDEX IF NOT EXISTS message_log_room_ts_idx
  ON message_log (channel, conversation_id, ts);

-- Quét dải ngày xuyên phòng (digest cuối ngày). BRIN đủ: bảng append-only, ts tăng dần.
CREATE INDEX IF NOT EXISTS message_log_ts_brin
  ON message_log USING brin (ts);

COMMIT;
