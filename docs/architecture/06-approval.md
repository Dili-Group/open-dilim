# 6. Human-in-the-loop (approval)

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

## 2 tầng human loop

| Tầng | Khi nào | Người duyệt | Ví dụ |
|------|---------|-------------|-------|
| **A. Customer self-confirm** | Write-action rủi ro thấp | Chính khách | "Xác nhận hủy đơn #123?" → reply "có" |
| **B. Staff approve** | Giá trị lớn / rủi ro / vượt ngưỡng | Nhân viên CSKH | Refund > 5tr → queue duyệt, staff bấm approve |

Cả 2 dùng chung cơ chế suspend/resume — khác ở: ai duyệt, auth check, kênh nhận yêu cầu.

## Ghép module

`approvals/gate.ts` (suspend) → `state/pending.ts` (lưu) → `broadcast/` (phát yêu cầu) →
`message-ingest/` (nhận reply) → `auth/permissions.ts` (verify quyền) → `approvals/resolver.ts` (resume).

## 3 điểm dễ sai (async)

1. **Approval reply ≠ message thường** — phân biệt ở ingest qua `meta.approvalId` / command (`/approve <id>`), không thì worker tưởng câu hỏi mới.
2. **Idempotency key trên pending** — resume có thể chạy 2 lần (retry) → execute phải idempotent.
3. **Timeout bắt buộc** — pending treo mãi = kẹt → job quét `expiresAt` → auto-deny/escalate.

---

[← Mục lục kiến trúc](../ARCHITECTURE.md)
