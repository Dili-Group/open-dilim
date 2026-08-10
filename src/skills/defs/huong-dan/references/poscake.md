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
không tự ghép, không đoán**. Đại lý hỏi link → chuyển Nhóm Hỗ trợ để lấy đúng link của họ.

## Bước 4 — Nạp vào hệ thống: agent làm ngay trong nhóm

Có **đủ Shop ID + API Key** thì đại lý gửi thẳng **trong nhóm riêng của họ** (nhóm đang chat) →
agent gọi tool **`nap_poscake`** với đúng hai giá trị đại lý vừa gửi. Không bắt đại lý nhắn thêm cho
ai nữa.

- Mới có **một** trong hai → hỏi nốt cái còn thiếu, **chưa gọi tool**.
- Tool báo **ĐÃ NẠP** → nói đã nạp xong, kèm Shop ID tool trả về. Tool báo lỗi → đọc đúng hướng xử
  lý trong kết quả tool, **không tự tuyên bố đã nạp**.
- Đây là nhóm riêng của đại lý. Ở **nhóm chung nhiều đại lý** thì KHÔNG: bảo họ nhắn trong nhóm
  riêng hoặc gửi **Nhóm Hỗ trợ**.

Việc còn lại (**Bước 3 — dán Webhook URL**) vẫn do đại lý tự làm; agent không có link đó.

## Luật bảo mật — nói rõ cho đại lý

**API Key PosCake có quyền ngang tài khoản admin: đọc và GHI toàn bộ dữ liệu cửa hàng, không giới
hạn bớt quyền được.** Ai cầm key đó thao tác được như chủ shop.

- Agent nhận API Key **chỉ để đưa thẳng vào `nap_poscake`**: **không nhắc lại chuỗi key** trong câu
  trả lời, không tóm tắt nó, không chép nó sang tin khác, không lấy lại key trong tin nhắn cũ để
  gọi tool lần nữa. Cần nạp lại → hỏi đại lý gửi key mới.
- Nạp xong: nhắc đại lý rằng key vừa gửi **vẫn nằm trong lịch sử nhóm** — nhóm có người ngoài đọc
  được thì xoá key đó và tạo key mới.
- Đại lý lỡ dán API Key vào **nhóm chung** → agent **không nhắc lại chuỗi đó**. Hướng dẫn ngay:
  vào **Webhook/API → tab API Key → xoá key vừa lộ → Thêm mới** key khác, rồi gửi key mới trong
  nhóm riêng của họ.
- Đại lý muốn ngắt kết nối → xoá key trong tab API Key và xoá Webhook URL. Đơn thôi chảy về hệ thống
  ngay sau đó.

## Lỗi hay gặp

| Đại lý nói | Xử lý |
|---|---|
| Không thấy mục Cấu hình / Nâng cao | Đang dùng app điện thoại hoặc tài khoản không phải admin — xem "Điều kiện" |
| Quên copy key rồi | Không xem lại được. Xoá key cũ, **Thêm mới** key khác |
| Đã dán webhook mà đơn không về | Kiểm key còn **bật** ở cột On/Off, và dán **đúng link** vận hành cấp. Vẫn không được → chuyển Nhóm Hỗ trợ, kèm Shop ID |
| `nap_poscake` báo hệ vận hành từ chối | Kiểm lại Shop ID (đúng dãy số sau `/shop/`) và key còn **bật**. Đúng cả rồi vẫn từ chối → chuyển Nhóm Hỗ trợ kèm Shop ID |
| Hỏi tồn kho/sản phẩm có đồng bộ không | Ngoài phạm vi hướng dẫn này — chuyển Nhóm Hỗ trợ |

## Ranh giới

Agent **làm được đúng một việc**: nạp Shop ID + API Key đại lý đưa vào hệ thống bằng `nap_poscake`.

Agent **không**: đăng nhập hộ PosCake, tạo key hộ, dán webhook hộ, kiểm tra hộ webhook đã chạy chưa,
xác nhận đơn đã đồng bộ. Mọi thao tác **trên PosCake** do đại lý tự làm trên tài khoản của họ.

Đại lý hỏi **đơn cụ thể đã về hệ thống chưa** → đó là tra cứu, nạp skill `don-hang`.
