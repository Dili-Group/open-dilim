-- 0013 — message_log nhận thêm con trỏ FILE TÀI LIỆU đính kèm (tool doc_file).
-- Migration incremental viết TAY: 0001 chỉ chạy một lần trên volume rỗng, bảng đã tồn tại thì
-- CREATE IF NOT EXISTS ở đó là no-op nên cột mới phải ALTER ở đây.
-- Chạy: psql "$DATABASE_URL" -f migrations/0013_message_log_file.sql

BEGIN;

-- Con trỏ CDN + tên file, nullable y như image_url: ingest KHÔNG tải nội dung, agent tự gọi
-- doc_file khi cần. Tin vừa có ảnh vừa có file thì hai cột độc lập nhau.
ALTER TABLE message_log ADD COLUMN IF NOT EXISTS file_url  text;
ALTER TABLE message_log ADD COLUMN IF NOT EXISTS file_name text;

COMMIT;
