# 13b. API agent gọi khi ghi đăng ký xác nhận — `POST /agent/expert-verifications`

- **Ngày:** 2026-09-21, viết lại 2026-10-02 theo endpoint THẬT của dilim-system.
- **Bên gọi:** `src/operational/xac-nhan-api.ts` (`AgentApiOrderConfirmPort`).
- **Bên nhận:** `dilim-system/server/src/modules/partners/expert-verification/`
  (`expert-verification-agent.controller.ts`, `dto/create-expert-verification.dto.ts`).
- **Nghiệp vụ:** [13-xac-nhan-don-bac-si.md](./13-xac-nhan-don-bac-si.md). Agent CHỈ GHI đăng ký (§0c).

Bản cũ của file này là hợp đồng agent tự đề xuất (`/agent/xac-nhan/dang-ky`, có khung giờ, số thứ
tự…). Backend làm khác — tài liệu này mô tả đúng cái backend làm, agent gọi theo đó.

## Thứ tự gọi trong `ghi_dang_ky`

```
kiểm tra tại chỗ (đủ trường, lý do, case chưa hiệu quả)
  → GET  /agent/dealers/lookup?code=<mã cạnh STT>     404 → KHÔNG ghi, báo sale sửa mã
  → GET  /agent/expert-verifications/purchase-check   CHỈ khi mục 3 "đang dùng / đã dùng"
                                                      không có đơn → KHÔNG ghi, hỏi lại sale
  → POST /agent/expert-verifications                  dealer_id = id vừa tra được
```

## Auth

Chỉ `x-service-token`. Không `x-dealer-id` (đây là đường TRA RA đại lý), không `x-staff-id` (sale
phần lớn chưa bind định danh; backend để tuỳ chọn). Token cần CASL scope:

| Endpoint | Scope |
|---|---|
| `GET /agent/dealers/lookup` | `Dealer:read:all` |
| `GET /agent/expert-verifications/purchase-check` | `read` trên `Order` |
| `POST /agent/expert-verifications` | `create` trên `ExpertVerification` |

Thiếu scope → 403 → tool báo "chưa ghi được / chưa đối chiếu được mã", KHÔNG ghi ca nào.

## 1. `GET /agent/dealers/lookup?code=` — đối chiếu mã đại lý

Khớp ĐÚNG mã, không phân biệt hoa thường, chỉ đại lý đang hoạt động. Agent gửi nguyên chữ sale gõ
(không gập dấu: `VĐĐ` ≠ `VDD`).

```json
{ "success": true, "data": { "id": "42", "uuid": "…", "code": "NVH", "name": "…", "phone": null, "zalo_group_id": null } }
```

404 (`ERR_DEALER_NOT_FOUND`) → không có mã → agent không ghi.

## 2. `GET /agent/expert-verifications/purchase-check?dealer_id=&phone=` — khách đã mua chưa

Thêm 02/10/2026 (dilim-system, cùng controller). Gọi khi sale ghi mục 3 "Đang dùng / Đã dùng" thay
vì "Đã tư vấn": bắt tin gửi nhầm khách / nhầm đại lý trước khi tạo yêu cầu.

Đếm đơn `dealer_id = $1` có 5 số cuối SĐT (sau khi bỏ ký tự không phải số) khớp, bỏ đơn nháp
(`-1`), đơn đã huỷ (`14`), đơn xoá mềm. **Không giới hạn ngày** — khác `GET /agent/orders` (30
ngày, và chỉ khớp SĐT khi ≥ 9 chữ số nên không dùng được với 5 số cuối).

```json
{ "success": true, "data": { "purchased": true, "order_count": 2, "last_order_at": "…", "last_tracking_number": "…" } }
```

`purchased: false` → agent KHÔNG ghi, hỏi lại sale. Sale khẳng định vẫn đã mua → agent ghi, note
đánh dấu "hệ thống CHƯA thấy đơn — sale khẳng định đã mua".

## 3. `POST /agent/expert-verifications` — ghi yêu cầu

Backend bật `whitelist + forbidNonWhitelisted`: body **đúng 5 khoá**, dư một khoá là 400.

```json
{
  "customer_phone": "94501",
  "customer_name": "Chị Hồng",
  "note": "STT: 5 · Đại lý: VDD · Sale: Linh\nTình trạng: …\nĐã tư vấn: Natto\nLý do xác nhận: …\nKhung giờ: 16h–17h ngày 2026-09-29",
  "zalo_thread_id": "<id nhóm Zalo>",
  "dealer_id": "42"
}
```

| Khoá | Nguồn | Ràng buộc backend |
|---|---|---|
| `customer_phone` | chữ số sale gõ (thường 5 số cuối, có khi đủ số) | 5–20 ký tự — **đã nới từ 9 xuống 5** (02/10/2026) vì sale chỉ gõ 5 số |
| `customer_name` | mục 1 | ≤ 255 |
| `note` | gộp mọi trường không có cột riêng (`composeNote`) | ≤ 2000, agent cắt trước |
| `zalo_thread_id` | `ctx.room.groupId`, server-side | ≤ 64 |
| `dealer_id` | id từ bước tra mã | chuỗi số |

**Trả** (HTTP 200): `{ "success": true, "data": { …ExpertVerificationRow, "created": true } }` —
`uuid`, `status` (0 chờ duyệt · 1 đã xác nhận · 2 từ chối), `dealer_code`, `customer_phone`…
**Không có số thứ tự** → agent không báo số thứ tự.

**Trùng:** đã có yêu cầu PENDING cùng (5 số cuối + `dealer_id`) → trả yêu cầu cũ, `created: false`,
nội dung mới **không** được ghi. Agent báo "ca đã đăng ký, đang chờ duyệt; sửa thì nhờ leader".

## Thứ backend chưa có (agent bỏ qua, gộp vào `note`)

Khung giờ / ngày xin xác nhận, đăng ký muộn, STT, đã chốt hay mới tư vấn, lý do, 5 mục "đã dùng
chưa hiệu quả", tên sale. Muốn lọc/đếm theo mấy trường này trên admin thì backend phải thêm cột —
lúc đó đổi `composeNote` thành khoá riêng, cùng lúc với DTO (vì `forbidNonWhitelisted`).
