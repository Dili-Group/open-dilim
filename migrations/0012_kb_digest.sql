-- 0012 — thêm 3 bảng kb-digest cho DB đã tạo trước khi tính năng này có mặt.
-- Migration incremental viết TAY (không generate từ schema.ts): 0001 chỉ chạy 1 lần trên volume
-- rỗng. Volume rỗng chạy 0001 (đã có bảng) rồi 0012 (no-op nhờ IF NOT EXISTS).
-- Chạy: psql "$DATABASE_URL" -f migrations/0012_kb_digest.sql

BEGIN;

-- kb_review_config — binding group kiểm duyệt + giờ chạy digest cuối ngày. MỘT row (id='main'),
-- ghi bằng /kiemduyet-kb trong chính group kiểm duyệt. Không env var, không hardcode id nhóm.
CREATE TABLE IF NOT EXISTS kb_review_config (
  id               text        PRIMARY KEY,
  channel          text        NOT NULL,
  conversation_id  text        NOT NULL,   -- group nhận digest + nơi gõ lệnh duyệt
  run_time         text        NOT NULL,   -- 'HH:MM' giờ VN
  enabled          boolean     NOT NULL DEFAULT true,
  created_by       text        NOT NULL,   -- user_id nhân viên bind (audit)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- kb_digest_run — claim mỗi (ngày VN, group): giành trước bằng INSERT ON CONFLICT DO NOTHING.
-- Crash giữa chừng → group chưa claim chạy tick sau; Failed là TERMINAL (không digest đôi).
-- Ngày theo GIỜ VN, app tính rồi bind (cùng lý do usage_day ở llm_usage_log).
CREATE TABLE IF NOT EXISTS kb_digest_run (
  day              date        NOT NULL,
  conversation_id  text        NOT NULL,
  status           smallint    NOT NULL CHECK (status IN (0, 1, 2)),  -- 0 running / 1 done / 2 failed
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  PRIMARY KEY (day, conversation_id)
);

-- kb_proposal — đề xuất KB chờ duyệt. Fact ẨN DANH (không tên đại lý); provenance
-- (channel, conversation_id nguồn) chỉ nằm ở đây để truy vết nội bộ, không lộ ra digest/fact.
-- Chỉ Approved mới được ghi vào bảng memory (scope org) qua /duyet-kb.
CREATE TABLE IF NOT EXISTS kb_proposal (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  day              date        NOT NULL,
  channel          text        NOT NULL,
  conversation_id  text        NOT NULL,
  fact_text        text        NOT NULL,
  status           smallint    NOT NULL DEFAULT 0 CHECK (status IN (0, 1, 2)),  -- 0 pending / 1 approved / 2 rejected
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_by       text,
  decided_at       timestamptz
);

-- Query nóng duy nhất: liệt kê + tra mã ngắn trong đống pending.
CREATE INDEX IF NOT EXISTS kb_proposal_pending_idx
  ON kb_proposal (created_at) WHERE status = 0;

COMMIT;
