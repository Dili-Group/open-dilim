# DiLiM CRM — khách hàng & chăm sóc khách

Chỉ áp cho **DiLiM CRM**, KHÔNG phải app đại lý. Đại lý = **Leader**: thấy khách mình + sale trực tiếp
(ô **Của tôi** / **Toàn bộ team**). Sale chỉ thấy khách mình.

## Tra nhanh

| Muốn làm | Ở đâu | Lưu ý |
|---|---|---|
| Tìm / lọc khách | **Khách hàng** (/customers) | Tìm tên/SĐT, **Bộ lọc**, **Tải về**. Không thấy → người khác phụ trách |
| Thêm khách | **Thêm khách hàng** | Bắt buộc **Tên thật** + **Số điện thoại**. Ô **Dán nhanh**: dán tin khách → tự điền ô trống, kiểm lại. SĐT trùng không chặn |
| Nhập nhiều khách | **Nhập Excel** → **Tải file mẫu (.xlsx)** → **Chọn file import** | SĐT đã có → bỏ qua (**Trùng**) |
| Ghi nhanh cuộc gọi | **Gọi thêm** (tab **Chăm sóc** của khách / dòng ở **Chăm sóc khách**) | **Đã gọi**, **Đã nói chuyện** tự hoàn tất lịch đến hạn |
| Đổi xưng hô | Chi tiết → "..." → **Sửa hồ sơ** → **Xưng hô** | **Tự động** cần Giới tính + Ngày sinh; không chắc → **Anh/Chị** |
| Mẫu tin nhắn | **Mẫu tin nhắn chăm sóc** (/templates) | **Sao chép** rồi tự gửi |

Nhãn **Chỉ xem — không có quyền can thiệp** ở trang khách = không phải người phụ trách / Leader trực tiếp.

## Hai bảng Chăm sóc khách (/customer-boards)

- **Khách chưa mua**: cột **24h đầu** "x/7" — mục tiêu 7 cuộc gọi trong 24 giờ đầu, chữ đỏ là chậm.
- **Khách đã mua**, giai đoạn theo ngày nhận hàng: **Chờ nhận hàng** → **Hướng dẫn sử dụng** (0–2) →
  **Hỏi thăm ngày 3** (3–6) → **Follow-up ngày 7** (7–29) → **Chăm sóc dài hạn** (từ 30). **Đơn bị hoàn**.
- Sắp theo **Ưu tiên**, gọi từ trên xuống. **Điểm ưu tiên** 0–100 tự tính: **Cao** ≥70, **Trung bình** ≥40, **Thấp** <40; hạ khi **Gọi thêm** / **Ghi chăm sóc**.

## Chăm sóc hôm nay & ghi chăm sóc

**Dashboard** → **Chăm sóc hôm nay** (tab **Cần chăm sóc** / **Đã hoàn thành**; thiếu khách → **Cập nhật
danh sách**). Không có nút "Hoàn thành": mở khách → **Ghi chăm sóc** → **Lưu** là xong.

Hộp ghi chăm sóc: **Kênh liên hệ** (Zalo/Facebook/Gọi điện/Khác), **Kết quả**, **Hẹn chăm sóc lại** (trống → tự nhắc sau 7 ngày). Kênh **Gọi điện**/**Zalo** tự
hoàn tất mọi lịch đến hạn; Facebook/Khác thì không. **Giá trị đơn hàng** chỉ ghi nhật ký, KHÔNG tạo đơn.

## Lịch chăm sóc tự tạo (số mặc định)

- Khách **Chưa mua**: mỗi ngày 7 ngày đầu, rồi mỗi 7 ngày; mua rồi thì bỏ qua.
- Lên đơn → theo dõi giao hàng mỗi ngày tới khi giao/huỷ/hoàn (tối đa 10 ngày).
- Đơn đã giao → Nhận hàng Ngày 1, Ngày 3, rồi hỏi thăm mỗi 7 ngày.
- Sinh nhật (cần ngày sinh), ngày lễ → nhắc trước 7 ngày.

Quá hạn >7 ngày tự **bỏ qua**.

## Tin Zalo tự động (ZNS) & khách từ chối

Xem: chi tiết → tab **Chăm sóc** → **Tin Zalo tự động**. ZNS không thay **Ghi chăm sóc**. Khách không muốn nhận
→ gạt tắt **Nhận tin Zalo tự động** ở thẻ đó (dừng ZNS + tin Zalo theo đơn).

## Sửa / xoá / chuyển khách

- **Sửa**: trong **48 giờ** đầu sale sửa thẳng; sau đó nút thành **Gửi yêu cầu duyệt**, chờ Leader.
- **Xoá**: sale không tự xoá; quá 48 giờ gửi yêu cầu xoá, dưới 48 giờ nhờ Leader. Leader xoá được khách
  mình + sale trực tiếp (**Xoá N khách**); chỉ admin **Phục hồi**.
- **Leader duyệt**: **Duyệt yêu cầu** (/approvals) → tab **Sửa hồ sơ** → **Duyệt**/**Từ chối**.
- **Chuyển một phần**: /customers tick khách (≤500) → **Chuyển N khách** → chọn **Sale nhận khách**.
- **Chuyển toàn bộ**: **Đại lý → Tài khoản** (/leader-accounts) → **Chuyển khách** ở dòng sale →
  **Toàn bộ khách / Quá hạn chăm sóc / Đến hạn hôm nay** → **Xác nhận chuyển**. Đơn cũ vẫn tính sale cũ.
- **Xin nhận khách** sale khác: không gửi yêu cầu mới được nữa → báo Leader (khác đội: admin) chuyển.

## Kho khách cũ (/old-customer-pool)

Leader **Import Excel** (.xlsx ≤5MB, 5.000 dòng; bắt buộc **Họ tên**, **Số điện thoại**) → **Cấu hình**:
bật **Cho phép Sale lấy khách** (kho mới mặc định tắt), **Số khách mỗi lần lấy** 1–50 (mặc định 5).
Sale bấm **Lấy N khách**.

## Ranh giới

Agent KHÔNG sửa, xoá, chuyển, duyệt hay thêm khách trên CRM thay đại lý — chỉ chỉ cách làm.
