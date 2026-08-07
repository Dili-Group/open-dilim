---
name: giuc-don
description: Đại lý hối đơn đi sớm — "đơn hoả tốc", "Grab gấp", "đi giúp chị", "khách đang đợi", "sao lâu vậy". Tra trạng thái thật rồi trả lời trấn an đúng khâu đơn đang nằm. Load kèm skill don-hang khi tin nhắn có giọng giục, không chỉ hỏi.
---

# Giục đơn — đại lý hối cho đi sớm

Đại lý gửi một loạt mã hoả tốc (thường ĐVVC **Grab Express**) rồi hối: khách cuối đang đợi, đơn nội
thành, chậm một tiếng là mất khách. Agent **không có tool đẩy đơn** — không gọi kho, không gọi tài
xế, không đổi thứ tự soạn hàng.

Việc của agent gồm đúng ba phần: **tra trạng thái thật → nói đơn đang kẹt ở khâu nào → chuyển vận
hành**. Trấn an là cách *nói* ba phần đó, không phải thứ thay thế chúng.

## Luật 1 — Tra trước, trấn an sau

Không bao giờ trả lời "dạ em đang giục giúp chị" khi chưa gọi `tra_don_hang`. Câu trấn an không có
dữ kiện là câu hứa suông: đại lý đọc xong tưởng đơn đã được đẩy, một tiếng sau quay lại gắt gấp đôi.

Cách chốt đơn nào (có mã / không mã / nhiều đơn khớp): skill `don-hang`, bước 1.

## Luật 2 — Một loạt mã = một tin trả lời

Đại lý dán 5 mã thì tra đủ 5, trả **một tin**, mỗi đơn một dòng: `mã · trạng thái · việc kế tiếp`.
Không trả lời nhỏ giọt từng đơn, không bỏ sót đơn nào — đơn bị bỏ sót chính là đơn đại lý sẽ hỏi lại.

Mã nào không ra đơn → nói riêng dòng đó là chưa thấy đơn (cửa sổ 30 ngày), đừng im lặng.

## Luật 3 — Trấn an = nói đúng khâu đang kẹt

Giục chỉ có nghĩa khi đơn còn nằm ở kho. Nhìn trạng thái trước khi chọn giọng:

| Đơn đang ở | Sự thật cần nói | Đừng làm |
|---|---|---|
| mới / đã kiểm duyệt / đang soạn hàng | Còn trong kho, giục được → ghi nhận và chuyển vận hành | Hứa giờ xuất kho |
| đã soạn xong / chờ bàn giao ĐVVC | Hàng xong rồi, đang chờ ĐVVC lấy | Nói "em bảo tài xế đến ngay" |
| đã bàn giao ĐVVC / đang vận chuyển | Đơn **đã rời tay mình** — đưa ĐVVC + mã vận đơn để đại lý tự theo dõi | Giục hộ; không còn gì ở kho để đẩy |
| giao thành công | Đơn xong, nêu mốc giao | Tra tiếp |
| đã huỷ | Đơn đã huỷ, hỏi đại lý có đặt lại không | Tự khôi phục |

Nhãn lạ (tool in "mã 42") → nói đơn đang ở một bước xử lý nội bộ, chuyển vận hành. Chi tiết từng
nhãn: `don-hang/references/trang-thai.md`.

## Luật 4 — Không tự lôi chuyện tiền vào lượt giục

Đại lý đang hối đơn, không hỏi tiền. **Không** gọi `tra_tien_can_chuyen` và không dán khối chuyển
khoản chỉ vì thấy trạng thái đơn — trạng thái không đủ để kết luận đơn kẹt vì tiền.

Chỉ gọi tool đó khi đại lý hỏi thẳng số tiền ("đơn này em cần chuyển bao nhiêu", "giá đại lý đơn
này") — cách trả lời: `don-hang/references/thanh-toan.md`.

## Luật 5 — "Hoả tốc" là ĐVVC, không phải mức ưu tiên

Hoả tốc trong đầu đại lý = ĐVVC **Grab Express** (chi tiết đơn in `Đơn vị vận chuyển: Grab Express`).
Nói đúng ĐVVC tool trả về. Đại lý bảo hoả tốc mà đơn hiện ĐVVC khác → **không cãi**: nêu ĐVVC đang
gắn trên đơn, ghi nhận và chuyển vận hành kiểm tra. Agent không đổi ĐVVC.

Không có "mức ưu tiên" nào agent bật được. Đừng nói "em đánh dấu gấp", "em đẩy đơn lên đầu hàng đợi".

## Luật 6 — Cấm hứa

Không cam kết giờ xuất kho, giờ giao, ETA. Không nói đã gọi kho / đã báo tài xế / đã đẩy đơn khi
agent chỉ chuyển yêu cầu. Câu đúng: *đã ghi nhận và chuyển vận hành*, kèm tên nhân viên phụ trách
nếu tool trả về.

## Luật 7 — Đại lý giục lại lần hai

Không lặp nguyên câu cũ — lặp lại là tín hiệu agent không làm gì. Mỗi lần giục lại phải thêm ít nhất
một dữ kiện mới: mốc chuyển trạng thái gần nhất trong lịch sử, ĐVVC vừa nhận, hoặc tên nhân viên đã
nhận việc. Trạng thái y hệt lần trước → nói thẳng là chưa đổi tính tới thời điểm này, kèm mốc.

Giọng: ngắn, chắc, không xin lỗi dài dòng, không "dạ dạ" lấp chỗ trống. Mẫu câu từng nhánh:
`references/mau-cau.md`.
