# PosCake (Pancake POS) — lấy API Key & gắn Webhook đơn hàng

Đại lý bán trên **PosCake / Pancake POS** (`pos.pages.fm`, có nơi vào bằng `pos.pancake.vn`). Gắn
webhook xong thì **mọi đơn tạo trên PosCake tự chảy về hệ thống vận hành DILIM theo thời gian
thực** — đại lý không phải nhập đơn hai lần.

## Điều kiện trước khi làm

- Đăng nhập bằng **tài khoản admin** của shop. Tài khoản nhân viên không thấy mục cấu hình.
- Làm **trên máy tính**. App điện thoại PosCake **không có** mục Cấu hình nâng cao.

Đại lý nói "em không thấy mục Cấu hình" → hỏi đúng hai câu này trước, đừng hướng dẫn tiếp.

## Bước 1 — Lấy Shop ID

Shop ID là **dãy số trong thanh địa chỉ**, ngay sau `/shop/`:

```
https://pos.pages.fm/shop/123456/orders
                           ^^^^^^ Shop ID
```

## Bước 2 — Tạo API Key

1. **Cấu hình** → mục **Nâng cao** → **Kết nối bên thứ 3**
2. Tìm thẻ **Webhook/API** → bấm **Chi tiết**
3. Chọn tab **API Key** → bấm **Thêm mới**
4. Đặt ghi chú dễ nhớ (ví dụ `DILIM`) → **copy key ngay**
5. Kiểm cột **On/Off** — key phải đang **bật**

**Key chỉ hiện một lần.** Đóng cửa sổ mà chưa copy → xoá key đó, tạo key mới. Không có cách xem lại.

## Bước 3 — Dán Webhook URL

Vẫn trong **Webhook/API**, chuyển sang tab **Webhook URL** → dán link webhook DILIM cấp cho đại lý →
lưu.

**Link webhook không cố định**: vận hành cấp riêng cho từng đại lý. Agent **không có sẵn link này,
không tự ghép, không đoán**. Đại lý hỏi link → chuyển đầu mối để lấy đúng link của họ.

## Bước 4 — Gửi thông tin cho công ty

Đại lý gửi **Shop ID + API Key** cho **đầu mối Đình Trung** để vận hành hoàn tất đấu nối.

Gửi **riêng cho đầu mối, không nhắn vào nhóm chung**.

## Luật bảo mật — nói rõ cho đại lý

**API Key PosCake có quyền ngang tài khoản admin: đọc và GHI toàn bộ dữ liệu cửa hàng, không giới
hạn bớt quyền được.** Ai cầm key đó thao tác được như chủ shop.

- Đại lý lỡ dán API Key vào **nhóm chung** → agent **không nhắc lại chuỗi đó**. Hướng dẫn ngay:
  vào **Webhook/API → tab API Key → xoá key vừa lộ → Thêm mới** key khác, rồi gửi lại key mới cho
  đầu mối.
- Agent **không nhận, không đọc lại, không lưu, không chuyển tiếp** API Key.
- Đại lý muốn ngắt kết nối → xoá key trong tab API Key và xoá Webhook URL. Đơn thôi chảy về hệ thống
  ngay sau đó.

## Lỗi hay gặp

| Đại lý nói | Xử lý |
|---|---|
| Không thấy mục Cấu hình / Nâng cao | Đang dùng app điện thoại hoặc tài khoản không phải admin — xem "Điều kiện" |
| Quên copy key rồi | Không xem lại được. Xoá key cũ, **Thêm mới** key khác |
| Đã dán webhook mà đơn không về | Kiểm key còn **bật** ở cột On/Off, và dán **đúng link** vận hành cấp. Vẫn không được → chuyển đầu mối, kèm Shop ID |
| Hỏi tồn kho/sản phẩm có đồng bộ không | Ngoài phạm vi hướng dẫn này — chuyển đầu mối |

## Ranh giới

Agent **không**: đăng nhập hộ PosCake, tạo key hộ, dán webhook hộ, kiểm tra hộ webhook đã chạy chưa,
xác nhận đơn đã đồng bộ. Toàn bộ thao tác do đại lý tự làm trên tài khoản của họ; phần đấu nối phía
DILIM do vận hành làm.

Đại lý hỏi **đơn cụ thể đã về hệ thống chưa** → đó là tra cứu, nạp skill `don-hang`.
