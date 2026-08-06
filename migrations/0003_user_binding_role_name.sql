-- 0003 — thêm role_slug + full_name vào user_binding cho DB đã tạo trước khi cột này có mặt.
-- Migration incremental viết TAY (không generate từ schema.ts): 0001 dùng CREATE TABLE
-- IF NOT EXISTS nên không alter được bảng đã tồn tại. Volume rỗng chạy 0001 (đã có cột) rồi
-- 0003 (no-op nhờ IF NOT EXISTS). Volume có data cũ chỉ 0003 thêm cột.
-- Chạy: psql "$DATABASE_URL" -f migrations/0003_user_binding_role_name.sql

BEGIN;

-- role_slug: vai nhân viên trong hệ vận hành (verify trả). null nếu API không kèm.
ALTER TABLE user_binding ADD COLUMN IF NOT EXISTS role_slug text;
-- full_name: tên hiển thị nhân viên (verify trả) — để agent xưng hô đúng người.
ALTER TABLE user_binding ADD COLUMN IF NOT EXISTS full_name text;

COMMIT;
