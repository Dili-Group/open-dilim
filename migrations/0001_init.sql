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

-- pending_actions — việc đang treo chờ người trả lời (§6). 1 bảng cho MỌI workflow.
CREATE TABLE IF NOT EXISTS pending_actions (
  approval_id     text        PRIMARY KEY,
  conversation_id text        NOT NULL,               -- nhóm PHẢI trả lời
  channel        text        NOT NULL DEFAULT '',    -- kênh của nhóm đó (chọn agent + egress)
  workflow       text        NOT NULL,               -- workflow nào để resume
  subject        text,                               -- khoá nghiệp vụ (mã đơn hoàn...)
  state_snapshot  jsonb       NOT NULL,               -- resume từ chỗ dừng
  idempotency_key text        NOT NULL,               -- chống double-exec khi retry
  status         smallint    NOT NULL DEFAULT 0,  -- PendingStatus (numeric)
  approver       text        NOT NULL,               -- ai ĐƯỢC quyền trả lời/duyệt
  requester_id    text,
  ask_count       integer     NOT NULL DEFAULT 0,     -- số lần đã hỏi (vào msgId dedupe)
  next_remind_at   timestamptz,                        -- mốc nhắc kế + ô CAS claim
  expires_at      timestamptz NOT NULL,               -- timeout job quét
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  CONSTRAINT pending_actions_status_chk CHECK (status IN (0, 1, 2, 3)),
  CONSTRAINT pending_actions_idem_uniq  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS pending_actions_timeout
  ON pending_actions (expires_at)
  WHERE status = 0;

-- Gõ lại đúng khoá đang chờ → INSERT rơi vào ON CONFLICT, KHÔNG hỏi người ta lần thứ hai.
CREATE UNIQUE INDEX IF NOT EXISTS pending_actions_open_subject
  ON pending_actions (workflow, subject)
  WHERE status = 0 AND subject IS NOT NULL;

CREATE INDEX IF NOT EXISTS pending_actions_remind
  ON pending_actions (next_remind_at)
  WHERE status = 0;

-- announcements — bản gốc MỘT tin phát chung. Text soạn 1 lần, mọi nhóm đọc y hệt nhau.
-- Nằm ở AwaitingApproval cho tới khi người duyệt đích danh gật; trước đó không row nhận nào tới hạn.
CREATE TABLE IF NOT EXISTS announcements (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text        NOT NULL,       -- het_hang | ... (soát/thống kê)
  text               text        NOT NULL,       -- NGUYÊN VĂN gửi đi
  status             smallint    NOT NULL DEFAULT 0,
  created_by          text        NOT NULL,       -- senderId thủ kho chốt (audit)
  origin_channel      text        NOT NULL,       -- phòng báo ngược kết quả duyệt
  origin_conversation text        NOT NULL,
  approved_by         text,                       -- user_id người duyệt (audit)
  approved_at         timestamptz,
  reject_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcements_status_chk CHECK (status IN (0, 1, 2))
);

CREATE INDEX IF NOT EXISTS announcements_awaiting
  ON announcements (created_at)
  WHERE status = 0;

-- announcement_deliveries — 1 row mỗi nhóm nhận. Poller gửi + retry; sống qua restart.
CREATE TABLE IF NOT EXISTS announcement_deliveries (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid        NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  channel        text        NOT NULL,
  group_id        text        NOT NULL,
  customer_id     text        NOT NULL,           -- đại lý sở hữu nhóm (soát ai chưa nhận)
  status         smallint    NOT NULL DEFAULT 0,
  attempts       integer     NOT NULL DEFAULT 0,
  last_error      text,                           -- lý do lần hỏng gần nhất
  next_attempt_at  timestamptz,                    -- mốc thử kế + ô CAS claim; NULL = chưa duyệt HOẶC thôi thử
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcement_deliveries_status_chk CHECK (status IN (0, 1, 2))
);

-- Một nhóm nhận MỘT lần mỗi đợt phát. Chặn ở DB: insert lại (retry lượt tool) không nhân đôi tin.
CREATE UNIQUE INDEX IF NOT EXISTS announcement_deliveries_target_uniq
  ON announcement_deliveries (announcement_id, channel, group_id);

CREATE INDEX IF NOT EXISTS announcement_deliveries_due
  ON announcement_deliveries (next_attempt_at)
  WHERE status = 0;

CREATE INDEX IF NOT EXISTS announcement_deliveries_by_announcement
  ON announcement_deliveries (announcement_id);

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

-- llm_usage_log — sổ cái chi phí LLM, mỗi lượt agent một row. Nguồn sự thật của rate limit theo
-- phòng: bộ đếm Redis là cache, mất nó thì hạn mức trong ngày dựng lại bằng SUM trên bảng này.
CREATE TABLE IF NOT EXISTS llm_usage_log (
  id                bigserial   PRIMARY KEY,
  conversation_id    text        NOT NULL,   -- PHÒNG: đơn vị gom hạn mức
  agent_type         text        NOT NULL,   -- dealer | warehouse | ... → tra trần
  msg_id             text        NOT NULL,   -- envelope chạy LLM; chống ghi trùng
  -- NGÀY GIỜ VN, app tính rồi bind. KHÔNG dùng CURRENT_DATE: server chạy UTC thì mốc nửa đêm
  -- lệch 7 tiếng → hạn mức reset lúc 7h sáng, đúng giờ nhóm đại lý bắt đầu làm việc.
  usage_day          date        NOT NULL,
  input_tokens       integer     NOT NULL,   -- cache miss
  output_tokens      integer     NOT NULL,
  cache_read_tokens   integer     NOT NULL,   -- cache hit
  cache_write_tokens  integer     NOT NULL,
  -- pico-USD (1e-12 USD) theo bảng giá lúc ghi. bigint: một phòng một ngày ~4e11, integer tràn.
  cost_pico_usd       bigint      NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- một msgId chỉ vào sổ một lần dù broker giao lại lượt bao nhiêu lần.
CREATE UNIQUE INDEX IF NOT EXISTS llm_usage_log_msg_id_key
  ON llm_usage_log (msg_id);

-- query nóng duy nhất: SUM chi phí phòng trong ngày (dựng lại bộ đếm Redis).
CREATE INDEX IF NOT EXISTS llm_usage_log_room_day_idx
  ON llm_usage_log (conversation_id, usage_day);

-- message_log — RAW LOG mọi tin qua ingest (tầng 1 knowledge base). Append-only, giữ bền —
-- khác history Redis (LTRIM + TTL). Digest/chưng cất derive từ đây, sai thì chạy lại được.
CREATE TABLE IF NOT EXISTS message_log (
  id                bigserial   PRIMARY KEY,
  channel           text        NOT NULL,
  msg_id             text        NOT NULL,
  conversation_id    text        NOT NULL,
  sender_id          text        NOT NULL,
  sender_name        text,                     -- tên hiển thị lúc gửi, payload có thể thiếu
  role              text        NOT NULL DEFAULT 'user', -- ingest chỉ ghi user; chờ sẵn cho reply agent
  is_group           boolean     NOT NULL,
  addressed_to_agent  boolean     NOT NULL,     -- audit: tin này agent có được gọi không
  text              text        NOT NULL,
  image_url          text,                     -- con trỏ CDN, không tải nội dung
  -- EVENT TIME ms epoch (Envelope.ts). Mốc ngày giờ VN app tự tính khi query (cùng lý do
  -- usage_day ở llm_usage_log: server UTC thì CURRENT_DATE lệch 7 tiếng).
  ts                bigint      NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Chốt bền chống ghi trùng khi webhook retry (dedupe Redis có TTL, hết hạn là quên).
CREATE UNIQUE INDEX IF NOT EXISTS message_log_msg_id_key
  ON message_log (channel, msg_id);

-- Đọc lại hội thoại một phòng theo thời gian (kiểm duyệt truy vết, distill lại).
CREATE INDEX IF NOT EXISTS message_log_room_ts_idx
  ON message_log (channel, conversation_id, ts);

-- Quét dải ngày xuyên phòng (digest cuối ngày). BRIN đủ: bảng append-only, ts tăng dần.
CREATE INDEX IF NOT EXISTS message_log_ts_brin
  ON message_log USING brin (ts);

-- kb_review_config — binding group kiểm duyệt + giờ chạy digest. MỘT row (id='main'),
-- ghi bằng /kiemduyet-kb trong chính group kiểm duyệt. Không env var, không hardcode id nhóm.
CREATE TABLE IF NOT EXISTS kb_review_config (
  id              text        PRIMARY KEY,
  channel         text        NOT NULL,
  conversation_id  text        NOT NULL,   -- group nhận digest + nơi gõ lệnh duyệt
  run_time         text        NOT NULL,   -- 'HH:MM' giờ VN
  enabled         boolean     NOT NULL DEFAULT true,
  created_by       text        NOT NULL,   -- user_id nhân viên bind (audit)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- kb_digest_run — claim mỗi (ngày VN, group): giành trước bằng INSERT ON CONFLICT DO NOTHING.
-- Crash giữa chừng → group chưa claim chạy tick sau; Failed là TERMINAL (không digest đôi).
CREATE TABLE IF NOT EXISTS kb_digest_run (
  day             date        NOT NULL,
  conversation_id  text        NOT NULL,
  status          smallint    NOT NULL CHECK (status IN (0, 1, 2)),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  PRIMARY KEY (day, conversation_id)
);

-- kb_proposal — đề xuất KB chờ duyệt. Fact ẨN DANH; provenance (channel, conversation_id)
-- chỉ nằm ở đây để truy vết nội bộ. Approved mới được ghi vào memory (scope org).
CREATE TABLE IF NOT EXISTS kb_proposal (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  day             date        NOT NULL,
  channel         text        NOT NULL,
  conversation_id  text        NOT NULL,
  fact_text        text        NOT NULL,
  status          smallint    NOT NULL DEFAULT 0 CHECK (status IN (0, 1, 2)),
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_by       text,
  decided_at       timestamptz
);

-- Query nóng duy nhất: liệt kê + tra mã ngắn trong đống pending.
CREATE INDEX IF NOT EXISTS kb_proposal_pending_idx
  ON kb_proposal (created_at) WHERE status = 0;

COMMIT;
