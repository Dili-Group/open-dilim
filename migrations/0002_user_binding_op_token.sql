-- 0002 — thêm op_token vào user_binding cho DB đã tạo trước khi cột này có mặt.
-- Migration incremental viết TAY (không generate từ schema.ts): 0001 dùng CREATE TABLE
-- IF NOT EXISTS nên không alter được bảng đã tồn tại. Volume rỗng chạy 0001 (đã có op_token)
-- rồi 0002 (no-op nhờ IF NOT EXISTS). Volume có data cũ chỉ 0002 thêm cột.
-- Chạy: psql "$DATABASE_URL" -f migrations/0002_user_binding_op_token.sql

BEGIN;

-- op_token: bearer (UUID) hệ vận hành đổi từ token lúc bind; KHÔNG log; null khi revoke.
ALTER TABLE user_binding ADD COLUMN IF NOT EXISTS op_token text;

COMMIT;
