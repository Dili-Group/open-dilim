# DiLiM CRM — tài khoản, đăng nhập, thông báo

Chỉ áp cho **DiLiM CRM** (đăng nhập **tên đăng nhập + mật khẩu**), KHÁC **Hệ thống DiLiM** (app đại
lý, xem `mat-khau.md`). Không rõ hệ thống nào → hỏi một câu: CRM hay app đại lý.
Trong CRM, đại lý = tài khoản **Leader**, sale của họ = **Sale**.

Agent **không** reset mật khẩu, tạo/duyệt/mở khoá tài khoản, cấp quyền, đăng nhập hộ. Việc đó do
Leader hoặc admin; kẹt thì hỏi **Nhóm Zalo hỗ trợ CRM** (link dưới nút đăng nhập). Gửi đủ bước một lần.

## Đăng nhập

Tab **Sale & Leader** → **Tên đăng nhập**, **Mật khẩu** → **Đăng nhập**.

| Màn hình báo | Xử lý |
|---|---|
| **Tên đăng nhập hoặc mật khẩu không đúng** | Câu chung cho sai tên, sai mật khẩu, tài khoản **bị khoá** hoặc **chưa được duyệt**. Kiểm chữ hoa/thường, tắt bộ gõ tiếng Việt. Quên → **Quên mật khẩu?**. Vẫn kẹt → Leader/admin kiểm tra |
| Sai nhiều lần bị chặn | Đợi khoảng 1 phút |
| Bị chuyển sang **Đổi mật khẩu tạm** | Xem mục mật khẩu tạm |

## Quên mật khẩu (/forgot-password)

1. Bấm **Quên mật khẩu?**
2. Nhập **Tên đăng nhập** + **Email** đã khai cho CHÍNH tài khoản đó → **Gửi mã xác nhận**
3. Lấy **mã 6 số** trong hộp thư (hiệu lực **15 phút**)
4. Nhập **Mã xác nhận**, **Mật khẩu mới** (≥ 6 ký tự), **Xác nhận mật khẩu** → **Đổi mật khẩu**
5. **Đăng nhập ngay**. Máy khác bị đăng xuất.

Hệ thống luôn báo đã gửi mã, kể cả khi không khớp.

| Tình huống | Xử lý |
|---|---|
| Không thấy mã | Xem Spam; hết đếm ngược bấm **Gửi lại mã** (1 lần/phút); gõ sai → **Nhập lại tài khoản** |
| Chưa khai email / bị khoá | Không nhận được mã → Leader/admin đặt lại mật khẩu tạm |
| **Mã không đúng hoặc đã hết hạn** | Sai, quá 15 phút, hoặc sai 5 lần → xin mã mới |

## Mật khẩu tạm lần đầu

Leader/admin tạo tài khoản hoặc đặt lại mật khẩu → **mật khẩu tạm**; lần đầu đăng nhập bắt đổi, chưa
đổi không mở được trang nào.
1. **Mật khẩu tạm**: gõ lại đúng mật khẩu vừa dùng
2. **Mật khẩu mới**: ≥ **8 ký tự**, có **1 chữ hoa, 1 chữ thường, 1 số hoặc ký tự đặc biệt**, khác mật khẩu tạm
3. **Nhập lại mật khẩu mới** → **Đổi mật khẩu**

**Mật khẩu mới phải khác mật khẩu hiện tại** = đang dùng lại mật khẩu tạm. Mất mật khẩu tạm → xin cấp lại.

## Đổi mật khẩu, hồ sơ

Bấm tên/ảnh → **Hồ sơ cá nhân** → thẻ **Đổi mật khẩu** (cần **Mật khẩu hiện tại**) hoặc **Thông tin
cá nhân** (sửa **Email** nhận mã). **Tên đăng nhập**, vai trò → Leader/admin đổi.

## Sale mới đăng ký bằng link mời (/register)

Không tự đăng ký được; chỉ qua **link mời** của Leader.
1. Điền **Họ và tên**, **Số điện thoại** (bắt đầu 0, 10–11 số), **Email** thật
2. **Tên đăng nhập** (≥ 3 ký tự, không dấu, không khoảng trắng), **Mật khẩu** (≥ 6 ký tự)
3. **Đăng ký tài khoản** → **Đăng ký thành công!**, trạng thái **Đang chờ duyệt**
4. **Leader chủ link (hoặc admin) duyệt** — dòng **đăng ký chờ duyệt** ở chuông thông báo

Chưa duyệt mà đăng nhập sẽ báo sai tên/mật khẩu — bình thường, nhắn Leader duyệt.
Lỗi **Link không hợp lệ** / **Link đã hết hạn hoặc không tồn tại** → xin Leader link mới.
**Tên đăng nhập đã tồn tại** → chọn tên khác.

## Linh tinh

- **Thiếu mục trên menu**: mục chỉ hiện khi vai trò được dùng VÀ chức năng đang bật. Vừa đổi vai trò → F5.
- **Thông báo đẩy**: **Dashboard** → **Bật thông báo** → **Cho phép**, bật từng máy. **Thông báo bị
  chặn** → ổ khoá cạnh thanh địa chỉ, cho phép, tải lại.
- **Cài app**: không có trên kho ứng dụng; menu trình duyệt → **Thêm vào màn hình chính**.
