-- 0004 — memory: customer_id → owner_id + thêm owner_kind, cho trí nhớ chat 1-1.
--
-- Vì sao: fact 1-1 thuộc về MỘT NGƯỜI (senderId), không thuộc phòng đại lý nào. Hai loại chủ
-- sở hữu nằm ở hai không gian định danh khác nhau, nên phải có `owner_kind` — thiếu nó thì một
-- customer_id trùng chuỗi với một senderId sẽ dùng chung phân vùng.
--
-- Migration incremental viết TAY (không generate từ schema.ts): 0001 dùng CREATE TABLE
-- IF NOT EXISTS nên không alter được bảng đã tồn tại. Volume rỗng chạy 0001 (đã đúng cột) rồi
-- 0004 (no-op nhờ các guard bên dưới). Volume có data cũ chỉ 0004 đổi cột.
--
-- Data cũ: mọi row hiện có đều là fact phòng đại lý → owner_kind='customer'. Không mất dữ liệu,
-- không phải backfill tay.
--
-- Chạy: psql "$DATABASE_URL" -f migrations/0004_memory_owner.sql

BEGIN;

-- Rename có điều kiện: chạy lại lần hai không được lỗi "column does not exist".
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memory' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE memory RENAME COLUMN customer_id TO owner_id;
  END IF;
END $$;

-- DEFAULT 'customer' để row cũ (fact phòng đại lý) được gắn đúng loại ngay khi thêm cột.
ALTER TABLE memory ADD COLUMN IF NOT EXISTS owner_kind text NOT NULL DEFAULT 'customer';

-- Index scope phải dẫn đầu bằng owner_kind + owner_id: mọi query lọc đủ 4 cột.
DROP INDEX IF EXISTS memory_scope;
CREATE INDEX IF NOT EXISTS memory_scope
  ON memory (owner_kind, owner_id, channel, conversation_id);

COMMIT;
