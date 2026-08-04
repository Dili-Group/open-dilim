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
│   ├── broker/                  # hàng đợi + pub/sub (Redis Streams / NATS / Kafka)
│   │   ├── index.ts             #   interface Broker (publish/consume/ack)
│   │   ├── queue.ts             #   ingress queue (durable, retry, DLQ)
│   │   └── pubsub.ts            #   broadcast bus (fan-out topic)
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
│   │   └── timeout.ts           #   job quét pending hết hạn → auto-deny/escalate
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
│   ├── state/                   # STATE — session, history, pending
│   │   ├── store.ts             #   interface Store (get/set theo conversationId)
│   │   ├── session.ts           #   session + lịch sử hội thoại
│   │   ├── memory.ts            #   memory dài hạn (cross-session)
│   │   └── pending.ts           #   pending_action (write chờ confirm, idempotency key)
│   │
│   ├── auth/                    # AUTH — xác thực & tenancy
│   │   ├── index.ts             #   verify request (chữ ký webhook / token)
│   │   ├── tenancy.ts           #   inject user_id/tenant từ session (KHÔNG để LLM tự set)
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
| **types** | Type chung: `Envelope` (có `agentType` + `identity`), `AgentResult`, `Tool`, `ChannelAdapter`. | Core chỉ làm việc với Envelope, không biết channel gì. |
| **message-ingest** | INPUT. Gateway nhận raw → `factory.create(channel).ingestor.parse()` → Envelope → ACK 202 → push queue. Đọc `agentType` client gửi, validate thuộc whitelist enum. | ACK ≠ answer. Không đụng LLM ở đây. `agentType` chỉ là routing hint, chưa cấp quyền. |
| **broker** | Đệm & vận chuyển. `queue` = ingress (durable, retry, DLQ). `pubsub` = broadcast (fan-out). | Chọn Redis Streams / NATS / Kafka. Interface ẩn implementation. |
| **worker** | PROCESSING. Consume queue → dedupe (idempotency) → `registry.resolve(agentType)` → chạy root agent → emit AgentResult. | Scale ngang = thêm worker. Chạy được vài phút/msg. |
| **agents** | `registry` map `agentType` → root agent (operation/partner/...). Root agent chạy loop `while(tool_use)`; orchestrator quyết định gọi sub-agent/workflow. | Thêm agent = 1 file `roots/` + 1 dòng register. Type sai/thiếu → default agent. Sub-agent trả kết quả gọn, song song. |
| **llm** | Tách lời gọi model khỏi loop. `LLMProvider` interface + registry chọn provider theo config; mỗi provider (Claude, Gemini) 1 file. | Agent loop KHÔNG biết provider nào — chỉ gọi `provider.chat/stream`. Thêm provider = 1 file + 1 dòng register. Mỗi provider tự chuẩn hóa tool-call về format chung. |
| **tools** | Hàm agent gọi. Registry + JSON schema + runner. Phân loại READ (auto) / WRITE (confirm) / ESCALATE. | `user_id` KHÔNG nằm trong schema — backend inject từ session. |
| **workflows** | SOP nhiều bước = state machine. intake → check → propose → **confirm gate** → execute. | Dùng cho quy trình cứng (refund/hủy...), khác agent loop hỏi-đáp. |
| **approvals** | Human-in-the-loop. Gate suspend workflow → lưu pending → phát yêu cầu duyệt → resume khi có reply. | Async: KHÔNG block. 2 tầng: customer-confirm & staff-approve. |
| **skills** | Mỗi skill 1 folder: `SKILL.md` (frontmatter+body) + `references/**`. Selector chọn theo intent, loader inject. | Progressive disclosure: chỉ `description` ở context mặc định; body/references load khi cần. Non-dev sửa, không deploy. |
| **broadcast** | OUTPUT. `publisher` push AgentResult lên topic. `factory` chọn broadcaster theo channel subscriber. `subscribers` cho fan-out. | Broadcast theo channel của SUBSCRIBER, không phải request gốc. |
| **state** | Session/history/memory/pending theo `conversationId`. | `pending_action` giữ write chờ confirm + idempotency key. |
| **auth** | Verify webhook/token. Tenancy inject `identity` (user_id/tenant) từ session. Check `identity` được phép `agentType` (map allowed-types). Permission gate tool nguy hiểm. | Tenancy KHÔNG để LLM/client tự quyết → chống bypass. `agentType` client gửi phải qua check này trước khi route. |
| **observability** | Audit log bắt buộc: conversations, tool_calls, pending_actions, handoffs. | + logger + metrics. |

