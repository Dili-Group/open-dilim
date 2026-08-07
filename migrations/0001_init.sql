-- GENERATED từ src/db/schema.ts qua gen-migration.ts — KHÔNG sửa tay.
-- Chạy: psql "$DATABASE_URL" -f migrations/0001_init.sql
-- Chỉ Postgres. Redis (broker, short-term, order-lock, due-index ZSET, leader-lock) không ở đây.
-- Cần pgvector + pg13+ (gen_random_uuid built-in).

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- memory — DÀI HẠN (§7). Partition (owner_kind, owner_id, channel, conversation_id): filter cả 4.
CREATE TABLE IF NOT EXISTS memory (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind     text          NOT NULL,              -- customer (phòng đại lý) | user (1-1)
  owner_id       text          NOT NULL,              -- customer_id (group_map) HOẶC senderId
  channel       text          NOT NULL,              -- kênh chứa phòng (tránh đụng id giữa kênh)
  conversation_id text         NOT NULL,              -- phòng sở hữu fact — KHÔNG phải người gõ
  type          text          NOT NULL,              -- preference | context | episode ...
  text          text          NOT NULL,              -- 1 atomic fact self-contained
  embedding     vector(1536)  NOT NULL,  -- gemini-embedding-001
  source_msg_id   text,                                -- provenance: cite được, không bịa
  confidence    real,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_embedding_hnsw
  ON memory USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS memory_scope
  ON memory (owner_kind, owner_id, channel, conversation_id);

-- scheduler_jobs — CRON job def durable (§8). next_run_at vừa là due-index vừa là ô CAS claim.
CREATE TABLE IF NOT EXISTS scheduler_jobs (
  id           text        PRIMARY KEY,              -- slug ổn định hoặc uuid
  schedule     text        NOT NULL,                 -- cron 5 trường (giờ VN)
  channel      text        NOT NULL,                 -- chọn root agent + adapter egress NHƯ message
  identity     text        NOT NULL,                 -- senderId chạy job — auth resolve y hệt message
  task         text        NOT NULL,                 -- "kiểm tra gì"
  target       text        NOT NULL,                 -- đích broadcast
  enabled      boolean     NOT NULL DEFAULT true,
  next_run_at    timestamptz,
  last_run_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduler_jobs_due
  ON scheduler_jobs (next_run_at)
  WHERE enabled;

-- pending_actions — human-in-the-loop suspend/resume (§6).
CREATE TABLE IF NOT EXISTS pending_actions (
  approval_id     text        PRIMARY KEY,
  conversation_id text        NOT NULL,               -- kênh nhận reply duyệt
  workflow       text        NOT NULL,               -- workflow nào để resume
  state_snapshot  jsonb       NOT NULL,               -- resume từ chỗ dừng
  idempotency_key text        NOT NULL,               -- chống double-exec khi retry
  status         smallint    NOT NULL DEFAULT 0,  -- PendingStatus (numeric)
  approver       text        NOT NULL,               -- ai ĐƯỢC quyền duyệt
  requester_id    text,
  expires_at      timestamptz NOT NULL,               -- timeout job quét
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  CONSTRAINT pending_actions_status_chk CHECK (status IN (0, 1, 2, 3)),
  CONSTRAINT pending_actions_idem_uniq  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS pending_actions_timeout
  ON pending_actions (expires_at)
  WHERE status = 0;

-- group_map — (channel, group_id) → khách hàng X. Lookup runtime chạy thẳng PK.
CREATE TABLE IF NOT EXISTS group_map (
  channel      text        NOT NULL,                 -- zalo | fb | ... (tránh đụng group_id giữa kênh)
  group_id      text        NOT NULL,                 -- id nhóm từ hệ nguồn
  customer_id   text        NOT NULL,                 -- khách hàng X sở hữu nhóm
  enabled      boolean     NOT NULL DEFAULT true,    -- tắt nhóm không xoá lịch sử
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),   -- lần vết re-map khi import lại
  PRIMARY KEY (channel, group_id)
);

-- reverse lookup: liệt kê nhóm của 1 khách khi import/sync/admin.
CREATE INDEX IF NOT EXISTS group_map_customer
  ON group_map (customer_id);

-- user_binding — (channel, sender_id) → user_id hệ vận hành. Lookup mỗi tin chạy thẳng PK.
CREATE TABLE IF NOT EXISTS user_binding (
  channel      text        NOT NULL,                 -- zalo | fb | ...
  sender_id     text        NOT NULL,                 -- id gửi tin từ kênh
  user_id       text        NOT NULL,                 -- id hệ vận hành (từ token /ketnoi-hethong)
  op_token      text,                                 -- bearer hệ vận hành; KHÔNG log; null khi revoke
  role_slug     text,                                 -- vai nhân viên trong hệ vận hành (verify trả)
  full_name     text,                                 -- tên hiển thị nhân viên (verify trả)
  bound_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,                          -- null = active
  PRIMARY KEY (channel, sender_id)
);

-- reverse: 1 user_id đang bind mấy kênh/sender (revoke hàng loạt, audit).
CREATE INDEX IF NOT EXISTS user_binding_user
  ON user_binding (user_id)
  WHERE revoked_at IS NULL;

-- group_member — (channel, group_id, sender_id) → role. Set qua /ketnoi-dilim @mention.
-- customer_id KHÔNG ở đây: derive từ group_map lúc runtime. guest = KHÔNG có row.
CREATE TABLE IF NOT EXISTS group_member (
  channel     text        NOT NULL,                 -- zalo | fb | ...
  group_id     text        NOT NULL,                 -- nhóm chứa người được gán
  sender_id    text        NOT NULL,                 -- uid người được mention
  role        text        NOT NULL,                 -- GroupRole: dai_ly | guest
  assigned_by  text        NOT NULL,                 -- user_id nhân viên gán (audit)
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,                          -- null = active; set khi /huy-ketnoi
  PRIMARY KEY (channel, group_id, sender_id),
  CONSTRAINT group_member_role_chk CHECK (role IN ('dai_ly', 'guest'))
);

-- liệt kê thành viên active theo role trong 1 group (resolve runtime, admin).
CREATE INDEX IF NOT EXISTS group_member_role
  ON group_member (channel, group_id, role)
  WHERE revoked_at IS NULL;

-- group_block — nhóm bị /block: worker bỏ qua tin thường (flash command vẫn chạy).
CREATE TABLE IF NOT EXISTS group_block (
  channel     text        NOT NULL,
  group_id     text        NOT NULL,
  blocked_by   text        NOT NULL,                 -- user_id nhân viên chặn (audit)
  blocked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, group_id)
);

COMMIT;
