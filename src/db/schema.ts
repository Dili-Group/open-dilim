// schema.ts — SINGLE SOURCE OF TRUTH cho Postgres schema.
//
// Mọi tên table/column/index/extension khai báo 1 lần ở đây. Query (state/memory.ts,
// scheduler/store.ts, state/pending.ts) tham chiếu constants, KHÔNG hardcode string.
// Migration SQL (migrations/*.sql) generate từ file này qua gen-migration.ts — không tự sửa .sql.

// gemini-embedding-001: output dim 1536 (Matryoshka). ≤2000 → HNSW thẳng, không halfvec.
export const EMBEDDING_DIM = 1536;

// pgvector — bật cho memory dài hạn.
export const EXTENSION_VECTOR = "vector";

// Trạng thái pending_action — numeric enum (lưu smallint, KHÔNG text: index nhỏ, so sánh nhanh).
// const-object thay vì `enum` TS → tránh reverse-mapping runtime, tree-shake được, no-any.
export const PendingStatus = {
  Pending: 0,
  Approved: 1,
  Denied: 2,
  Expired: 3,
} as const;
export type PendingStatus = (typeof PendingStatus)[keyof typeof PendingStatus];
export const PENDING_STATUS_VALUES: readonly number[] = Object.values(PendingStatus);

// Role trong group. nhan_vien KHÔNG ở đây — nhận diện qua user_binding (định danh toàn cục,
// không theo group). group_member chỉ lưu grant dai_ly; guest = KHÔNG có row (default đóng).
// guest lưu tường minh chỉ khi cần demote 1 người từng là dai_ly mà không xoá vết.
export const GroupRole = {
  DaiLy: "dai_ly",
  Guest: "guest",
} as const;
export type GroupRole = (typeof GroupRole)[keyof typeof GroupRole];
export const GROUP_ROLE_VALUES: readonly string[] = Object.values(GroupRole);

