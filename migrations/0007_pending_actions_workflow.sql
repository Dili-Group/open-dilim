-- 0007 — mở rộng pending_actions thành "việc đang treo chờ người trả lời" cho MỌI workflow
-- (§6 + workflows/). Migration incremental viết TAY: 0001 dùng CREATE TABLE IF NOT EXISTS nên
-- không alter được bảng đã tồn tại.
--
-- Bốn cột mới:
--   channel        — kênh nhóm phải trả lời (chọn root agent + adapter egress, như message thường)
--   subject        — khoá nghiệp vụ (vd mã vận đơn hoàn); NULL cho việc không có khoá
--   ask_count      — số lần đã hỏi; đi vào msgId để dedupe chặn bắn trùng
--   next_remind_at — mốc nhắc kế tiếp, đồng thời là ô CAS claim (fire-once giữa nhiều instance)
--
-- Chạy: psql "$DATABASE_URL" -f migrations/0007_pending_actions_workflow.sql

BEGIN;

-- DEFAULT '' để ALTER chạy được cả khi bảng đã có row. Giữ nguyên default (giống 0001) — code
-- luôn khai channel tường minh, default chỉ là lưới cho row cũ.
ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS channel        text        NOT NULL DEFAULT '';
ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS subject        text;
ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS ask_count      integer     NOT NULL DEFAULT 0;
ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS next_remind_at timestamptz;

-- Gõ lại đúng khoá đang chờ → INSERT rơi vào ON CONFLICT, KHÔNG hỏi người ta lần thứ hai.
CREATE UNIQUE INDEX IF NOT EXISTS pending_actions_open_subject
  ON pending_actions (workflow, subject)
  WHERE status = 0 AND subject IS NOT NULL;

CREATE INDEX IF NOT EXISTS pending_actions_remind
  ON pending_actions (next_remind_at)
  WHERE status = 0;

COMMIT;
