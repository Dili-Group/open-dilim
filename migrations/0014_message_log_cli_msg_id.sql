-- 0014 — message_log nhận thêm `cli_msg_id` (Zalo cliMsgId, bridge gửi kèm webhook).
-- Migration incremental viết TAY: 0001 chỉ chạy một lần trên volume rỗng, bảng đã tồn tại thì
-- CREATE IF NOT EXISTS ở đó là no-op nên cột mới phải ALTER ở đây.
-- Chạy: psql "$DATABASE_URL" -f migrations/0014_message_log_cli_msg_id.sql

BEGIN;

-- Zalo đòi CẶP msg_id + cli_msg_id để quote-reply một tin. Nullable: tin cũ và channel khác
-- (Zalo OA, Messenger) không có.
ALTER TABLE message_log ADD COLUMN IF NOT EXISTS cli_msg_id text;

COMMIT;
