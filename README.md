# Dilim Agent

AI agent phục vụ khách hàng đa kênh (Zalo / Messenger / Web), **async & event-driven**.
Nhận tin nhắn → xử lý bất đồng bộ trong worker pool (agent loop LLM ⇄ tools) → trả kết
quả ngược về kênh qua broadcast bus.

**Stack:** Bun + TypeScript. LLM đa provider (Anthropic Claude + Google Gemini) sau interface chung, chọn qua config.

---

## Làm gì

- **Chatbot CSKH đa kênh** — một core, thêm kênh chỉ cần thêm adapter.
- **Agent loop** — LLM gọi tools (đọc, tìm, ghi, gọi external) tới khi giải quyết xong.
- **Workflows (SOP)** — quy trình cứng nhiều bước (vd refund, hủy đơn) chạy dạng state machine.
- **Human-in-the-loop** — hành động rủi ro suspend chờ duyệt (khách tự xác nhận hoặc staff approve),
  không block hệ thống.
- **Skills** — tri thức nghiệp vụ dạng folder `SKILL.md`, non-dev sửa được, không cần deploy.

---

## Luồng tổng thể

```
Channels ──raw──▶ message-ingest ──Envelope──▶ Broker (queue)
(Zalo/Web)◀─ACK 202─┘                              │ consume
    ▲                                              ▼
    │                                    Worker Pool (N workers)
    │                                    agent loop: LLM ⇄ tools
    │                                              │ AgentResult
    └──────────── broadcast (pub/sub) ◀────────────┘
```

Xuyên suốt: correlation-id (`msgId`, `conversationId`) • state • audit • idempotency • DLQ.

Chi tiết đầy đủ: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Nguyên tắc thiết kế

1. **ACK ≠ answer** — ingress trả 202 ngay, trả lời đến sau qua broadcast.
2. **Correlation-id xuyên suốt** — map response ↔ request từ ingress tới egress.
3. **Idempotency bắt buộc** — broker retry → dedupe theo `msgId`.
4. **Factory cho ingest & broadcast** — thêm kênh = 1 adapter + 1 dòng register, core không đổi.
5. **Interface ẩn implementation** — Broker/Store/LLM sau interface, thay được không sửa core.
6. **Tenancy do backend inject** — `user_id` không nằm trong tool schema (chống bypass).
7. **Write không tự thực thi** — tạo `pending_action` → confirm mới execute.
8. **Sub-agent context riêng** — chạy song song, trả kết quả gọn về orchestrator.

---

## Bắt đầu

```bash
cd agent
cp .env.example .env      # điền ANTHROPIC_API_KEY, hoặc chạy `ant auth login` và để trống
bun install
bun run src/index.ts      # start   (dev: bun --watch run src/index.ts)
```

Env override: `PROVIDER` (anthropic|gemini), `MODEL`, `EFFORT` (low|medium|high|xhigh|max).
Credentials: `ANTHROPIC_API_KEY` / `ant auth` cho Claude, `GEMINI_API_KEY` cho Gemini. Xem `agent/.env.example`.

---

## Trạng thái

🚧 **Đang scaffold.** Kiến trúc đã chốt (`docs/ARCHITECTURE.md`), code đang dựng.

Còn cần quyết trước khi build đầy đủ:

- **Broker**: Redis Streams / NATS JetStream / Kafka?
- **Broadcast fan-out**: một subscriber hay nhiều?
- **Delivery về user**: WebSocket/SSE hay webhook callback?
- **State store**: Redis / Postgres / cả hai?

---

## Thư mục

```
agent/          # code (Bun project) — xem CLAUDE.md
docs/           # ARCHITECTURE.md
taxlegal/       # repo tham khảo, KHÔNG phải code agent này
```

Quy ước code & rules: [`CLAUDE.md`](CLAUDE.md).
