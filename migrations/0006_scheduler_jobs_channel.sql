-- 0006 — đổi scheduler_jobs.agent_type → channel cho DB đã tạo trước khi scheduler có code.
-- Migration incremental viết TAY (không generate từ schema.ts): 0001 dùng CREATE TABLE
-- IF NOT EXISTS nên không alter được bảng đã tồn tại. Volume rỗng chạy 0001 (đã là `channel`)
-- rồi 0006 (no-op nhờ guard bên dưới). Volume có data cũ chỉ 0006 rename.
--
-- TẠI SAO đổi: Envelope mang `channel`, không mang agentType — channel vừa chọn root agent
-- (agents/router.ts) vừa chọn adapter egress. Lưu agent_type thì job không gửi đi đâu được.
-- Chạy: psql "$DATABASE_URL" -f migrations/0006_scheduler_jobs_channel.sql

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheduler_jobs' AND column_name = 'agent_type'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheduler_jobs' AND column_name = 'channel'
  ) THEN
    ALTER TABLE scheduler_jobs RENAME COLUMN agent_type TO channel;
  END IF;
END $$;

COMMIT;
