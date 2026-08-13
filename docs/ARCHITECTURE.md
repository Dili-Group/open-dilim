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

## Mục lục

Chi tiết tách theo mục, mỗi mục 1 file trong [`architecture/`](./architecture/):

| Mục | File | Trả lời câu hỏi gì |
|-----|------|--------------------|
| 2 | [Cấu trúc thư mục](./architecture/02-cau-truc-thu-muc.md) | Code nằm ở đâu, thêm channel/tool/skill thì tạo file nào |
| 3 | [Trách nhiệm từng module](./architecture/03-trach-nhiem-module.md) | Folder nào lo việc gì, ghi chú/cạm bẫy của từng module |
| 4 | [Agent routing](./architecture/04-agent-routing.md) | channel → root agent → sub-agent; vì sao route ≠ quyền; root agent là DATA |
| 5 | [Message life cycle](./architecture/05-message-lifecycle.md) | 10 bước từ webhook tới lúc trả lời; direct khác group chỗ nào |
| 5b | [Định danh & vai](./architecture/05b-dinh-danh-va-vai.md) | `senderId` → nhân viên/đại lý/guest; `/ketnoi-dilim`; `customer_id` từ đâu ra |
| 6 | [Human-in-the-loop (approval)](./architecture/06-approval.md) | Suspend/resume khi cần duyệt, 2 tầng duyệt, 3 điểm dễ sai |
| 7 | [Memory](./architecture/07-memory.md) | Ngắn hạn vs dài hạn, distill→embed→recall, chunking, chống ảo giác |
| 8 | [Scheduler (cron)](./architecture/08-scheduler.md) | Job định kỳ tái dùng pipeline thế nào, fire-once, không bypass quyền |
| 9 | [Nguyên tắc thiết kế](./architecture/09-nguyen-tac-thiet-ke.md) | 14 chốt bất biến của hệ thống |
| 10 | [Tool ngoài qua MCP](./architecture/10-mcp.md) | Nối server MCP, allowlist tool, vì sao không dùng connector của provider |

Sơ đồ: [`arch.png`](./arch.png) · [`dilim-architecture.excalidraw`](./dilim-architecture.excalidraw)