// ─────────────────────────────────────────────────────────────────────────────
// memory — DÀI HẠN (§7). Fact chưng cất. Partition (customer_id, channel, conversation_id).
// Memory thuộc về PHÒNG (nhân viên + khách nói chung một mạch), không về người gõ.
// customer_id giữ tenancy cứng → không lẫn phòng khách A sang B.
// ─────────────────────────────────────────────────────────────────────────────
export const MEMORY = {
  table: "memory",
  col: {
    id: "id",
    customerId: "customer_id",  // nhóm khách (từ group_map)
    channel: "channel",         // zalo | fb | ... (conversation_id chỉ unique trong kênh)
    conversationId: "conversation_id", // phòng chat sở hữu fact này
    type: "type",
    text: "text",
    embedding: "embedding",
    sourceMsgId: "source_msg_id",
    confidence: "confidence",
    createdAt: "created_at",
  },
  idx: {
    embeddingHnsw: "memory_embedding_hnsw",
    scope: "memory_scope",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// scheduler_jobs — CRON job def durable (§8). Redis ZSET là due-index runtime.
// ─────────────────────────────────────────────────────────────────────────────
export const SCHEDULER_JOBS = {
  table: "scheduler_jobs",
  col: {
    id: "id",
    schedule: "schedule",
    agentType: "agent_type",
    identity: "identity",
    task: "task",
    target: "target",
    enabled: "enabled",
    nextRunAt: "next_run_at",
    lastRunAt: "last_run_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  idx: {
    due: "scheduler_jobs_due",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// pending_actions — human-in-the-loop suspend/resume (§6).
// ─────────────────────────────────────────────────────────────────────────────
export const PENDING_ACTIONS = {
  table: "pending_actions",
  col: {
    approvalId: "approval_id",
    conversationId: "conversation_id",
    workflow: "workflow",
    stateSnapshot: "state_snapshot",
    idempotencyKey: "idempotency_key",
    status: "status",
    approver: "approver",
    requesterId: "requester_id",
    expiresAt: "expires_at",
    createdAt: "created_at",
    resolvedAt: "resolved_at",
  },
  idx: {
    timeout: "pending_actions_timeout",
    statusChk: "pending_actions_status_chk",
    idemUniq: "pending_actions_idem_uniq",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// group_map — (channel, group_id) → khách hàng X (auth). Định danh nhóm chat.
// id đến từ hệ nguồn (Zalo/FB/CRM) → KHÔNG FK. customer_id inject server-side, không tin payload.
// ─────────────────────────────────────────────────────────────────────────────
export const GROUP_MAP = {
  table: "group_map",
  col: {
    channel: "channel",
    groupId: "group_id",
    customerId: "customer_id",
    enabled: "enabled",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  idx: {
    customer: "group_map_customer",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// user_binding — (channel, sender_id) → user_id hệ vận hành. Tạo lúc /ketnoi-dilim.
// Định danh BỀN: sau bind, nhận diện nhân viên bằng sender_id, không gõ token lại.
// Role/permission KHÔNG ở đây — cache Redis session (TTL, refresh từ API) để tránh stale.
// op_token: bearer (UUID) đổi từ token lúc bind, giữ lại để ketnoi-daily gọi hệ vận hành
// act-as nhân viên (lấy customer_id đại lý). Read-only scope → lưu plaintext; KHÔNG log, null khi revoke.
// ─────────────────────────────────────────────────────────────────────────────
export const USER_BINDING = {
  table: "user_binding",
  col: {
    channel: "channel",
    senderId: "sender_id",   // id từ zalo/fb (webhook đã ký → tin được)
    userId: "user_id",       // id trong hệ vận hành
    opToken: "op_token",     // bearer (UUID) gọi hệ vận hành act-as nhân viên. KHÔNG log. Null khi revoke.
    roleSlug: "role_slug",   // vai nhân viên trong hệ vận hành (verify trả) — null nếu API không kèm
    fullName: "full_name",   // tên hiển thị nhân viên (verify trả) — để agent xưng hô đúng người
    boundAt: "bound_at",
    revokedAt: "revoked_at", // null = active; set khi đổi thiết bị / token mới
  },
  idx: {
    user: "user_binding_user", // reverse: 1 user_id bind mấy kênh/sender
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// group_member — (channel, group_id, sender_id) → role trong group. Set lúc nhân viên
// gõ /ketnoi-dilim @mention. Chỉ nhân viên (verify qua user_binding) được gán.
// customer_id KHÔNG lưu ở đây → derive từ group_map lúc runtime (single source of truth,
// tránh stale khi vận hành re-map group sang đại lý khác).
// Resolve role: user_binding(nhân viên) → group_member(đại lý) → else guest.
// ─────────────────────────────────────────────────────────────────────────────
export const GROUP_MEMBER = {
  table: "group_member",
  col: {
    channel: "channel",
    groupId: "group_id",
    senderId: "sender_id",     // id người được mention (từ mention entity uid, KHÔNG parse tên)
    role: "role",              // GroupRole — dai_ly | guest
    assignedBy: "assigned_by", // user_id nhân viên gán (audit: ai phong ai)
    assignedAt: "assigned_at",
    revokedAt: "revoked_at",   // null = active; set khi /huy-ketnoi (kế toán nghỉ)
  },
  idx: {
    role: "group_member_role",       // liệt kê thành viên theo role trong 1 group
    roleChk: "group_member_role_chk",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// DDL builder — generate init migration từ constants trên.
// Idempotent (IF NOT EXISTS), bọc BEGIN/COMMIT. Chạy lại an toàn.
// ─────────────────────────────────────────────────────────────────────────────
export function buildInitSql(): string {
  const m = MEMORY;
  const s = SCHEDULER_JOBS;
  const p = PENDING_ACTIONS;
  const g = GROUP_MAP;
  const b = USER_BINDING;
  const gm = GROUP_MEMBER;
  const statusList = PENDING_STATUS_VALUES.join(", ");
  const roleList = GROUP_ROLE_VALUES.map((r) => `'${r}'`).join(", ");

  return `-- GENERATED từ src/db/schema.ts qua gen-migration.ts — KHÔNG sửa tay.
-- Chạy: psql "$DATABASE_URL" -f migrations/0001_init.sql
-- Chỉ Postgres. Redis (broker, short-term, order-lock, due-index ZSET, leader-lock) không ở đây.
-- Cần pgvector + pg13+ (gen_random_uuid built-in).

BEGIN;

CREATE EXTENSION IF NOT EXISTS ${EXTENSION_VECTOR};

-- memory — DÀI HẠN (§7). Partition (customer_id, channel, conversation_id): read/write filter cả 3.
CREATE TABLE IF NOT EXISTS ${m.table} (
  ${m.col.id}            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  ${m.col.customerId}    text          NOT NULL,              -- nhóm khách (từ group_map)
  ${m.col.channel}       text          NOT NULL,              -- kênh chứa phòng (tránh đụng id giữa kênh)
  ${m.col.conversationId} text         NOT NULL,              -- phòng sở hữu fact — KHÔNG phải người gõ
  ${m.col.type}          text          NOT NULL,              -- preference | context | episode ...
  ${m.col.text}          text          NOT NULL,              -- 1 atomic fact self-contained
  ${m.col.embedding}     vector(${EMBEDDING_DIM})  NOT NULL,  -- gemini-embedding-001
  ${m.col.sourceMsgId}   text,                                -- provenance: cite được, không bịa
  ${m.col.confidence}    real,
  ${m.col.createdAt}     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ${m.idx.embeddingHnsw}
  ON ${m.table} USING hnsw (${m.col.embedding} vector_cosine_ops);

CREATE INDEX IF NOT EXISTS ${m.idx.scope}
  ON ${m.table} (${m.col.customerId}, ${m.col.channel}, ${m.col.conversationId});

-- scheduler_jobs — CRON job def durable (§8). Nguồn rebuild Redis ZSET.
CREATE TABLE IF NOT EXISTS ${s.table} (
  ${s.col.id}           text        PRIMARY KEY,              -- slug ổn định hoặc uuid
  ${s.col.schedule}     text        NOT NULL,                 -- cron expr hoặc interval
  ${s.col.agentType}    text        NOT NULL,                 -- validate whitelist NHƯ message
  ${s.col.identity}     text        NOT NULL,                 -- service/user chạy job — auth gate
  ${s.col.task}         text        NOT NULL,                 -- "kiểm tra gì"
  ${s.col.target}       text        NOT NULL,                 -- đích broadcast
  ${s.col.enabled}      boolean     NOT NULL DEFAULT true,
  ${s.col.nextRunAt}    timestamptz,
  ${s.col.lastRunAt}    timestamptz,
  ${s.col.createdAt}    timestamptz NOT NULL DEFAULT now(),
  ${s.col.updatedAt}    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ${s.idx.due}
  ON ${s.table} (${s.col.nextRunAt})
  WHERE ${s.col.enabled};

-- pending_actions — human-in-the-loop suspend/resume (§6).
CREATE TABLE IF NOT EXISTS ${p.table} (
  ${p.col.approvalId}     text        PRIMARY KEY,
  ${p.col.conversationId} text        NOT NULL,               -- kênh nhận reply duyệt
  ${p.col.workflow}       text        NOT NULL,               -- workflow nào để resume
  ${p.col.stateSnapshot}  jsonb       NOT NULL,               -- resume từ chỗ dừng
  ${p.col.idempotencyKey} text        NOT NULL,               -- chống double-exec khi retry
  ${p.col.status}         smallint    NOT NULL DEFAULT ${PendingStatus.Pending},  -- PendingStatus (numeric)
  ${p.col.approver}       text        NOT NULL,               -- ai ĐƯỢC quyền duyệt
  ${p.col.requesterId}    text,
  ${p.col.expiresAt}      timestamptz NOT NULL,               -- timeout job quét
  ${p.col.createdAt}      timestamptz NOT NULL DEFAULT now(),
  ${p.col.resolvedAt}     timestamptz,
  CONSTRAINT ${p.idx.statusChk} CHECK (${p.col.status} IN (${statusList})),
  CONSTRAINT ${p.idx.idemUniq}  UNIQUE (${p.col.idempotencyKey})
);

CREATE INDEX IF NOT EXISTS ${p.idx.timeout}
  ON ${p.table} (${p.col.expiresAt})
  WHERE ${p.col.status} = ${PendingStatus.Pending};

-- group_map — (channel, group_id) → khách hàng X. Lookup runtime chạy thẳng PK.
CREATE TABLE IF NOT EXISTS ${g.table} (
  ${g.col.channel}      text        NOT NULL,                 -- zalo | fb | ... (tránh đụng group_id giữa kênh)
  ${g.col.groupId}      text        NOT NULL,                 -- id nhóm từ hệ nguồn
  ${g.col.customerId}   text        NOT NULL,                 -- khách hàng X sở hữu nhóm
  ${g.col.enabled}      boolean     NOT NULL DEFAULT true,    -- tắt nhóm không xoá lịch sử
  ${g.col.createdAt}    timestamptz NOT NULL DEFAULT now(),
  ${g.col.updatedAt}    timestamptz NOT NULL DEFAULT now(),   -- lần vết re-map khi import lại
  PRIMARY KEY (${g.col.channel}, ${g.col.groupId})
);

-- reverse lookup: liệt kê nhóm của 1 khách khi import/sync/admin.
CREATE INDEX IF NOT EXISTS ${g.idx.customer}
  ON ${g.table} (${g.col.customerId});

-- user_binding — (channel, sender_id) → user_id hệ vận hành. Lookup mỗi tin chạy thẳng PK.
CREATE TABLE IF NOT EXISTS ${b.table} (
  ${b.col.channel}      text        NOT NULL,                 -- zalo | fb | ...
  ${b.col.senderId}     text        NOT NULL,                 -- id gửi tin từ kênh
  ${b.col.userId}       text        NOT NULL,                 -- id hệ vận hành (từ token /ketnoi-hethong)
  ${b.col.opToken}      text,                                 -- bearer hệ vận hành; KHÔNG log; null khi revoke
  ${b.col.roleSlug}     text,                                 -- vai nhân viên trong hệ vận hành (verify trả)
  ${b.col.fullName}     text,                                 -- tên hiển thị nhân viên (verify trả)
  ${b.col.boundAt}      timestamptz NOT NULL DEFAULT now(),
  ${b.col.revokedAt}    timestamptz,                          -- null = active
  PRIMARY KEY (${b.col.channel}, ${b.col.senderId})
);

-- reverse: 1 user_id đang bind mấy kênh/sender (revoke hàng loạt, audit).
CREATE INDEX IF NOT EXISTS ${b.idx.user}
  ON ${b.table} (${b.col.userId})
  WHERE ${b.col.revokedAt} IS NULL;

-- group_member — (channel, group_id, sender_id) → role. Set qua /ketnoi-dilim @mention.
-- customer_id KHÔNG ở đây: derive từ group_map lúc runtime. guest = KHÔNG có row.
CREATE TABLE IF NOT EXISTS ${gm.table} (
  ${gm.col.channel}     text        NOT NULL,                 -- zalo | fb | ...
  ${gm.col.groupId}     text        NOT NULL,                 -- nhóm chứa người được gán
  ${gm.col.senderId}    text        NOT NULL,                 -- uid người được mention
  ${gm.col.role}        text        NOT NULL,                 -- GroupRole: dai_ly | guest
  ${gm.col.assignedBy}  text        NOT NULL,                 -- user_id nhân viên gán (audit)
  ${gm.col.assignedAt}  timestamptz NOT NULL DEFAULT now(),
  ${gm.col.revokedAt}   timestamptz,                          -- null = active; set khi /huy-ketnoi
  PRIMARY KEY (${gm.col.channel}, ${gm.col.groupId}, ${gm.col.senderId}),
  CONSTRAINT ${gm.idx.roleChk} CHECK (${gm.col.role} IN (${roleList}))
);

-- liệt kê thành viên active theo role trong 1 group (resolve runtime, admin).
CREATE INDEX IF NOT EXISTS ${gm.idx.role}
  ON ${gm.table} (${gm.col.channel}, ${gm.col.groupId}, ${gm.col.role})
  WHERE ${gm.col.revokedAt} IS NULL;

COMMIT;
`;
}
