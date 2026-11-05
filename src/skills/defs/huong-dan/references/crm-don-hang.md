# Đơn hàng trên DiLiM CRM

Chỉ áp dụng cho **DiLiM CRM**. Lên đơn trên app đại lý (**Hệ thống DiLiM**) là form khác → `tao-don.md`.
Đơn lên ở CRM tự sang DiLiM. Đại lý dùng tài khoản **Leader**.

## Lên đơn

Mở form: nút **Lên đơn** ở trang khách, **Hộp thư**, **Kho khách cũ**; hoặc **Đơn hàng** → **Tạo đơn**.

1. **Dán nhanh**: dán nguyên tin khách → bấm **Điền tự động** (không tự chạy). Ô thiếu hiện ở "Còn thiếu:
   …". Soát lại.
2. **Đại lý**: tự theo đại lý, không chọn. Báo "Chưa có thông tin đại lý" → liên hệ admin.
3. **Người gửi**: chọn / **Thêm** / **Ghim**. Trống = mặc định của đại lý.
4. **I. Thông tin khách hàng**: Họ tên, SĐT, Tỉnh/TP, Quận/Huyện, Phường/Xã, Địa chỉ chi tiết.
5. **II. Sản phẩm**: **Thêm sản phẩm** (có số "Còn"), tick **Quà tặng** nếu hàng tặng; khớp combo →
   **Áp dụng giá combo** (chỉ khi có thu hộ).
6. **III. Vận chuyển**: tự tính phí ViettelPost, **Tính lại phí** nếu cần.
7. **IV. Tổng kết & thanh toán**: **COD (thu hộ)**, **Phí ship** (Đại lý / Khách), **Khách đã chuyển
   khoản trước** (cọc < tiền hàng), **Chỉnh tiền COD**.
8. **Tạo đơn hàng** → "Đơn hàng đã tạo thành công!", hoặc **Lưu nháp**.

Báo "DiLiM-OS phản hồi chậm — đơn đang được xác minh, KHÔNG tạo đơn mới" → **đừng lên lại**, chờ vài
phút.

## Danh sách đơn (/dilim/orders)

- **Đơn DiLiM**: mọi đơn của đại lý, gồm cả đơn từ App đại lý / POS Cake.
- **Đơn lên từ CRM**: đơn của leader + sale trong đội, kể cả đơn **chưa sang DiLiM**. Lọc nguồn: Lên đơn
  tay, Từ Hộp thư, API tích hợp.

Lọc trạng thái ở ô **Mọi trạng thái** của tab Đơn DiLiM.

**Chi tiết đơn** (bấm vào đơn): mã vận đơn, **Hành trình đơn**, **Xem video đóng gói**, **Tin nhắn Zalo**.
"DiLiM từ chối đơn" → huỷ rồi tạo lại; "Đang xác minh với DiLiM" → chờ, đừng lên đơn mới.

## Huỷ / sửa / tạo lại (nút cuối Chi tiết đơn)

| Việc | Thao tác | Được khi |
|---|---|---|
| Huỷ | **Huỷ đơn hàng** → **Lý do huỷ đơn** (bắt buộc) → **Xác nhận huỷ** | Đơn mới, Chờ đại lý chuyển tiền, Đại lý đã chuyển tiền, Đã kiểm duyệt, Đang soạn hàng, Đã soạn xong; hoặc đơn chưa sang DiLiM |
| Sửa | **Sửa đơn** → **Lưu thay đổi** | Chỉ **Nháp** / **Đơn mới** |
| Sao chép | **Sao chép** | Đơn chưa huỷ |
| Tạo lại | **Tạo lại đơn** | Đơn **Đã hủy** (không áp cho **Đã tạo lại**) |

Từ Đã quét & đóng gói trở đi → không huỷ trên CRM, liên hệ vận hành. Quá Đơn mới cần sửa → huỷ rồi **Tạo lại đơn**.

## Tồn kho, sản phẩm

- **Sản phẩm & Kho** → **Tồn kho** (/inventory): **Hết hàng** = tồn 0; **Sắp hết** = bán được dưới 7
  ngày; **Còn hàng** = từ 7 ngày. Cập nhật ~10 phút/lần.

## Zalo tự nhắn khách

**Tin nhắn & Thông báo** → **Zalo của tôi** (/zalo-account). Gửi từ Zalo cá nhân theo trạng thái đơn
(xác nhận, đóng gói, sắp giao, đã giao, hỏi thăm). Chỉ 8h–21h, mỗi loại 1 lần/đơn, tối đa 30 tin/giờ, 150 tin/ngày. Khách không muốn → trang khách, tắt
**Khách nhận tin Zalo tự động**.

- **Kết nối**: cuộn hết bản đồng ý → tick → **Họ và tên** + **Số điện thoại gắn tài khoản Zalo** → ký
  → **Tôi đồng ý và ký** → **Quét mã QR** bằng Zalo của chính mình (hết hạn → **Lấy mã mới**). Bản đồng ý
  ghi Zalo có thể khoá tài khoản.
- **Ngắt**: **Ngắt kết nối**. Báo "Đã ngừng nhắn tin — bạn cần tự xoá thiết bị trong Zalo" → Zalo →
  Cài đặt → Quản lý thiết bị đăng nhập → xoá thiết bị lạ.

## Kiểm tra trùng đơn

**Công cụ** → **Kiểm tra trùng đơn** (/order-check), hoặc /kiem-tra-don **không cần đăng nhập**. Dán SĐT
di động 10 số → **Kiểm tra**. Xét 90 ngày, không tính đơn huỷ/nháp.

- **Chưa có đại lý nào lên đơn** → lên được.
- **Đã có N đại lý lên đơn** → liên hệ đại lý đó (có tên, mã, SĐT) trước khi lên.
- **Chưa kiểm tra được trên DiLiM-OS** → có thể thiếu đơn, thử lại sau.

Tranh chấp trùng đơn → người phụ trách trong `nhan-su-phu-trach.md`.

## Ranh giới

Agent **không** tạo, huỷ, sửa đơn trong CRM — chỉ chỉ cách. Đơn cụ thể của họ → skill `don-hang`.
