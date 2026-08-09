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
│   │   ├── router.ts            #   channel → agentType (bảng hằng; lạ → undefined → default)
│   │   ├── registry.ts          #   AgentRegistry: map agentType → root agent (+ default)
│   │   ├── prompts.ts           #   persona + nhiệm vụ từng agent (giọng nằm ở đây, không ở skill)
│   │   ├── runtime/             #   BỘ MÁY chạy lượt — thêm agent KHÔNG đụng vào đây
│   │   │   ├── build-agent.ts   #     buildRootAgent: profile (DATA) → RootAgent (chạy được)
│   │   │   ├── sub-router.ts    #     trong 1 root: chọn sub-agent theo task (1 lượt LLM rẻ)
│   │   │   └── loop.ts          #     vòng lặp chính: LLM ⇄ tools tới khi xong
│   │   └── roots/               #   1 file / root agent — chỉ DATA (RootAgentProfile).
│   │                            #   Root có sub → chuyển thành folder <tên>/ + subs/
│   │       ├── operations.ts    #     agentType=operations — nhân viên vận hành
│   │       ├── dealer.ts        #     agentType=dealer — kế toán đại lý
│   │       ├── personal.ts      #     agentType=personal — trợ lý riêng 1-1 (directOnly)
│   │       ├── boss.ts          #     agentType=boss — ban lãnh đạo
│   │       └── default.ts       #     dự phòng khi channel chưa map
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
│   ├── workflows/               # VIỆC TREO chờ nhóm khác trả lời (§6) — suspend/resume
│   │   ├── engine.ts            #   mở việc → đẩy lượt hỏi; nhận trả lời → đóng + báo về nơi hỏi
│   │   ├── poller.ts            #   tick: đóng việc quá hạn → nhắc việc tới hạn (CAS claim)
│   │   ├── store.ts             #   pending_actions Postgres; 1 bảng cho MỌI workflow
│   │   ├── schedule.ts          #   mốc nhắc/hạn đóng, kéo vào giờ hành chính VN
│   │   ├── service.ts           #   WorkflowPort — 1 cổng duy nhất cho tool
│   │   ├── registry.ts          #   slug → WorkflowDef
│   │   └── defs/                #   1 file / nghiệp vụ (DATA: hỏi ai, câu chữ, hạn)
│   │       └── hoi-don-goc.ts   #   vd: đơn hoàn *DH → hỏi đại lý mã đơn gốc
│   │
│   ├── announcements/           # PHÁT MỘT TIN tới MỌI nhóm đại lý (kho báo hết hàng)
│   │   ├── service.ts           #   AnnouncePort (agent XIN phát) + AnnounceApprovalPort (người duyệt)
│   │   ├── store.ts             #   announcements + announcement_deliveries: 1 row mỗi nhóm nhận
│   │   ├── poller.ts            #   tick: gửi lượt đã DUYỆT (CAS claim) + retry backoff, KHÔNG qua LLM
│   │   ├── drafts.ts            #   nháp ở Redis (GETDEL) — chốt được đúng một lần
│   │   └── rooms.ts             #   group_map enabled − group_block, dedupe theo customer_id
│   │
│   ├── scheduler/               # CRON — trigger agent theo lịch (periodic check)
│   │   ├── poller.ts            #   tick: quét job đến hạn → CAS claim → bắn; cô lập lỗi theo job
│   │   ├── repo.ts              #   job def Postgres; claim = CAS trên next_run_at (fire-once)
│   │   ├── schedule.ts          #   cron 5 trường → mốc kế tiếp, giờ VN cố định (+07:00)
│   │   ├── fire.ts              #   dựng Envelope source=cron → ghi history phòng → push broker
│   │   └── types.ts             #   port: JobRepo / publisher / history / dedupe
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
│   │       └── refund/
│   │           ├── SKILL.md     #     frontmatter (name, description, version) + body
│   │           └── references/  #     chi tiết, load khi cần (progressive disclosure)
│   │               ├── policy.md
│   │               └── examples.md
│   │   # LƯU Ý: giọng trả lời (tone) KHÔNG phải skill — nó là persona, nằm ở agents/prompts.ts
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
│   │   ├── session.ts           #   NGẮN HẠN: Redis buffer N turn (LTRIM + TTL)
│   │   ├── compactor.ts         #   nén phần trôi khỏi cửa sổ → rolling summary (theo PHÒNG)
│   │   ├── memory.ts            #   DÀI HẠN: distill → embed (gemini) → pgvector, recall top-K theo user
│   │   ├── specs.ts             #   DistillSpec dựng sẵn — "agent này nhớ GÌ"
│   │   ├── memory-writer.ts     #   đường GHI theo lô + MemoryWriterRegistry (1 writer / 1 spec)
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
