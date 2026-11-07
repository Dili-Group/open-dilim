-- 0015 — thread_settings: setting theo thread (hiện chỉ tắt/bật trả lời, Zalo OA).
-- Migration incremental viết TAY, không nằm trong 0001 (gen:migration không dựng bảng này).
-- Chạy: psql "$DATABASE_URL" -f migrations/0015_thread_settings.sql

BEGIN;

-- Không có row = mặc định bật reply. Chỉ ghi khi có người set qua POST /webhook/:channel/setting.
CREATE TABLE IF NOT EXISTS thread_settings (
  channel        text        NOT NULL,
  thread_id      text        NOT NULL,
  reply_enabled  boolean     NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, thread_id)
);

COMMIT;