---

## 4. Agent routing theo type

Mỗi message mang `agentType` (client gửi kèm) → định tuyến tới **root agent** tương ứng.
`operation` → ops agent, `partner` → partner agent, v.v. Thêm nghiệp vụ = thêm 1 root agent,
core không đổi (giống factory cho channel).

```
Envelope {
  msgId, conversationId,
  agentType,     // ◀ client gửi — ROUTING HINT (không phải quyền)
  identity,      // ◀ backend inject từ session — nguồn sự thật cho QUYỀN
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
  (map allowed-types theo tenant). Có lọt qua → tool nhạy cảm vẫn gate theo identity partner.

Hai tầng tách rời (route ≠ quyền) → client gửi type an toàn.

### 3 rào bắt buộc

1. **Whitelist enum** — `agentType ∈ {operation, partner, ...}`. Ngoài list → default agent / reject, không route mù theo chuỗi client tự đặt.
2. **Map identity → allowed types** — tenant/tài khoản nào dùng type nào. Chặn ngay tầng `auth`, trước khi tới agent.
3. **Agent đích tự enforce quyền** — không tin "type đã đúng nên bỏ check". Mọi tool WRITE/nhạy cảm gate theo identity.

### Quan hệ với orchestrator

- **`agentType` route (ingest/worker)** = chọn ROOT agent — thô, theo domain/tenant.
- **orchestrator (trong 1 root agent)** = chọn sub-agent/workflow — mịn, theo task.

Hai tầng khác nhau, không chồng. State (`conversationId`) nên lưu `agentType` hiện tại →
tin nhắn sau cùng hội thoại route đúng root agent, không cần suy lại.

> Chưa hỗ trợ handoff cross-agent (root A tự đẩy sang B). Ngoài phạm vi hiện tại — mỗi
> hội thoại gắn 1 `agentType`.

---

## 5. Human-in-the-loop (approval)

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

## 6. Nguyên tắc thiết kế (chốt)

1. **ACK ≠ answer.** Ingress trả 202 ngay, câu trả lời đến sau qua broadcast.
2. **Correlation-id xuyên suốt.** `msgId` + `conversationId` đi từ ingress → egress để map response ↔ request.
3. **Idempotency bắt buộc.** Broker retry → msg tới 2 lần → dedupe theo `msgId`.
4. **Factory cho ingest & broadcast.** Thêm channel = thêm 1 adapter + 1 dòng register, core 0 đổi.
5. **Interface ẩn implementation.** Broker/Store/LLM đều sau interface → thay được không sửa core.
6. **Tenancy do backend inject.** `user_id` không nằm trong tool schema.
7. **Write không tự thực thi.** Tạo `pending_action` → confirm mới execute.
8. **Sub-agent context riêng.** Chạy song song, trả kết quả gọn về orchestrator.
9. **LLM đa provider sau interface.** Agent loop gọi `LLMProvider` chung, không bind Anthropic/Gemini. Đổi provider = đổi config; thêm provider = 1 file trong `llm/providers/` + 1 dòng register.
10. **`agentType` route, không cấp quyền.** Client gửi `agentType` chỉ chọn root agent; quyền luôn theo `identity` backend inject. Whitelist enum + map identity→allowed-type + agent tự gate tool.

---

## 7. Chưa quyết (cần chốt để scaffold code)

- **Broker**: Redis Streams / NATS JetStream / Kafka?
- **Broadcast fan-out**: 1 subscriber (chính user) hay nhiều?
- **Delivery về user**: WebSocket/SSE hay webhook callback tới channel?
- **State store**: Redis / Postgres / cả hai?
