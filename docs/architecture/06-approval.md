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

## 3 kiểu chờ người

| Kiểu | Hỏi ai | Kết cục | Trạng thái |
|------|--------|---------|-----------|
| **Duyệt chung** (§ trên) | người CÓ QUYỀN | approved / denied | chưa dựng (`approvals/`) |
| **Hỏi dữ kiện** | nhóm BIẾT VIỆC (vd nhóm đại lý) | câu trả lời lưu vào `state_snapshot` | **đã dựng** (`workflows/`) |
| **Duyệt phát tin** | MỘT người đích danh (`ANNOUNCE_APPROVER_USER_ID`) | đợt phát chạy / bị huỷ | **đã dựng** (`announcements/`) |

Hai kiểu đầu dùng chung bảng `pending_actions`; kiểu thứ ba có bảng riêng — xem cuối mục.

Hai kiểu đầu dùng chung bảng `pending_actions` và chung vòng đời suspend → nhắc → hết hạn. Khác
nhau nằm ở **một `WorkflowDef`** (DATA ở `workflows/defs/`): hỏi ai, câu chữ gì, hạn bao lâu, nhắc
mấy tiếng.

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

## Duyệt phát tin toàn hệ đại lý (`announcements/`)

Kho báo hết hàng → agent soạn tin → **mọi nhóm đại lý** cùng nhận một câu. Bán kính lớn nhất trong
hệ thống và không rút lại được, nên đường đi có **ba cửa** và agent chỉ qua được hai cửa đầu:

```
thủ kho nói hết hàng
  1. soan_thong_bao_het_hang → nháp ở Redis (TTL 10') — chưa ghi DB, chưa ai nhận
     agent đọc NGUYÊN VĂN cho thủ kho nghe, thủ kho chốt
  2. gui_thong_bao_het_hang  → GETDEL nháp → INSERT bản gốc (AwaitingApproval)
                                + N row nhận với next_attempt_at = NULL
                                + DM yêu cầu duyệt cho người duyệt      ❗ CHƯA AI NHẬN
        ... chờ người thật ...
  3. /duyet-thongbao <id>    → status=Approved + đặt next_attempt_at cho N row  ← FLASH COMMAND
     /tuchoi-thongbao <id> <lý do> → status=Rejected, không nhóm nào nhận
  4. poller: CAS claim từng row → broadcast + ghi history nhóm → retry backoff, thua sau 4 lần
  5. báo kết quả về nhóm kho
```

**Ba chốt, mỗi chốt bịt một đường vòng:**

| Chốt | Ở đâu | Bịt cái gì |
|---|---|---|
| `role_slug = warehouse` | trong tool | ai cũng xin phát tin được |
| `next_attempt_at = NULL` khi tạo | trong DB | model "tự gửi" — không có mốc thì không tick nào nhặt |
| Duyệt là **flash command**, không phải tool | `flash-command/` | LLM tự duyệt / bị prompt injection lái |

Người duyệt nhận diện bằng `user_id` hệ vận hành (`ANNOUNCE_APPROVER_USER_ID`), **không** bằng
senderId (đổi thiết bị là mất) và **không** bằng `role_slug` (quy tắc chỉ đích danh một người).
Thiếu env này = không ai phát được — fail-closed, không phải mở cửa.

Vì sao **không** dùng `workflows/`: `dispatchAsk` đẩy Envelope nên mỗi nhóm chạy một lượt LLM và tự
soạn lại câu → N nhóm đọc N câu khác nhau; `findAnswered` chặn mở lại cùng khoá nên sản phẩm hết
lần hai sẽ không gửi được; unique `(workflow, subject)` buộc ghép sản phẩm + đại lý + mốc thời gian
vào một chuỗi khoá.

## 3 điểm dễ sai (async)

1. **Approval reply ≠ message thường** — phân biệt ở ingest qua `meta.approvalId` / command (`/approve <id>`), không thì worker tưởng câu hỏi mới.
2. **Idempotency key trên pending** — resume có thể chạy 2 lần (retry) → execute phải idempotent.
3. **Timeout bắt buộc** — pending treo mãi = kẹt → job quét `expiresAt` → auto-deny/escalate.

---

[← Mục lục kiến trúc](../ARCHITECTURE.md)
