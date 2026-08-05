# 2. Cấu trúc thư mục

```

├── docs/
│   ├── ARCHITECTURE.md          # mục lục kiến trúc
│   └── architecture/            # 1 file / mục (file này = mục 2)
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
│   ├── context/                 # CONTEXT — sở hữu "model thấy gì trong 1 lượt"
│   │   ├── assembler.ts         #   ghép: prompt nền + catalog skill + khối memory → system; history → messages
│   │   ├── memory-block.ts      #   4 chốt §7: top-K, ngưỡng liên quan, token cap, provenance
│   │   └── types.ts             #   ContextSources (app-scoped) / TurnInput (mỗi lượt) / TurnContext
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

[← Mục lục kiến trúc](../ARCHITECTURE.md)
