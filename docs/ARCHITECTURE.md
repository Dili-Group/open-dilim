# Dilim Agent — Kiến trúc

Async, event-driven AI agent. Input qua **message-ingest** (gateway), xử lý **bất đồng bộ** trong
worker pool, output qua **broadcast** (pub/sub fan-out). Request tới được ACK ngay, **không trả lời
tức thì** — kết quả đến sau qua broadcast bus.

Stack: **Bun + TypeScript**. LLM đa provider (**Anthropic Claude + Google Gemini**) sau một interface chung, chọn qua config.

---

## 1. Luồng tổng thể

```
                        INGRESS (đồng bộ, nhanh, KHÔNG block LLM)
┌──────────┐   raw    ┌──────────────────┐  Envelope   ┌──────────────┐
│ Channels │─────────▶│ message-ingest   │────────────▶│    Broker    │
│ Zalo/Web │◀─ ACK ───│ (gateway+factory)│  push+ACK   │ (ingress q)  │
│ MSG/...  │  202 ngay└──────────────────┘             └──────┬───────┘
└──────────┘                                                  │ consume
     ▲                                                        │
     │                    PROCESSING (bất đồng bộ, chạy lâu)  ▼
     │              ┌──────────────────────────────────────────────────┐
     │              │              Worker Pool (N workers)              │
     │              │  bootstrap → auth → load state → agent loop       │
     │              │  agent loop: LLM ⇄ tools ⇄ (sub-agents/workflows) │
     │              └───────────────────────┬──────────────────────────┘
     │                                       │ AgentResult
     │                  EGRESS (broadcast, fan-out)
     │              ┌────────────────────────▼─────────────┐
     └──────────────│           broadcast (pub/sub)         │
       delivery     │  topic theo conversationId / channel  │
       qua factory  └───────────────────────────────────────┘

  Scheduler (cron) ──tick(leader-lock)──▶ Broker (ingress q)   [Envelope source=cron; KHÔNG qua gateway/ACK]

Xuyên suốt: correlation-id (msgId, conversationId) • state • audit • idempotency • DLQ
```

---

## 2. Cấu trúc thư mục

