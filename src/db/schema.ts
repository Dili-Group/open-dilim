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

// Trạng thái một ĐỢT phát tin. Đợt phát KHÔNG tự chạy sau khi thủ kho chốt: nó nằm ở
// AwaitingApproval cho tới khi người duyệt đích danh (CONFIG.announce.approverUserId) gật.
// Fail-closed: mọi trạng thái khác Approved đều KHÔNG có row nhận nào tới hạn gửi.
export const AnnouncementStatus = {
  AwaitingApproval: 0,
  Approved: 1,
  Rejected: 2,
} as const;
export type AnnouncementStatus = (typeof AnnouncementStatus)[keyof typeof AnnouncementStatus];
export const ANNOUNCEMENT_STATUS_VALUES: readonly number[] = Object.values(AnnouncementStatus);

// Trạng thái một lượt GIAO tin phát chung tới một nhóm. Cùng thủ pháp numeric enum như
// PendingStatus. Tách khỏi PendingStatus vì vòng đời khác hẳn: ở đây không có ai duyệt/từ chối,
// chỉ có "chưa gửi → gửi được / chịu thua".
export const DeliveryStatus = {
  Pending: 0,
  Sent: 1,
  /** Hết lượt thử. KHÔNG tự gửi lại nữa — người phát phải tự quyết làm gì tiếp. */
  Failed: 2,
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];
export const DELIVERY_STATUS_VALUES: readonly number[] = Object.values(DeliveryStatus);

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
// memory — DÀI HẠN (§7). Fact chưng cất. Partition (owner_kind, owner_id, channel,
// conversation_id) — LỌC CẢ 4 ở mọi query.
//
// CHỦ SỞ HỮU fact có hai loại, và chúng nằm ở HAI KHÔNG GIAN ĐỊNH DANH KHÁC NHAU:
//   owner_kind='customer' → owner_id = customer_id (từ group_map) — fact của PHÒNG đại lý
//   owner_kind='user'     → owner_id = senderId    — fact của MỘT NGƯỜI, chat 1-1
//   owner_kind='room'     → owner_id = conversationId — fact của NHÓM CHƯA bind (chưa biết của
//                            đại lý nào, vẫn thu thập đặc trưng + vấn đề của nhóm)
// Thiếu owner_kind thì một customer_id trùng chuỗi với một senderId sẽ chung phân vùng.
// ─────────────────────────────────────────────────────────────────────────────
export const MEMORY = {
  table: "memory",
  col: {
    id: "id",
    ownerKind: "owner_kind",    // customer (phòng đại lý) | user (chat 1-1) | room (nhóm chưa bind)
    ownerId: "owner_id",        // customer_id từ group_map, HOẶC senderId khi kind=user
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
// scheduler_jobs — CRON job def durable (§8). Index `next_run_at` LÀ due-index; poller claim
// bằng compare-and-swap trên cột đó (không có ZSET/leader-lock — xem docs §8).
// ─────────────────────────────────────────────────────────────────────────────
export const SCHEDULER_JOBS = {
  table: "scheduler_jobs",
  col: {
    id: "id",
    schedule: "schedule",
    channel: "channel",
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
// pending_actions — VIỆC ĐANG TREO chờ người trả lời (§6). MỘT bảng cho MỌI nghiệp vụ: cột
// `workflow` nói đó là việc gì, `state_snapshot` giữ dữ kiện riêng của việc đó. Thêm nghiệp vụ
// KHÔNG thêm bảng — thêm một WorkflowDef ở workflows/defs/.
//
// Hai kiểu "chờ người" dùng chung bảng này:
//   - duyệt (§6 gốc): hỏi NGƯỜI CÓ QUYỀN → approved/denied.
//   - hỏi dữ kiện    : hỏi NHÓM BIẾT VIỆC (vd nhóm đại lý) → câu trả lời lưu vào state_snapshot.
// Khác nhau ở WorkflowDef, không khác ở bảng.
//
// `conversation_id` = nhóm PHẢI TRẢ LỜI (nơi phát yêu cầu tới), `channel` = kênh của nhóm đó
// (chọn root agent + adapter egress). Nhóm ĐÃ HỎI nằm trong `state_snapshot` — nó chỉ là đích
// báo kết quả, không tham gia truy vấn nào.
//
// `next_remind_at` vừa là due-index vừa là ô CAS claim — cùng thủ pháp fire-once như
// scheduler_jobs.next_run_at, để hai instance cùng tick không nhắc người ta hai lần.
// ─────────────────────────────────────────────────────────────────────────────
export const PENDING_ACTIONS = {
  table: "pending_actions",
  col: {
    approvalId: "approval_id",
    conversationId: "conversation_id",
    channel: "channel",              // kênh nhóm phải trả lời — NHƯ message thường
    workflow: "workflow",
    subject: "subject",              // khoá nghiệp vụ (mã đơn hoàn...); NULL = việc không có khoá
    stateSnapshot: "state_snapshot",
    idempotencyKey: "idempotency_key",
    status: "status",
    approver: "approver",
    requesterId: "requester_id",
    askCount: "ask_count",           // số lần đã hỏi (lần đầu tính 1) — vào msgId chống bắn trùng
    nextRemindAt: "next_remind_at",  // mốc nhắc kế + ô CAS claim; NULL = không nhắc nữa
    expiresAt: "expires_at",
    createdAt: "created_at",
    resolvedAt: "resolved_at",
  },
  idx: {
    timeout: "pending_actions_timeout",
    statusChk: "pending_actions_status_chk",
    idemUniq: "pending_actions_idem_uniq",
    /** MỘT việc đang treo cho mỗi (workflow, subject) — hỏi lại thứ đang chờ là làm phiền 2 lần. */
    openSubject: "pending_actions_open_subject",
    /** Poller quét theo mốc nhắc. */
    remind: "pending_actions_remind",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// announcements — MỘT tin phát chung tới nhiều nhóm đại lý (vd kho báo hết hàng).
//
// Text soạn ĐÚNG MỘT LẦN và nằm ở đây, không sinh lại cho từng nhóm: mọi đại lý phải đọc đúng
// cùng một câu. Bảng này là bản gốc; ai đã nhận nằm ở announcement_deliveries.
//
// TÁCH khỏi pending_actions dù cùng là "việc chờ chạy": pending_actions hỏi MỘT nhóm rồi chờ
// MỘT đáp án (unique (workflow, subject) khi treo, có ask_count/next_remind_at/answer). Phát tin
// là bắn N nhóm và không chờ ai — dùng chung bảng thì poller việc-treo sẽ nhặt nhầm row và cố
// `dispatchAsk` chúng.
//
// HAI CHỮ KÝ mới phát được: thủ kho chốt (`created_by`) rồi người duyệt đích danh gật
// (`approved_by`). Trước khi gật, mọi row nhận có `next_attempt_at = NULL` nên không tick nào
// nhặt — cửa duyệt nằm ở DỮ LIỆU, không ở prompt.
// ─────────────────────────────────────────────────────────────────────────────
export const ANNOUNCEMENTS = {
  table: "announcements",
  col: {
    id: "id",
    kind: "kind",             // loại tin (het_hang...) — để soát/thống kê, không đổi cách gửi
    text: "text",             // NGUYÊN VĂN gửi đi. Không template hoá, không sinh lại lúc gửi
    status: "status",         // AnnouncementStatus — chỉ Approved mới có row tới hạn gửi
    createdBy: "created_by",  // senderId thủ kho chốt (audit: ai xin phát tin toàn hệ)
    // Phòng thủ kho đã chốt — đích báo ngược "đã duyệt / bị từ chối". Cùng vai trò `origin` của
    // việc treo: người chờ kết quả không nhất thiết còn ở lượt nào đang chạy.
    originChannel: "origin_channel",
    originConversation: "origin_conversation",
    approvedBy: "approved_by",     // user_id người duyệt (audit: ai cho phát)
    approvedAt: "approved_at",
    rejectReason: "reject_reason", // lý do từ chối, để thủ kho biết sửa gì
    createdAt: "created_at",
  },
  idx: {
    /** Liệt kê đợt đang chờ duyệt cho người duyệt soát. */
    awaiting: "announcements_awaiting",
    statusChk: "announcements_status_chk",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// announcement_deliveries — MỘT ROW MỖI NHÓM NHẬN. Đây là chỗ "N đại lý = N bản ghi bền":
// worker chết giữa đợt phát thì các row chưa gửi vẫn còn, poller tick sau gửi tiếp.
//
// `next_attempt_at` vừa là due-index vừa là ô CAS claim — cùng thủ pháp fire-once như
// scheduler_jobs.next_run_at và pending_actions.next_remind_at, để hai instance cùng tick không
// gửi cho một nhóm hai lần.
// ─────────────────────────────────────────────────────────────────────────────
export const ANNOUNCEMENT_DELIVERIES = {
  table: "announcement_deliveries",
  col: {
    id: "id",
    announcementId: "announcement_id",
    channel: "channel",
    groupId: "group_id",
    customerId: "customer_id",       // đại lý sở hữu nhóm — để soát "đại lý nào chưa nhận"
    status: "status",                // DeliveryStatus
    attempts: "attempts",            // số lần đã thử gửi
    lastError: "last_error",         // lý do lần hỏng gần nhất — để người phát biết vì sao
    // Mốc thử kế + ô CAS claim. NULL có HAI nghĩa, cả hai đều là "không tick nào nhặt": đợt phát
    // chưa được duyệt (row sinh ra đã NULL), hoặc lượt này đã xong/chịu thua.
    nextAttemptAt: "next_attempt_at",
    sentAt: "sent_at",
    createdAt: "created_at",
  },
  idx: {
    /** Poller quét theo mốc thử kế. */
    due: "announcement_deliveries_due",
    /** Soát một đợt phát: bao nhiêu sent/failed, nhóm nào lỗi. */
    byAnnouncement: "announcement_deliveries_by_announcement",
    /** Một nhóm nhận MỘT lần cho mỗi đợt phát — chặn cứng ở DB, không dựa vào code gọi đúng. */
    targetUniq: "announcement_deliveries_target_uniq",
    statusChk: "announcement_deliveries_status_chk",
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
// group_block — nhóm bị TẮT agent (/block). CÓ row = chặn, /unlock xoá row.
// Tách khỏi group_map.enabled: chặn là quyết định vận hành tạm thời, không được đụng
// quyền đại lý lẫn trí nhớ của nhóm (enabled=false tắt cả hai).
// ─────────────────────────────────────────────────────────────────────────────
export const GROUP_BLOCK = {
  table: "group_block",
  col: {
    channel: "channel",
    groupId: "group_id",
    blockedBy: "blocked_by", // user_id nhân viên chặn (audit: ai chặn nhóm nào)
    blockedAt: "blocked_at",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// llm_usage_log — SỔ CÁI chi phí LLM, mỗi lượt agent một row.
//
// Là nguồn sự thật của rate limit theo phòng: bộ đếm Redis chỉ là cache, mất Redis thì hạn mức
// trong ngày dựng lại bằng SUM trên bảng này. Không có nó, Redis rụng là mọi phòng về 0.
//
// Lưu CẢ token thô LẪN thành tiền: token là sự thật bất biến, tiền suy ra từ bảng giá lúc ghi
// (usage/pricing.ts). Đổi giá sau này vẫn tính lại được lịch sử và đối soát với hoá đơn gateway.
// ─────────────────────────────────────────────────────────────────────────────
export const LLM_USAGE_LOG = {
  table: "llm_usage_log",
  col: {
    id: "id",
    conversationId: "conversation_id", // PHÒNG — đơn vị gom hạn mức, không phải người gõ
    agentType: "agent_type",           // tra trần theo agent (usage/budget.ts)
    msgId: "msg_id",                   // envelope thật sự chạy LLM — chống ghi trùng khi retry
    usageDay: "usage_day",             // ngày GIỜ VN, app tính rồi bind (xem DDL)
    inputTokens: "input_tokens",       // cache miss
    outputTokens: "output_tokens",
    cacheReadTokens: "cache_read_tokens",   // cache hit
    cacheWriteTokens: "cache_write_tokens",
    costPicoUsd: "cost_pico_usd",      // pico-USD (1e-12) — bigint, integer tràn ngay
    createdAt: "created_at",
  },
  idx: {
    /** Idempotency: một msgId chỉ vào sổ một lần. */
    msgId: "llm_usage_log_msg_id_key",
    /** Query nóng duy nhất: SUM chi phí phòng trong ngày. */
    roomDay: "llm_usage_log_room_day_idx",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// message_log — RAW LOG mọi tin nhắn qua ingest (tầng 1 của knowledge base). Append-only,
// KHÔNG sửa/xoá từng row: mọi tầng derive (digest cuối ngày, fact chưng cất) dựng lại được
// từ đây. Khác history Redis (LTRIM 40 entry + TTL 7 ngày, chỉ phục vụ cửa sổ agent đọc):
// bảng này giữ bền, retention xử lý sau theo dải `ts`.
// ─────────────────────────────────────────────────────────────────────────────
export const MESSAGE_LOG = {
  table: "message_log",
  col: {
    id: "id",
    channel: "channel",
    msgId: "msg_id",
    conversationId: "conversation_id",
    senderId: "sender_id",
    senderName: "sender_name",         // tên hiển thị lúc gửi — nullable (payload có thể thiếu)
    role: "role",                      // 'user' | 'agent' — ingest chỉ ghi user; cột chờ sẵn cho reply
    isGroup: "is_group",
    addressedToAgent: "addressed_to_agent", // tin có nhắm agent không — audit "agent thấy gì"
    text: "text",
    imageUrl: "image_url",             // con trỏ CDN, nullable — không tải nội dung ảnh
    ts: "ts",                          // event time ms epoch (Envelope.ts) — mốc ngày VN app tự tính
    createdAt: "created_at",
  },
  idx: {
    /** Idempotency: webhook retry không nhân đôi row (dedupe Redis có TTL, đây là chốt bền). */
    msgId: "message_log_msg_id_key",
    /** Đọc lại hội thoại một phòng theo thời gian. */
    roomTs: "message_log_room_ts_idx",
    /** Quét theo dải ngày xuyên phòng (digest cuối ngày). BRIN: bảng append-only theo ts. */
    tsBrin: "message_log_ts_brin",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// kb-digest — tổng kết cuối ngày theo group + đề xuất knowledge base có kiểm duyệt.
// Poller headless đọc message_log, rút vấn đề/giải pháp/đề xuất KB bằng con nhẹ, gửi digest về
// group kiểm duyệt; entry KB chỉ vào bảng memory (scope org) sau khi nhân viên /duyet-kb.
// ─────────────────────────────────────────────────────────────────────────────

/** Trạng thái một lượt digest (ngày, group). Failed là TERMINAL — không tự chạy lại (tránh digest đôi). */
export const KbDigestRunStatus = {
  Running: 0,
  Done: 1,
  Failed: 2,
} as const;
export type KbDigestRunStatus = (typeof KbDigestRunStatus)[keyof typeof KbDigestRunStatus];

/** Trạng thái đề xuất KB. Pending → người duyệt gật/lắc; chỉ Approved mới được ghi vào memory. */
export const KbProposalStatus = {
  Pending: 0,
  Approved: 1,
  Rejected: 2,
} as const;
export type KbProposalStatus = (typeof KbProposalStatus)[keyof typeof KbProposalStatus];

/** Binding group kiểm duyệt + giờ chạy — MỘT row (id cố định), ghi bằng /kiemduyet-kb. */
export const KB_REVIEW_CONFIG = {
  table: "kb_review_config",
  col: {
    id: "id",                          // hằng 'main' — bảng đơn row, bind lại là ghi đè
    channel: "channel",
    conversationId: "conversation_id", // group kiểm duyệt nhận digest
    runTime: "run_time",               // 'HH:MM' giờ VN
    enabled: "enabled",
    createdBy: "created_by",           // user_id nhân viên bind (audit)
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
} as const;

/** Claim mỗi (ngày VN, group): INSERT ON CONFLICT DO NOTHING = giành trước, chạy sau. */
export const KB_DIGEST_RUN = {
  table: "kb_digest_run",
  col: {
    day: "day",                        // ngày GIỜ VN, app tính (cùng lý do usage_day)
    conversationId: "conversation_id",
    status: "status",
    startedAt: "started_at",
    finishedAt: "finished_at",
  },
} as const;

/** Đề xuất KB chờ duyệt. Provenance (channel, conversation_id) CHỈ nằm trong DB — fact ẩn danh. */
export const KB_PROPOSAL = {
  table: "kb_proposal",
  col: {
    id: "id",
    day: "day",
    channel: "channel",
    conversationId: "conversation_id", // group nguồn — truy vết nội bộ, không lộ ra digest/fact
    factText: "fact_text",
    status: "status",
    createdAt: "created_at",
    decidedBy: "decided_by",           // user_id nhân viên quyết
    decidedAt: "decided_at",
  },
  idx: {
    /** Query nóng duy nhất: liệt kê + tra mã ngắn trong đống pending. */
    pending: "kb_proposal_pending_idx",
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
  const gb = GROUP_BLOCK;
  const an = ANNOUNCEMENTS;
  const ad = ANNOUNCEMENT_DELIVERIES;
  const lu = LLM_USAGE_LOG;
  const ml = MESSAGE_LOG;
  const kc = KB_REVIEW_CONFIG;
  const kr = KB_DIGEST_RUN;
  const kp = KB_PROPOSAL;
  const kbRunStatusList = Object.values(KbDigestRunStatus).join(", ");
  const kbProposalStatusList = Object.values(KbProposalStatus).join(", ");
  const statusList = PENDING_STATUS_VALUES.join(", ");
  const deliveryStatusList = DELIVERY_STATUS_VALUES.join(", ");
  const announcementStatusList = ANNOUNCEMENT_STATUS_VALUES.join(", ");
  const roleList = GROUP_ROLE_VALUES.map((r) => `'${r}'`).join(", ");

  return `-- GENERATED từ src/db/schema.ts qua gen-migration.ts — KHÔNG sửa tay.
-- Chạy: psql "$DATABASE_URL" -f migrations/0001_init.sql
-- Chỉ Postgres. Redis (broker, short-term, order-lock, due-index ZSET, leader-lock) không ở đây.
-- Cần pgvector + pg13+ (gen_random_uuid built-in).

BEGIN;

CREATE EXTENSION IF NOT EXISTS ${EXTENSION_VECTOR};

-- memory — DÀI HẠN (§7). Partition (owner_kind, owner_id, channel, conversation_id): filter cả 4.
CREATE TABLE IF NOT EXISTS ${m.table} (
  ${m.col.id}            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  ${m.col.ownerKind}     text          NOT NULL,              -- customer (phòng đại lý) | user (1-1)
  ${m.col.ownerId}       text          NOT NULL,              -- customer_id (group_map) HOẶC senderId
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
  ON ${m.table} (${m.col.ownerKind}, ${m.col.ownerId}, ${m.col.channel}, ${m.col.conversationId});

-- scheduler_jobs — CRON job def durable (§8). next_run_at vừa là due-index vừa là ô CAS claim.
CREATE TABLE IF NOT EXISTS ${s.table} (
  ${s.col.id}           text        PRIMARY KEY,              -- slug ổn định hoặc uuid
  ${s.col.schedule}     text        NOT NULL,                 -- cron 5 trường (giờ VN)
  ${s.col.channel}      text        NOT NULL,                 -- chọn root agent + adapter egress NHƯ message
  ${s.col.identity}     text        NOT NULL,                 -- senderId chạy job — auth resolve y hệt message
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

-- pending_actions — việc đang treo chờ người trả lời (§6). 1 bảng cho MỌI workflow.
CREATE TABLE IF NOT EXISTS ${p.table} (
  ${p.col.approvalId}     text        PRIMARY KEY,
  ${p.col.conversationId} text        NOT NULL,               -- nhóm PHẢI trả lời
  ${p.col.channel}        text        NOT NULL DEFAULT '',    -- kênh của nhóm đó (chọn agent + egress)
  ${p.col.workflow}       text        NOT NULL,               -- workflow nào để resume
  ${p.col.subject}        text,                               -- khoá nghiệp vụ (mã đơn hoàn...)
  ${p.col.stateSnapshot}  jsonb       NOT NULL,               -- resume từ chỗ dừng
  ${p.col.idempotencyKey} text        NOT NULL,               -- chống double-exec khi retry
  ${p.col.status}         smallint    NOT NULL DEFAULT ${PendingStatus.Pending},  -- PendingStatus (numeric)
  ${p.col.approver}       text        NOT NULL,               -- ai ĐƯỢC quyền trả lời/duyệt
  ${p.col.requesterId}    text,
  ${p.col.askCount}       integer     NOT NULL DEFAULT 0,     -- số lần đã hỏi (vào msgId dedupe)
  ${p.col.nextRemindAt}   timestamptz,                        -- mốc nhắc kế + ô CAS claim
  ${p.col.expiresAt}      timestamptz NOT NULL,               -- timeout job quét
  ${p.col.createdAt}      timestamptz NOT NULL DEFAULT now(),
  ${p.col.resolvedAt}     timestamptz,
  CONSTRAINT ${p.idx.statusChk} CHECK (${p.col.status} IN (${statusList})),
  CONSTRAINT ${p.idx.idemUniq}  UNIQUE (${p.col.idempotencyKey})
);

CREATE INDEX IF NOT EXISTS ${p.idx.timeout}
  ON ${p.table} (${p.col.expiresAt})
  WHERE ${p.col.status} = ${PendingStatus.Pending};

-- Gõ lại đúng khoá đang chờ → INSERT rơi vào ON CONFLICT, KHÔNG hỏi người ta lần thứ hai.
CREATE UNIQUE INDEX IF NOT EXISTS ${p.idx.openSubject}
  ON ${p.table} (${p.col.workflow}, ${p.col.subject})
  WHERE ${p.col.status} = ${PendingStatus.Pending} AND ${p.col.subject} IS NOT NULL;

CREATE INDEX IF NOT EXISTS ${p.idx.remind}
  ON ${p.table} (${p.col.nextRemindAt})
  WHERE ${p.col.status} = ${PendingStatus.Pending};

-- announcements — bản gốc MỘT tin phát chung. Text soạn 1 lần, mọi nhóm đọc y hệt nhau.
-- Nằm ở AwaitingApproval cho tới khi người duyệt đích danh gật; trước đó không row nhận nào tới hạn.
CREATE TABLE IF NOT EXISTS ${an.table} (
  ${an.col.id}                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ${an.col.kind}               text        NOT NULL,       -- het_hang | ... (soát/thống kê)
  ${an.col.text}               text        NOT NULL,       -- NGUYÊN VĂN gửi đi
  ${an.col.status}             smallint    NOT NULL DEFAULT ${AnnouncementStatus.AwaitingApproval},
  ${an.col.createdBy}          text        NOT NULL,       -- senderId thủ kho chốt (audit)
  ${an.col.originChannel}      text        NOT NULL,       -- phòng báo ngược kết quả duyệt
  ${an.col.originConversation} text        NOT NULL,
  ${an.col.approvedBy}         text,                       -- user_id người duyệt (audit)
  ${an.col.approvedAt}         timestamptz,
  ${an.col.rejectReason}       text,
  ${an.col.createdAt}          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ${an.idx.statusChk} CHECK (${an.col.status} IN (${announcementStatusList}))
);

CREATE INDEX IF NOT EXISTS ${an.idx.awaiting}
  ON ${an.table} (${an.col.createdAt})
  WHERE ${an.col.status} = ${AnnouncementStatus.AwaitingApproval};

-- announcement_deliveries — 1 row mỗi nhóm nhận. Poller gửi + retry; sống qua restart.
CREATE TABLE IF NOT EXISTS ${ad.table} (
  ${ad.col.id}             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ${ad.col.announcementId} uuid        NOT NULL REFERENCES ${an.table}(${an.col.id}) ON DELETE CASCADE,
  ${ad.col.channel}        text        NOT NULL,
  ${ad.col.groupId}        text        NOT NULL,
  ${ad.col.customerId}     text        NOT NULL,           -- đại lý sở hữu nhóm (soát ai chưa nhận)
  ${ad.col.status}         smallint    NOT NULL DEFAULT ${DeliveryStatus.Pending},
  ${ad.col.attempts}       integer     NOT NULL DEFAULT 0,
  ${ad.col.lastError}      text,                           -- lý do lần hỏng gần nhất
  ${ad.col.nextAttemptAt}  timestamptz,                    -- mốc thử kế + ô CAS claim; NULL = chưa duyệt HOẶC thôi thử
  ${ad.col.sentAt}         timestamptz,
  ${ad.col.createdAt}      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ${ad.idx.statusChk} CHECK (${ad.col.status} IN (${deliveryStatusList}))
);

-- Một nhóm nhận MỘT lần mỗi đợt phát. Chặn ở DB: insert lại (retry lượt tool) không nhân đôi tin.
CREATE UNIQUE INDEX IF NOT EXISTS ${ad.idx.targetUniq}
  ON ${ad.table} (${ad.col.announcementId}, ${ad.col.channel}, ${ad.col.groupId});

CREATE INDEX IF NOT EXISTS ${ad.idx.due}
  ON ${ad.table} (${ad.col.nextAttemptAt})
  WHERE ${ad.col.status} = ${DeliveryStatus.Pending};

CREATE INDEX IF NOT EXISTS ${ad.idx.byAnnouncement}
  ON ${ad.table} (${ad.col.announcementId});

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

-- group_block — nhóm bị /block: worker bỏ qua tin thường (flash command vẫn chạy).
CREATE TABLE IF NOT EXISTS ${gb.table} (
  ${gb.col.channel}     text        NOT NULL,
  ${gb.col.groupId}     text        NOT NULL,
  ${gb.col.blockedBy}   text        NOT NULL,                 -- user_id nhân viên chặn (audit)
  ${gb.col.blockedAt}   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (${gb.col.channel}, ${gb.col.groupId})
);

-- llm_usage_log — sổ cái chi phí LLM, mỗi lượt agent một row. Nguồn sự thật của rate limit theo
-- phòng: bộ đếm Redis là cache, mất nó thì hạn mức trong ngày dựng lại bằng SUM trên bảng này.
CREATE TABLE IF NOT EXISTS ${lu.table} (
  ${lu.col.id}                bigserial   PRIMARY KEY,
  ${lu.col.conversationId}    text        NOT NULL,   -- PHÒNG: đơn vị gom hạn mức
  ${lu.col.agentType}         text        NOT NULL,   -- dealer | warehouse | ... → tra trần
  ${lu.col.msgId}             text        NOT NULL,   -- envelope chạy LLM; chống ghi trùng
  -- NGÀY GIỜ VN, app tính rồi bind. KHÔNG dùng CURRENT_DATE: server chạy UTC thì mốc nửa đêm
  -- lệch 7 tiếng → hạn mức reset lúc 7h sáng, đúng giờ nhóm đại lý bắt đầu làm việc.
  ${lu.col.usageDay}          date        NOT NULL,
  ${lu.col.inputTokens}       integer     NOT NULL,   -- cache miss
  ${lu.col.outputTokens}      integer     NOT NULL,
  ${lu.col.cacheReadTokens}   integer     NOT NULL,   -- cache hit
  ${lu.col.cacheWriteTokens}  integer     NOT NULL,
  -- pico-USD (1e-12 USD) theo bảng giá lúc ghi. bigint: một phòng một ngày ~4e11, integer tràn.
  ${lu.col.costPicoUsd}       bigint      NOT NULL,
  ${lu.col.createdAt}         timestamptz NOT NULL DEFAULT now()
);

-- một msgId chỉ vào sổ một lần dù broker giao lại lượt bao nhiêu lần.
CREATE UNIQUE INDEX IF NOT EXISTS ${lu.idx.msgId}
  ON ${lu.table} (${lu.col.msgId});

-- query nóng duy nhất: SUM chi phí phòng trong ngày (dựng lại bộ đếm Redis).
CREATE INDEX IF NOT EXISTS ${lu.idx.roomDay}
  ON ${lu.table} (${lu.col.conversationId}, ${lu.col.usageDay});

-- message_log — RAW LOG mọi tin qua ingest (tầng 1 knowledge base). Append-only, giữ bền —
-- khác history Redis (LTRIM + TTL). Digest/chưng cất derive từ đây, sai thì chạy lại được.
CREATE TABLE IF NOT EXISTS ${ml.table} (
  ${ml.col.id}                bigserial   PRIMARY KEY,
  ${ml.col.channel}           text        NOT NULL,
  ${ml.col.msgId}             text        NOT NULL,
  ${ml.col.conversationId}    text        NOT NULL,
  ${ml.col.senderId}          text        NOT NULL,
  ${ml.col.senderName}        text,                     -- tên hiển thị lúc gửi, payload có thể thiếu
  ${ml.col.role}              text        NOT NULL DEFAULT 'user', -- ingest chỉ ghi user; chờ sẵn cho reply agent
  ${ml.col.isGroup}           boolean     NOT NULL,
  ${ml.col.addressedToAgent}  boolean     NOT NULL,     -- audit: tin này agent có được gọi không
  ${ml.col.text}              text        NOT NULL,
  ${ml.col.imageUrl}          text,                     -- con trỏ CDN, không tải nội dung
  -- EVENT TIME ms epoch (Envelope.ts). Mốc ngày giờ VN app tự tính khi query (cùng lý do
  -- usage_day ở llm_usage_log: server UTC thì CURRENT_DATE lệch 7 tiếng).
  ${ml.col.ts}                bigint      NOT NULL,
  ${ml.col.createdAt}         timestamptz NOT NULL DEFAULT now()
);

-- Chốt bền chống ghi trùng khi webhook retry (dedupe Redis có TTL, hết hạn là quên).
CREATE UNIQUE INDEX IF NOT EXISTS ${ml.idx.msgId}
  ON ${ml.table} (${ml.col.channel}, ${ml.col.msgId});

-- Đọc lại hội thoại một phòng theo thời gian (kiểm duyệt truy vết, distill lại).
CREATE INDEX IF NOT EXISTS ${ml.idx.roomTs}
  ON ${ml.table} (${ml.col.channel}, ${ml.col.conversationId}, ${ml.col.ts});

-- Quét dải ngày xuyên phòng (digest cuối ngày). BRIN đủ: bảng append-only, ts tăng dần.
CREATE INDEX IF NOT EXISTS ${ml.idx.tsBrin}
  ON ${ml.table} USING brin (${ml.col.ts});

-- kb_review_config — binding group kiểm duyệt + giờ chạy digest. MỘT row (id='main'),
-- ghi bằng /kiemduyet-kb trong chính group kiểm duyệt. Không env var, không hardcode id nhóm.
CREATE TABLE IF NOT EXISTS ${kc.table} (
  ${kc.col.id}              text        PRIMARY KEY,
  ${kc.col.channel}         text        NOT NULL,
  ${kc.col.conversationId}  text        NOT NULL,   -- group nhận digest + nơi gõ lệnh duyệt
  ${kc.col.runTime}         text        NOT NULL,   -- 'HH:MM' giờ VN
  ${kc.col.enabled}         boolean     NOT NULL DEFAULT true,
  ${kc.col.createdBy}       text        NOT NULL,   -- user_id nhân viên bind (audit)
  ${kc.col.createdAt}       timestamptz NOT NULL DEFAULT now(),
  ${kc.col.updatedAt}       timestamptz NOT NULL DEFAULT now()
);

-- kb_digest_run — claim mỗi (ngày VN, group): giành trước bằng INSERT ON CONFLICT DO NOTHING.
-- Crash giữa chừng → group chưa claim chạy tick sau; Failed là TERMINAL (không digest đôi).
CREATE TABLE IF NOT EXISTS ${kr.table} (
  ${kr.col.day}             date        NOT NULL,
  ${kr.col.conversationId}  text        NOT NULL,
  ${kr.col.status}          smallint    NOT NULL CHECK (${kr.col.status} IN (${kbRunStatusList})),
  ${kr.col.startedAt}       timestamptz NOT NULL DEFAULT now(),
  ${kr.col.finishedAt}      timestamptz,
  PRIMARY KEY (${kr.col.day}, ${kr.col.conversationId})
);

-- kb_proposal — đề xuất KB chờ duyệt. Fact ẨN DANH; provenance (channel, conversation_id)
-- chỉ nằm ở đây để truy vết nội bộ. Approved mới được ghi vào memory (scope org).
CREATE TABLE IF NOT EXISTS ${kp.table} (
  ${kp.col.id}              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ${kp.col.day}             date        NOT NULL,
  ${kp.col.channel}         text        NOT NULL,
  ${kp.col.conversationId}  text        NOT NULL,
  ${kp.col.factText}        text        NOT NULL,
  ${kp.col.status}          smallint    NOT NULL DEFAULT 0 CHECK (${kp.col.status} IN (${kbProposalStatusList})),
  ${kp.col.createdAt}       timestamptz NOT NULL DEFAULT now(),
  ${kp.col.decidedBy}       text,
  ${kp.col.decidedAt}       timestamptz
);

-- Query nóng duy nhất: liệt kê + tra mã ngắn trong đống pending.
CREATE INDEX IF NOT EXISTS ${kp.idx.pending}
  ON ${kp.table} (${kp.col.createdAt}) WHERE ${kp.col.status} = 0;

COMMIT;
`;
}
