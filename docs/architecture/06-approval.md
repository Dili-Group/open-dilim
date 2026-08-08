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

## 2 kiểu chờ người, MỘT cơ chế

| Kiểu | Hỏi ai | Kết cục | Trạng thái |
|------|--------|---------|-----------|
| **Duyệt** (§ trên) | người CÓ QUYỀN | approved / denied | chưa dựng |
| **Hỏi dữ kiện** | nhóm BIẾT VIỆC (vd nhóm đại lý) | câu trả lời lưu vào `state_snapshot` | **đã dựng** (`workflows/`) |

Cả hai dùng chung bảng `pending_actions` và chung vòng đời suspend → nhắc → hết hạn. Khác nhau nằm
ở **một `WorkflowDef`** (DATA ở `workflows/defs/`): hỏi ai, câu chữ gì, hạn bao lâu, nhắc mấy tiếng.

### Kiểu "hỏi dữ kiện" chạy thế nào

```
Nhóm A (vd nhóm kho) ──▶ tool `mo_viec_cho`
  1. def.resolveTarget(khoa) → ra nhóm B phải trả lời (tra hệ vận hành + group_map)
  2. INSERT pending_actions (unique khi treo: 1 việc / (workflow, subject))
  3. dựng Envelope → history nhóm B → broker  → agent nhóm B TỰ SOẠN câu hỏi ✅

        ... chờ: giờ → NGÀY. Poller nhắc lại theo nhịp def, trong giờ hành chính ...

Người ở B trả lời ──▶ tool `tra_loi_viec`
  4. khớp (khoa + ĐÚNG nhóm B) — nhóm khác không đóng được việc này
  5. def.normalizeAnswer kiểm đáp án; sai → việc VẪN treo
  6. đóng pending (WHERE status = Pending → chống báo kết quả 2 lần)
  7. broadcast TEMPLATE về nhóm A (không qua LLM: lúc này A không có lượt nào đang chạy)
```

Việc đang treo được bơm lại vào **system prompt mỗi lượt của nhóm B**
(`context/pending-block.ts`) — nếu chỉ trông vào history thì sau 1-2 ngày câu hỏi đã trôi mất, và
câu trả lời đến muộn sẽ không khớp được việc nào.

Hết hạn → đóng im lặng, KHÔNG nhắn ai: quá hạn thì việc đã sang tay người thật.

## Trạng thái hiện tại (chưa có gate duyệt)

Bảng `pending_actions` đã dùng cho kiểu "hỏi dữ kiện"; module `approvals/` (gate duyệt) thì CHƯA.
Hệ quả cho tầng nghiệp vụ: mọi tool đọc dữ liệu vận hành vẫn **CHỈ ĐỌC**, không có đường ghi nào
cho agent.

Việc GHI mà khách hay yêu cầu (huỷ đơn, sửa đơn) hiện xử lý bằng cách: agent tra trạng thái thật,
nói rõ còn làm được hay không, rồi **chuyển nhân viên vận hành** — xem skill `don-hang`
(`references/huy-don.md`). Dựng xong gate thì chỗ đó mới thành tầng A (khách tự xác nhận).

## 3 điểm dễ sai (async)

1. **Approval reply ≠ message thường** — phân biệt ở ingest qua `meta.approvalId` / command (`/approve <id>`), không thì worker tưởng câu hỏi mới.
2. **Idempotency key trên pending** — resume có thể chạy 2 lần (retry) → execute phải idempotent.
3. **Timeout bắt buộc** — pending treo mãi = kẹt → job quét `expiresAt` → auto-deny/escalate.

---

[← Mục lục kiến trúc](../ARCHITECTURE.md)