```

├── docs/
│   └── ARCHITECTURE.md          # file này
├── src/
│   ├── index.ts                 # entrypoint: gọi bootstrap, khởi động gateway + workers
│   │
│   ├── bootstrap/               # khởi tạo & wiring toàn hệ thống
│   │   ├── index.ts             #   composition root: dựng DI, register mọi thứ
│   │   ├── container.ts         #   registry/DI đơn giản (map service)
│   │   └── env.ts               #   nạp & validate env (fail-fast nếu thiếu)
│   │
│   ├── config/                  # cấu hình tĩnh
│   │   ├── index.ts             #   MODEL, EFFORT, maxTokens, workerCount...
│   │   └── prompts.ts           #   SYSTEM_PROMPT, prompt templates
│   │
│   ├── types/                   # type dùng chung (Envelope, AgentResult, ...)
│   │   └── index.ts
│   │
│   ├── message-ingest/          # INPUT — nhận & normalize
│   │   ├── gateway.ts           #   HTTP/webhook server, nhận raw, ACK 202
│   │   ├── factory.ts           #   ChannelFactory: chọn adapter theo channel
│   │   ├── ingestor.ts          #   interface Ingestor (parse + ack)
│   │   └── adapters/            #   1 file / channel
│   │       ├── zalo.ts
│   │       ├── messenger.ts
│   │       └── web.ts
│   │
│   ├── broker/                  # hàng đợi + pub/sub — Redis Streams
│   │   ├── index.ts             #   interface Broker (publish/consume/ack)
│   │   ├── queue.ts             #   ingress: Redis Stream + consumer group (ack, retry, DLQ qua PEL)
│   │   └── pubsub.ts            #   broadcast bus: Redis pub/sub, topic theo conversationId
│   │
│   ├── worker/                  # PROCESSING — consumer chạy agent
│   │   ├── pool.ts              #   spawn N worker, quản lý lifecycle
│   │   ├── handler.ts           #   xử lý 1 Envelope: dedupe → run agent → emit
│   │   └── idempotency.ts       #   dedupe theo msgId (chống xử lý trùng)
│   │
│   ├── agents/                  # AGENT LOOP + ROOT AGENTS + SUB-AGENTS
│   │   ├── registry.ts          #   AgentRegistry: map agentType → root agent (+ default)
│   │   ├── loop.ts              #   vòng lặp chính: LLM ⇄ tools tới khi xong
│   │   ├── roots/               #   1 file / root agent (chọn theo agentType)
│   │   │   ├── operation.ts     #     agentType=operation
│   │   │   └── partner.ts       #     agentType=partner
│   │   ├── orchestrator.ts      #   trong 1 root agent: quyết định gọi sub-agent/workflow
│   │   └── sub/                 #   sub-agent (context riêng, chạy song song)
│   │       ├── researcher.ts    #     ví dụ: agent tra cứu
│   │       └── coder.ts         #     ví dụ: agent viết code
│   │
│   ├── llm/                     # tầng gọi model — ĐA PROVIDER, sau interface chung
│   │   ├── provider.ts          #   interface LLMProvider { chat, stream } + type chung
│   │   ├── registry.ts          #   chọn provider theo config (name → instance)
│   │   ├── stream.ts            #   helper stream + get_final_message (provider-agnostic)
│   │   ├── embedder.ts          #   interface Embedder; impl gemini-embedding-001 (dim 1536)
│   │   └── providers/           #   1 file / provider
│   │       ├── anthropic.ts     #     Claude (@anthropic-ai/sdk), resolve creds zero-arg
│   │       └── gemini.ts        #     Gemini (@google/genai)
│   │
│   ├── tools/                   # TOOLS — hàm agent gọi được
│   │   ├── index.ts             #   ToolRegistry: đăng ký + JSON schema
│   │   ├── runner.ts            #   nhận tool_use → chạy → trả tool_result
│   │   ├── types.ts             #   interface Tool { name, schema, run }
│   │   └── impl/                #   1 file / tool
│   │       ├── read.ts          #   READ  (auto)
│   │       ├── search.ts        #   READ  (auto)
│   │       ├── write.ts         #   WRITE (cần confirm / pending)
│   │       └── http.ts          #   ESCALATE / external call
│   │
│   ├── workflows/               # SOP nhiều bước (state machine)
│   │   ├── index.ts             #   WorkflowRegistry
│   │   ├── engine.ts            #   chạy state machine: state → transition
│   │   └── defs/                #   1 file / workflow
│   │       └── example.ts       #   vd: intake → check → propose → confirm → execute
│   │
│   ├── approvals/               # HUMAN-IN-THE-LOOP — suspend/resume khi cần duyệt
│   │   ├── gate.ts              #   approval gate đặt trong workflow (điểm suspend)
│   │   ├── resolver.ts          #   nhận approval reply → match pending → resume
│   │   ├── policy.ts            #   rule: khi nào cần duyệt, ai duyệt, ngưỡng giá trị
│   │   └── timeout.ts           #   quét pending hết hạn → auto-deny/escalate (chạy như 1 scheduler job)
│   │
│   ├── scheduler/               # CRON — trigger agent theo lịch (periodic check)
│   │   ├── poller.ts            #   tick leader-locked: quét job đến hạn → dựng Envelope → push broker
│   │   ├── store.ts             #   job def: Postgres (durable) + Redis ZSET (due-index theo nextRunAt)
│   │   ├── registry.ts          #   map jobId → task builder (system job code-defined)
│   │   └── defs/                #   job code-defined (approval-timeout, health-check); business job ở DB
│   │       └── approval-timeout.ts
│   │
│   ├── skills/                  # SKILLS — mỗi skill 1 folder (chuẩn SKILL.md)
│   │   ├── loader.ts            #   đọc SKILL.md (parse frontmatter), versioned
│   │   ├── selector.ts          #   chọn skill inject theo intent/context
│   │   └── defs/                #   1 folder / skill (non-dev sửa, không deploy)
│   │       ├── refund/
│   │       │   ├── SKILL.md     #     frontmatter (name, description, version) + body
│   │       │   └── references/  #     chi tiết, load khi cần (progressive disclosure)
│   │       │       ├── policy.md
│   │       │       └── examples.md
│   │       └── tone/
│   │           ├── SKILL.md
│   │           └── references/
│   │
│   ├── broadcast/               # OUTPUT — đẩy kết quả ra
│   │   ├── publisher.ts         #   nhận AgentResult → publish lên pubsub topic
│   │   ├── factory.ts           #   ChannelFactory (broadcaster) — chọn adapter
│   │   ├── broadcaster.ts       #   interface Broadcaster (send)
│   │   ├── subscribers.ts       #   registry subscriber (fan-out nhiều nơi)
│   │   └── adapters/            #   1 file / channel (gửi ngược về channel)
│   │       ├── zalo.ts
│   │       ├── messenger.ts
│   │       └── web.ts
│   │
│   ├── state/                   # STATE — session, memory, pending
│   │   ├── store.ts             #   interface Store (get/set theo conversationId)
│   │   ├── session.ts           #   NGẮN HẠN: Redis buffer N turn + rolling summary (TTL)
│   │   ├── memory.ts            #   DÀI HẠN: distill → embed (gemini) → pgvector, recall top-K theo user
│   │   └── pending.ts           #   pending_action (write chờ confirm, idempotency + requesterId)
│   │
│   ├── auth/                    # AUTH — xác thực & tenancy
│   │   ├── index.ts             #   verify request (chữ ký webhook / token)
│   │   ├── identity.ts          #   resolve senderId→vai, inject identity struct (KHÔNG để LLM tự set)
│   │   └── permissions.ts       #   gate tool WRITE/DESTRUCTIVE
│   │
│   └── observability/           # AUDIT + LOG + METRIC
│       ├── audit.ts             #   log: message, tool_call, result, handoff
│       ├── logger.ts
│       └── metrics.ts
│
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 3. Trách nhiệm từng module

| Folder | Vai trò | Ghi chú quan trọng |
|--------|---------|--------------------|
| **bootstrap** | Composition root. Nạp env, dựng DI, register adapter/tool/skill, khởi động gateway + worker pool. | Nơi DUY NHẤT wiring. Đổi broker/adapter chỉ sửa ở đây. |
| **config** | Hằng số: provider, model, effort, maxTokens, số worker, prompt gốc. | `PROVIDER` (anthropic\|gemini) + `MODEL` chọn model của provider đó. `effort=high`, stream + maxTokens 64000. |
| **types** | Type chung: `Envelope` (có `agentType` + `identity`), `AgentResult`, `Tool`, `ChannelAdapter`. `identity` = struct `{channel, senderId, role, userId?, customerId?}`, KHÔNG string. | Core chỉ làm việc với Envelope, không biết channel gì. `userId` (nhân viên) / `customerId` (đại lý) = handle act-as, optional theo vai. |
| **message-ingest** | INPUT. Gateway nhận raw → `factory.create(channel).ingestor.parse()` → Envelope → ACK 202 → push queue. Đọc `agentType` (validate enum) + `isGroup`; group thì set `addressedToAgent` = có mention @agent. | ACK ≠ answer. Không đụng LLM ở đây. `agentType`/`isGroup` là routing hint, chưa cấp quyền. Group không mention → chỉ ghi history, không chạy agent. |
| **broker** | Đệm & vận chuyển — **Redis Streams**. `queue` = ingress (consumer group: ack, retry, DLQ qua PEL). `pubsub` = broadcast fan-out. | Interface ẩn implementation → đổi sang Kafka/NATS sau không sửa core. Dùng chung Redis với short-term memory + order-lock. |
| **worker** | PROCESSING. Consume queue → dedupe (idempotency) → order-lock theo `conversationId` → `registry.resolve(agentType)` → chạy root agent → emit AgentResult. | Scale ngang = thêm worker. 1 message/lúc/phòng (chống đua state group). Chạy được vài phút/msg. |
| **agents** | `registry` map `agentType` → root agent (operation/partner/...). Root agent chạy loop `while(tool_use)`; orchestrator quyết định gọi sub-agent/workflow. | Thêm agent = 1 file `roots/` + 1 dòng register. Type sai/thiếu → default agent. Sub-agent trả kết quả gọn, song song. |
| **llm** | Tách lời gọi model khỏi loop. `LLMProvider` interface + registry chọn provider theo config; mỗi provider (Claude, Gemini) 1 file. `Embedder` interface (gemini-embedding-001) cho memory dài hạn. | Agent loop KHÔNG biết provider nào — chỉ gọi `provider.chat/stream`. Thêm provider = 1 file + 1 dòng register. `Embedder` swap Gemini↔self-host không sửa memory core. |
| **tools** | Hàm agent gọi. Registry + JSON schema + runner. Phân loại READ (auto) / WRITE (confirm) / ESCALATE. Agent = deputy gọi hệ vận hành THAY user. | **Danh tính KHÔNG vào schema.** Tool chỉ nhận tham số nghiệp vụ (mã đơn, ngày...). Act-as handle (`user_id` nhân viên / `customer_id` đại lý) bind từ `identity` server-side (closure lúc dựng tool cho request), KHÔNG từ tham số LLM sinh → chống confused-deputy (xem mục 4). |
| **workflows** | SOP nhiều bước = state machine. intake → check → propose → **confirm gate** → execute. | Dùng cho quy trình cứng (refund/hủy...), khác agent loop hỏi-đáp. |
| **approvals** | Human-in-the-loop. Gate suspend workflow → lưu pending → phát yêu cầu duyệt → resume khi có reply. | Async: KHÔNG block. 2 tầng: customer-confirm & staff-approve. |
| **scheduler** | CRON. Poller leader-locked quét job đến hạn (Redis ZSET) → dựng Envelope `source=cron` → push broker ingress → tái dùng pipeline. Job def ở Postgres + `defs/` code. | Không path xử lý mới. Fire-once (lock + idempotent `msgId`). KHÔNG bypass quyền. Gộp approval-timeout sweep. |
| **skills** | Mỗi skill 1 folder: `SKILL.md` (frontmatter+body) + `references/**`. Selector chọn theo intent, loader inject. | Progressive disclosure: chỉ `description` ở context mặc định; body/references load khi cần. Non-dev sửa, không deploy. |
| **broadcast** | OUTPUT. `publisher` push AgentResult lên topic. `factory` chọn broadcaster theo channel subscriber. `subscribers` cho fan-out. | Broadcast theo channel của SUBSCRIBER. Direct → DM user; group → topic phòng (mọi member), @ lại người hỏi. |
| **state** | NGẮN HẠN: Redis buffer N turn + rolling summary theo `conversationId` (turn gắn `senderId`). DÀI HẠN: memory distill→embed(gemini)→pgvector, recall top-K theo `user_id`. Pending theo phòng. | Xem mục 7 Memory. Long-term filter `user_id` (tenancy). `pending_action` giữ write chờ confirm + idempotency + `requesterId`. |
| **auth** | Verify webhook/token. Resolve `senderId` → vai (nhân viên/đại lý/guest) → dựng `identity` struct (`userId` từ `user_binding`, `customerId` derive `group_map`). Check `identity` được phép `agentType`. Permission gate tool nguy hiểm. | `identity` KHÔNG để LLM/client tự quyết → chống bypass. Resolve vai (mục 5) LUÔN chạy trước agent. `agentType` client gửi qua check này trước khi route. |
| **observability** | Audit log bắt buộc: conversations, tool_calls, pending_actions, handoffs. | + logger + metrics. |

---

## 4. Agent routing theo type

Mỗi message mang `agentType` (client gửi kèm) → định tuyến tới **root agent** tương ứng.
`operation` → ops agent, `partner` → partner agent, v.v. Thêm nghiệp vụ = thêm 1 root agent,
core không đổi (giống factory cho channel).

```
Envelope {
  msgId, conversationId,           // phòng (direct | group)
  isGroup,                         // ◀ cờ group — client/channel gửi kèm
  senderId,                        // ◀ người gửi message NÀY
  agentType,                       // ◀ client gửi — ROUTING HINT (không phải quyền)
  identity,                        // ◀ backend inject từ senderId — nguồn sự thật cho QUYỀN
  addressedToAgent,                // ◀ group: có mention @agent không (ingest set)
  channel, payload, meta
}

ingest:  nhận agentType từ client → validate ∈ whitelist enum  (sai → default/reject)
auth:    verify identity ĐƯỢC phép agentType này               (không → reject)
worker:  agent = registry.resolve(agentType) ?? defaultAgent → agent.run(envelope)
agent:   vẫn gate TỪNG tool theo identity (defense-in-depth)
```

### Luật cốt lõi: `type` ≠ authorization

`agentType` client gửi **chỉ chọn luồng chạy**, KHÔNG tự cấp quyền. Dù client khai
`type=operation`, quyền vẫn quyết bởi `identity` backend inject.

- Client khai type sai → cùng lắm route nhầm luồng, **không leo thang quyền**.
- Partner account gửi `type=operation` → `auth` chặn ở bước "identity được phép type?"
  (map allowed-types theo vai/tài khoản). Có lọt qua → tool nhạy cảm vẫn gate theo identity partner.

Hai tầng tách rời (route ≠ quyền) → client gửi type an toàn.

### 3 rào bắt buộc

1. **Whitelist enum** — `agentType ∈ {operation, partner, ...}`. Ngoài list → default agent / reject, không route mù theo chuỗi client tự đặt.
2. **Map identity → allowed types** — vai/tài khoản nào dùng type nào. Chặn ngay tầng `auth`, trước khi tới agent.
3. **Agent đích tự enforce quyền** — không tin "type đã đúng nên bỏ check". Mọi tool WRITE/nhạy cảm gate theo identity.

### Quan hệ với orchestrator

- **`agentType` route (ingest/worker)** = chọn ROOT agent — thô, theo domain/vai.
- **orchestrator (trong 1 root agent)** = chọn sub-agent/workflow — mịn, theo task.

Hai tầng khác nhau, không chồng. State (`conversationId`) nên lưu `agentType` hiện tại →
tin nhắn sau cùng hội thoại route đúng root agent, không cần suy lại.

> Chưa hỗ trợ handoff cross-agent (root A tự đẩy sang B). Ngoài phạm vi hiện tại — mỗi
> hội thoại gắn 1 `agentType`.

---

## 5. Message life cycle (direct & group)

Hai loại session: **direct** (1 user ↔ agent) và **group** (nhiều người ↔ agent trong 1 phòng).
Một life cycle chung; group cắm thêm trigger-gate + ordering-per-phòng + attribution + broadcast-to-room.

Hai trục:
- **`conversationId`** = phòng. State/history gắn theo đây (group = shared history nhiều speaker).
- **`senderId`** = người gửi từng message. Direct luôn 1 người; group đổi theo message.
  **Quyền luôn theo `senderId`, KHÔNG theo phòng** — group không có "quyền group".

`isGroup` do client/channel gửi kèm (giống `agentType`): chỉ đổi **hành vi** (trigger, broadcast),
KHÔNG cấp quyền. Group trigger = **mention @agent** (chỉ mention, không dùng reply/command).

```
1. INGEST      normalize → conversationId, isGroup, senderId
               isGroup=true  → set addressedToAgent = có mention @agent trong payload?
               isGroup=false → addressedToAgent = true (direct luôn nhắm agent)
2. TRIGGER     addressedToAgent=false → CHỈ ghi vào history (passive context), KHÔNG chạy agent → DONE
               addressedToAgent=true  → tiếp
3. ACK 202     push queue
4. DEDUPE      idempotency theo msgId
5. ORDER-LOCK  serialize theo conversationId (1 message/lúc/phòng — chống đua state)
6. AUTH        identity từ senderId → verify quyền + agentType được phép
7. STATE       load history phòng; mỗi turn gắn {senderId, text} (group đa speaker)
8. AGENT       registry.resolve(agentType).run() — context biết AI đang hỏi
9. BROADCAST   direct → DM về user
               group  → publish topic phòng (fan-out mọi member), @ lại người hỏi
10. AUDIT      log msgId + senderId + tool_calls + result
```

### Định danh: `senderId` → vai (bước 6 AUTH)

`senderId` (webhook đã ký → tin được) resolve thành **1 trong 3 vai**. Vai quyết quyền +
data scope, KHÔNG do client khai.

| Vai | Là ai | Resolve từ | Data scope |
|-----|-------|-----------|-----------|
| **nhân viên** | Sales Admin / quản lý / giám đốc Dili | `user_binding(channel, senderId)` active → `user_id` hệ vận hành | Theo quyền `user_id` (có thể nhiều đại lý) |
| **đại lý** | Kế toán đại lý | `group_member(channel, groupId, senderId)` role=`dai_ly` active | Đúng đại lý của group (derive từ `group_map`) |
| **guest** | Còn lại | Không match 2 cái trên (default đóng) | Không data nội bộ; hỏi chung |

**Thứ tự resolve (dừng ở match đầu):**
```
1. user_binding(channel, senderId) active?        → nhân viên  (định danh TOÀN CỤC, không theo group)
2. group_member(channel, groupId, senderId)=dai_ly? → đại lý   (theo group)
3. else                                            → guest      (mặc định)
```

`customer_id` (đại lý nào) **derive runtime** từ `group_map(channel, groupId)` — KHÔNG lưu trong
`group_member`. Vận hành sở hữu quan hệ group→đại lý (single source of truth); cache lại sẽ stale
khi re-map. Group không có trong `group_map` → lookup miss → fail sạch, không gán treo.

**Lệnh `/ketnoi-dilim @mention` — gán vai đại lý:**
```
nhân viên gõ /ketnoi-dilim @A  (trong group G)
  1. verify sender = nhân viên (user_binding active)        — guest/đại lý gõ → reject
  2. lấy uid A từ MENTION ENTITY của payload (uid, offset)   — KHÔNG regex tên (trùng/đổi → sai người)
  3. validate A chưa phải nhân viên                          — tránh phong nhầm nhân viên thành đại lý
  4. upsert group_member(channel, G, A, role=dai_ly, assigned_by=user_id nhân viên)
```
- `customer_id` KHÔNG nhập tay: suy từ `group_map(G)` lúc runtime.
- Gỡ vai (kế toán nghỉ): `/huy-ketnoi @A` → set `group_member.revoked_at`.
- `assigned_by` lưu vết ai phong ai (audit).

> **Lỗ dễ sai:** đừng coi "mọi người trong group = đại lý". Group trộn nhân viên Dili + kế toán
> đại lý + người lạ. Không resolve vai trước → guest/nhân viên thấy nhầm data nội bộ đại lý, hoặc
> đại lý A thấy data đại lý B. Resolve `senderId` → vai LUÔN chạy trước khi agent trả lời.

### Delta của group (so với direct)

| Bước | Direct | Group |
|------|--------|-------|
| 1–2 Trigger | Luôn nhắm agent | Chỉ chạy khi **mention @agent**; câu khác → nuốt vào history làm ngữ cảnh (chống spam + tốn LLM) |
| 5 Ordering | Ít đua (1 người) | **Bắt buộc** serialize theo `conversationId` — nhiều người gõ cùng lúc, không khóa thì đè state/history |
| 7 History | 1 speaker | Đa speaker, mỗi entry gắn `senderId`; prompt render "An: … / Bình: …" để agent trả đúng người |
| 9 Broadcast | DM 1 user | Publish topic phòng → mọi member thấy; @ lại người hỏi |

### Ăn khớp approval (mục 6)

Group + human-loop: `pending_action` gắn **`requesterId`**. Lúc resume, `resolver` check người
reply đúng là requester (hoặc staff có quyền) — không thì bất kỳ ai trong group cũng "xác nhận
hủy đơn" hộ người khác. Lỗ hổng dễ sai nhất ở group.

---

## 6. Human-in-the-loop (approval)

Async → human loop **KHÔNG block-chờ**, mà **suspend → resume**. Workflow tới approval gate thì lưu
state + phát yêu cầu duyệt + worker thoát. Người duyệt trả lời → tin nhắn đi ngược qua chính
ingest → broker → worker → resume workflow từ chỗ dừng.

```
Workflow chạy ──▶ APPROVAL GATE
  1. tạo pending_action {approvalId, workflow, stateSnapshot, idempotencyKey, expiresAt, approver}
  2. lưu state store
  3. broadcast "yêu cầu duyệt" (tới user HOẶC staff)
  4. worker THOÁT — không block ✅

        ... chờ: giây → giờ → ngày ...

Approval reply (Envelope type=approval) tới qua INGEST
  5. match pending theo approvalId
  6. auth: verify người này ĐƯỢC quyền duyệt
  7a. APPROVED → resume từ stateSnapshot → execute (idempotencyKey chống double-exec)
  7b. DENIED   → nhánh rejected → broadcast báo user
  7c. EXPIRED  → timeout job quét → auto-deny / escalate lên staff
```

### 2 tầng human loop

| Tầng | Khi nào | Người duyệt | Ví dụ |
|------|---------|-------------|-------|
| **A. Customer self-confirm** | Write-action rủi ro thấp | Chính khách | "Xác nhận hủy đơn #123?" → reply "có" |
| **B. Staff approve** | Giá trị lớn / rủi ro / vượt ngưỡng | Nhân viên CSKH | Refund > 5tr → queue duyệt, staff bấm approve |

Cả 2 dùng chung cơ chế suspend/resume — khác ở: ai duyệt, auth check, kênh nhận yêu cầu.

### Ghép module

`approvals/gate.ts` (suspend) → `state/pending.ts` (lưu) → `broadcast/` (phát yêu cầu) →
`message-ingest/` (nhận reply) → `auth/permissions.ts` (verify quyền) → `approvals/resolver.ts` (resume).

### 3 điểm dễ sai (async)

1. **Approval reply ≠ message thường** — phân biệt ở ingest qua `meta.approvalId` / command (`/approve <id>`), không thì worker tưởng câu hỏi mới.
2. **Idempotency key trên pending** — resume có thể chạy 2 lần (retry) → execute phải idempotent.
3. **Timeout bắt buộc** — pending treo mãi = kẹt → job quét `expiresAt` → auto-deny/escalate.

---

## 7. Memory (ngắn hạn & dài hạn)

Hai tầng, khác bản chất — không nhét chung.

| | Ngắn hạn (working) | Dài hạn (persistent) |
|---|---|---|
| Phạm vi | 1 `conversationId` (phòng) | cross-session, theo `(customer_id, end_user_id)` |
| Nội dung | N turn gần nhất **verbatim** + rolling summary | **fact đã chưng cất** (không phải log thô) |
| Store | **Redis** (ephemeral, bounded, TTL/evict) | **Postgres + pgvector** |
| Module | `state/session.ts` | `state/memory.ts` |
| Recall | đọc thẳng theo `conversationId` | semantic search top-K theo embedding |

### Ngắn hạn

Buffer hội thoại trên **Redis** (key theo `conversationId`, TTL): giữ N turn gần nhất verbatim;
tràn context → tóm tắt cuộn (rolling summary), đẩy phần cũ ra. Group: mỗi turn gắn `senderId`
(đa speaker). KHÔNG cần vector/embedding.

### Dài hạn — pattern claude-mem (distill → index → recall → prime)

**Write path** (sau turn/hội thoại): distiller rút fact bền → record, embed bằng
**`gemini-embedding-001`** → lưu pgvector. KHÔNG lưu log thô.

> **Model của distiller.** Distiller (và rolling summary ngắn hạn) là việc nhẹ — rút gọn/phân
> loại — nhưng chạy ngầm sau *mỗi* turn, tần suất cao. Nên KHÔNG dùng con mạnh của agent loop mà
> dùng **con nhẹ riêng**: `CONFIG.memoryModel` (env `MEMORY_MODEL`, mặc định = `MODEL`), cùng
> provider với agent qua `LLMProvider`. `Embedder` thì luôn `gemini-embedding-001`, độc lập lựa
> chọn này. Chạy async, ngoài critical path → không bắt khách chờ.

**Read path** (bước STATE của life cycle): embed câu hỏi → semantic search top-K memory
**của CHÍNH user này** → inject bản gọn vào context (progressive disclosure; chi tiết fetch khi cần).

**Prime**: bootstrap hội thoại nạp profile khách compact (giống SessionStart hook claude-mem).

```sql
-- record: { id, user_id, type, text, embedding vector(1536), source_msg_id, confidence, ts }
-- gemini-embedding-001: output dim = 1536 (Matryoshka) → ≤2000, HNSW index thẳng, không halfvec
CREATE INDEX ON memory USING hnsw (embedding vector_cosine_ops);

SELECT text, ts FROM memory
WHERE user_id = $1                 -- TENANCY: cứng, không lọt cross-user
ORDER BY embedding <=> $2          -- cosine, top-K liên quan
LIMIT 8;
```

`Embedder` interface (giống `LLMProvider`) → swap Gemini ↔ self-host không sửa memory core.

### Chunking & chống ảo giác

Đây là memory hội thoại, KHÔNG phải RAG tài liệu → **không chunk cơ học** (cắt N token + overlap).
Cắt theo size gây ảo giác: to → vector nhiễu; nhỏ → mảnh cụt mất chủ ngữ, agent tự lấp.

**Đơn vị = 1 atomic fact self-contained** (semantic, không theo size):
- Distill 1 record = 1 ý trọn, tự đủ nghĩa (~1–3 câu, 1 chủ đề, không đại từ mồ côi).
- Message dài nhiều ý → tách nhiều fact, mỗi cái độc lập. KHÔNG overlap (fact rời rạc).
- Lưu hội thoại thô (để trace) → cắt theo ranh giới **turn** (1 turn/chunk, kèm `senderId`), không cắt giữa turn.

**4 chốt chống ảo giác** (quan trọng hơn chunk size):
1. **Similarity threshold — bỏ rác.** Recall chỉ lấy chunk > ngưỡng cosine (~0.7, tune). Dưới ngưỡng → vứt, KHÔNG nhồi context. Thà thiếu còn hơn context sai.
2. **Provenance.** Mỗi record kèm `source_msg_id + ts`; render prompt "(ghi ngày X)" → LLM hạ tin cậy fact cũ, cite được, không bịa.
3. **DB-first.** Fact động query DB lúc chạy, không recall từ memory (đã là nguyên tắc).
4. **Rỗng → hỏi lại.** Recall trống / dưới ngưỡng → agent nói không chắc, cấm suy diễn lấp chỗ.

**Read-time budget:**
```
context = short-term buffer (turn gần, verbatim)        ← ưu tiên 1
        + long-term recall (top-K=5–8, > threshold)     ← ưu tiên 2, có token cap
```
Cap token block memory. Ngắn hạn thắng dài hạn khi tràn. Không nhồi hết top-K bất kể liên quan.

### 3 rào bắt buộc

1. **Partition khách.** Mọi read/write memory filter `(customer_id, end_user_id)`. Memory khách A không lọt sang B (cả cross-đại-lý lẫn cross-người trong group). `WHERE customer_id AND end_user_id` là bắt buộc, không phải logic app tự nhớ.
2. **DB-first — memory ≠ fact động.** KHÔNG lưu trạng thái động (tình trạng đơn, số dư, tồn kho) vào memory — thiu. Cái đó query DB lúc chạy. Memory chỉ giữ: sở thích, ngữ cảnh bền, tóm tắt episode.
3. **Memory informs, không authorizes.** Recalled memory có thể cũ/sai. Agent làm WRITE thật (refund/hủy) không được dựa memory → re-verify từ DB + qua approval.

---

## 8. Scheduler (cron — kiểm tra định kỳ)

Nguồn trigger theo **thời gian**, không phải người dùng. Cron **tái dùng nguyên pipeline**: tự sinh
Envelope (`source=cron`) → đẩy thẳng **broker ingress** → worker/agent/broadcast y hệt message thường.
KHÔNG path xử lý mới. Không qua gateway/ACK (không có caller ngoài — scheduler là producer nội bộ tin
cậy, dựng Envelope trực tiếp).

Dùng cho: quét đơn treo, nhắc hạn, health-check, báo cáo định kỳ — và **gộp cả approval-timeout sweep**
(mục 6): timeout job = 1 cron job, không còn quét ad-hoc rải rác.

```
job def (Postgres, durable) ──▶ Redis ZSET (due-index theo nextRunAt)
                                      ▲
        poller tick (leader-lock) ────┘
          ZRANGEBYSCORE now → mỗi job đến hạn:
            1. dựng Envelope (dưới) → push broker ingress
            2. tính nextRunAt → ZADD lại (reschedule)
```

Envelope cron:
```
Envelope {
  msgId:  `cron:{jobId}:{scheduledTs}`,   // ◀ idempotent — chống double-fire
  conversationId: job.target,             // đích broadcast (staff channel / phòng)
  senderId: 'system:cron',
  agentType: job.agentType,               // validate whitelist NHƯ message thường
  identity:  job.identity,                // service/user cấu hình — auth gate NHƯ thường
  source:   'cron',                       // ◀ phân biệt nguồn (vs message / approval)
  addressedToAgent: true,
  payload:  { task: job.task }            // "kiểm tra gì" — prompt hệ thống sinh
}
```

Job def: `{ id, schedule (cron/interval), agentType, identity, task, target, enabled, nextRunAt, lastRunAt }`.
System job (approval-timeout, health-check) code-defined trong `defs/`; business check data-defined trong
DB (non-dev thêm, giống skills).

### 4 chốt

1. **Fire-once.** Nhiều instance/worker → 2 poller không được cùng bắn 1 job. Leader-lock (Redis) HOẶC
   pop atomic (`ZPOPMIN`/Lua) + idempotent `msgId` dedupe ở worker. Trùng tick → dedupe nuốt.
2. **Cron KHÔNG bypass quyền.** `agentType` validate whitelist, `identity` qua `auth` y hệt message. Job
   chạy dưới identity service/user cấu hình — không phải "quyền root". Tool WRITE vẫn gate theo identity.
3. **Execute idempotent.** Job làm WRITE (gửi cảnh báo, tạo ticket) → idempotent theo `msgId`; retry/tick
   trùng không nhân đôi. Write thật rủi ro vẫn qua `pending_action` (mục 6).
4. **Output có đích rõ.** Không ai "hỏi" → không reply-về-người-hỏi. Job def chỉ định `target` broadcast
   (staff channel / conversationId). Agent/recall như thường, chỉ khác điểm đến.

**Miss-fire:** instance down qua giờ chạy → khi lên, poller thấy `nextRunAt < now` → chạy **bù 1 lần**
(không replay mọi lần lỡ). Job nhạy thời điểm set cờ skip-to-next thay vì catch-up.

---

## 9. Nguyên tắc thiết kế (chốt)

1. **ACK ≠ answer.** Ingress trả 202 ngay, câu trả lời đến sau qua broadcast.
2. **Correlation-id xuyên suốt.** `msgId` + `conversationId` đi từ ingress → egress để map response ↔ request.
3. **Idempotency bắt buộc.** Broker retry → msg tới 2 lần → dedupe theo `msgId`.
4. **Factory cho ingest & broadcast.** Thêm channel = thêm 1 adapter + 1 dòng register, core 0 đổi.
5. **Interface ẩn implementation.** Broker/Store/LLM đều sau interface → thay được không sửa core.
6. **Danh tính do backend inject — act-as bind từ `identity`, không từ LLM.** Agent gọi hệ vận hành thay user → act-as handle (`user_id` nhân viên / `customer_id` đại lý) lấy từ `identity` resolve server-side (bước 6 AUTH), KHÔNG nằm trong tool schema, KHÔNG từ tham số LLM sinh. Message người dùng = untrusted → tool nhận danh tính qua closure sẽ bị prompt-injection chiếm quyền (confused-deputy): đại lý A rút data đại lý B. Tool chỉ nhận tham số nghiệp vụ.
7. **Write không tự thực thi.** Tạo `pending_action` → confirm mới execute.
8. **Sub-agent context riêng.** Chạy song song, trả kết quả gọn về orchestrator.
9. **LLM đa provider sau interface.** Agent loop gọi `LLMProvider` chung, không bind Anthropic/Gemini. Đổi provider = đổi config; thêm provider = 1 file trong `llm/providers/` + 1 dòng register.
10. **`agentType` route, không cấp quyền.** Client gửi `agentType` chỉ chọn root agent; quyền luôn theo `identity` backend inject. Whitelist enum + map identity→allowed-type + agent tự gate tool.
11. **Quyền theo `senderId`, không theo phòng.** `conversationId`=phòng, `senderId`=người gửi từng message. Group không có "quyền group" — mỗi câu quyền theo người gửi câu đó.
12. **Group chỉ chạy khi mention.** `isGroup` + mention @agent mới trigger loop; câu khác nuốt vào history làm ngữ cảnh. Nhiều message/phòng → serialize theo `conversationId`.
13. **Memory 2 tầng, informs≠authorizes.** Ngắn hạn = session buffer/phòng; dài hạn = pgvector theo `user_id`. Memory chỉ giữ fact bền (không lưu fact động → DB-first), gợi ý chứ không cấp quyền — WRITE thật phải re-verify DB + approval.
14. **Cron = ingress theo thời gian.** Scheduler tự sinh Envelope `source=cron` → tái dùng nguyên pipeline (không path mới). Fire-once (leader-lock + idempotent `msgId`); không bypass quyền (`agentType` whitelist + `identity` auth); output có `target` rõ. Approval-timeout sweep = 1 cron job.
