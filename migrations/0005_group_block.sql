-- 0005 — thêm bảng group_block cho DB đã tạo trước khi bảng này có mặt.
-- Migration incremental viết TAY (không generate từ schema.ts): 0001 chỉ chạy 1 lần trên
-- volume rỗng. Volume rỗng chạy 0001 (đã có group_block) rồi 0005 (no-op nhờ IF NOT EXISTS).
-- Chạy: psql "$DATABASE_URL" -f migrations/0005_group_block.sql

BEGIN;

-- group_block — nhóm bị /block: worker bỏ qua tin thường (flash command vẫn chạy).
-- CÓ row = đang chặn; /unlock xoá row.
CREATE TABLE IF NOT EXISTS group_block (
  channel     text        NOT NULL,
  group_id    text        NOT NULL,
  blocked_by  text        NOT NULL,                 -- user_id nhân viên chặn (audit)
  blocked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, group_id)
);

COMMIT;
