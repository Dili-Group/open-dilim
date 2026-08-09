---
name: bao-het-hang
description: Quản lý kho báo một sản phẩm hết hàng và muốn báo cho các đại lý — "sản phẩm A hết hàng rồi", "cháy hàng B nhé", "hết X, 15/08 mới về", "báo các đại lý là hết hàng Y", "thông báo cho đại lý giúp anh". Load khi người trong nhóm kho nói một mặt hàng hết/cháy/tạm ngưng và có ý cho đại lý biết.
agents: warehouse
---

# Báo hết hàng — soạn thông báo phát cho toàn bộ đại lý

Đây là đường phát tin **tới mọi nhóm đại lý cùng lúc**, không rút lại được. Vì vậy nó có **ba
cửa**, và agent chỉ đi qua được hai cửa đầu:

```
1. quản lý kho nói hết hàng
2. agent soạn nháp        → soan_thong_bao_het_hang   (chưa ai nhận gì)
3. quản lý kho đọc, chốt  → gui_thong_bao_het_hang    (chưa ai nhận gì — mới chỉ XIN)
4. người duyệt công ty gật → hệ thống tự phát          ← KHÔNG PHẢI VIỆC CỦA AGENT
5. hệ thống báo kết quả về nhóm này
```

## Luật 1 — Chỉ quản lý kho mới xin phát được

Tool tự chặn theo chức danh trong hệ vận hành. Người khác nói "hết hàng rồi em ơi" thì **ghi nhận
trong nhóm là đủ** — đừng gọi tool, đừng hứa sẽ báo đại lý. Tool trả lỗi "không phải quản lý kho"
thì nói thẳng là việc này cần quản lý kho gõ, và nếu họ khẳng định mình là quản lý kho thì nhắc
chạy lại `/ketnoi-hethong`.

## Luật 2 — Chép dữ kiện, không sáng tác

Nội dung nháp chỉ được chứa thứ quản lý kho **đã nói**:

- **Tên sản phẩm**: chép nguyên văn. Họ nói "yến 100" thì viết "yến 100", đừng tự đổi thành "Yến
  sào 100g" — đại lý tra theo tên họ quen.
- **Ngày có hàng**: chỉ ghi khi họ đã nói ngày. Chưa nói → **không ghi ngày**, không viết "vài hôm
  nữa", "đầu tuần sau", "sẽ cập nhật sớm". Thiếu ngày thì thiếu, đại lý tự hỏi lại.
- **Lý do hết hàng**: không suy đoán. Họ không nói vì sao thì thôi.

Thiếu tên sản phẩm → **hỏi lại trước khi soạn**, đừng soạn một tin nói chung chung "một số mặt
hàng đang hết".

## Luật 3 — Đọc lại nguyên văn rồi mới chốt

Soạn xong, **đọc lại đúng từng chữ** bản nháp cho quản lý kho, kèm số nhóm sẽ nhận, rồi hỏi một
câu rõ ràng là có chốt không.

- Họ nói "ok", "gửi đi", "chốt" → gọi `gui_thong_bao_het_hang` với mã nháp.
- Họ sửa chữ nào → gọi lại `soan_thong_bao_het_hang` với nội dung mới, **đọc lại lần nữa**. Không
  chốt bản cũ.
- Họ im lặng, nói nước đôi ("ừ em xem giúp anh") → **chưa chốt**. Hỏi lại một câu.
- Nháp hết hạn sau 10 phút. Quá hạn thì soạn lại từ đầu, không đoán mã nháp cũ.

## Luật 4 — Chốt ≠ đã gửi. Tuyệt đối không nói "đã gửi cho đại lý"

Sau `gui_thong_bao_het_hang`, tin **vẫn chưa tới ai**. Nó đang chờ người duyệt của công ty đồng ý.

Nói đúng: *"Em đã chuyển thông báo đi duyệt, đang chờ duyệt ạ."*
Nói sai: *"Em đã gửi cho các đại lý rồi ạ."* / *"45 nhóm đã nhận."*

Không hứa khi nào được duyệt. Không nói ai là người duyệt.

## Luật 5 — Hỏi tiến độ thì tra, đừng đoán

"Duyệt chưa?", "đại lý nhận chưa?" → gọi `soat_thong_bao` (bỏ trống mã = đợt gần nhất). Trả đúng
thứ tool nói:

| Tool trả | Nói với quản lý kho |
|---|---|
| đang chờ duyệt | Đang chờ duyệt, chưa nhóm nào nhận. Không hứa thời điểm. |
| không được duyệt | Nêu **lý do** tool trả về, hỏi họ có sửa nội dung xin lại không. |
| đã duyệt, còn nhóm đang chờ | Đang gửi dần, `x/y` nhóm đã nhận. Chưa xong. |
| có nhóm hỏng | Nêu **số nhóm hỏng**. Mấy nhóm đó không nhận được — cần nhắn tay hoặc nhờ vận hành kiểm tra nhóm. |

Đừng cộng trừ số hộ tool, đừng làm tròn "gần hết rồi".

## Luật 6 — Một sản phẩm, một tin

Quản lý kho đọc liền ba sản phẩm hết hàng → soạn **một** nháp gộp cả ba, mỗi sản phẩm một dòng.
Đừng gọi tool ba lần: ba đợt phát là ba lần làm phiền mọi đại lý, và ba lần bắt người duyệt xử lý.

Hàng đã về lại → đó là **tin khác**, soạn nháp mới nói rõ đã có hàng. Không sửa tin cũ (tin cũ đã
nằm trong nhóm đại lý rồi, không xoá được).

## Luật 7 — Phải ở trong nhóm kho

Chốt phát tin chỉ làm được trong **nhóm** kho, không làm ở chat riêng — kết quả duyệt cần một
phòng để báo về. Tool trả lỗi đó thì bảo quản lý kho gõ lại trong nhóm.
