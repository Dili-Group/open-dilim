---
name: giuc-don
description: Đại lý hối đơn đi sớm hoặc hỏi vì sao chưa đi — "đơn hoả tốc", "Grab gấp", "đi giúp chị", "khách đang đợi", "sao lâu vậy", "vì sao đơn chưa được đi". Tra trạng thái thật rồi trả lời trấn an đúng khâu đơn đang nằm; đơn "mới" bị hỏi lý do thì chẩn đoán (lệch giá / chờ bill khách CK). Load kèm skill don-hang khi tin nhắn có giọng giục, không chỉ hỏi.
agents: dealer
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
| chờ đại lý chuyển tiền | Đơn chờ ĐẠI LÝ thanh toán cho công ty — tạo phiếu gộp (`tao_phieu_thanh_toan`) và CK thì đơn tự đi tiếp | Duyệt hộ qua kho (cấm, kể cả có bill khách CK hay đại lý yêu cầu — xem `duyet-don-0d`) |
| đã soạn xong / chờ bàn giao ĐVVC | Hàng xong rồi, đang chờ ĐVVC lấy | Nói "em bảo tài xế đến ngay" |
| đã bàn giao ĐVVC / đang vận chuyển | Đơn **đã rời tay mình** — đưa ĐVVC + mã vận đơn để đại lý tự theo dõi | Giục hộ; không còn gì ở kho để đẩy |
| giao thành công | Đơn xong, nêu mốc giao | Tra tiếp |
| đã huỷ | Đơn đã huỷ, hỏi đại lý có đặt lại không | Tự khôi phục |

Nhãn lạ (tool in "mã 42") → nói đơn đang ở một bước xử lý nội bộ, chuyển vận hành. Chi tiết từng
nhãn: `don-hang/references/trang-thai.md`.

### Đơn "mới" mãi chưa đi — hỏi VÌ SAO thì chẩn đoán, đừng chỉ trấn an

Đại lý không chỉ giục mà hỏi thẳng *"vì sao đơn này chưa được đi"* trong khi đơn nằm ở "đơn hàng
mới" → thường rơi vào một trong ba nguyên nhân. Chẩn đoán theo thứ tự rẻ trước:

1. **Kiểm giá trước** (không tốn lượt hỏi): gọi `kiem_tra_gia_cod` với mã đơn, đọc theo skill
   `kiem-tra-gia-cod`. COD lệch bảng giá → đó là lý do khả dĩ đơn bị giữ: nói *COD đơn đang lệch
   với bảng giá hệ thống* (kèm mức đúng gần nhất tool trả). KHÔNG khẳng định đại lý sai — bảng
   giá hệ thống là bản mới nhất, phần giá này chưa thống nhất xong. Lệch giá đang được CHẤP NHẬN:
   đại lý xác nhận vẫn muốn đơn đi → duyệt luôn theo cửa 2 skill `duyet-don-0d` (không cần bill),
   song song ghi nhận chuyển vận hành soát giá. Đại lý chưa nói gì → hỏi một câu *mình cho đơn đi
   với COD hiện tại luôn không ạ*.
2. **Khách đã chuyển khoản cho đại lý** (toàn bộ hoặc một phần) → đơn chờ bill để duyệt qua kho:
   hỏi một câu *khách đã CK chưa*, có thì xin bill kèm mã và đi tiếp theo skill `duyet-don-0d`.
   Bill ít hơn tiền đơn là bình thường (khách trả một phần) — vẫn duyệt được.
3. Giá đúng, không phải đơn khách CK → còn trong kho chờ xử lý như bảng trên: ghi nhận, chuyển
   vận hành.

Hai nguyên nhân đầu KHÔNG loại trừ nhau: đơn khách CK cũng hay lệch COD (COD đơn khách lẻ vốn
nhập không chuẩn — xem `duyet-don-0d`). Đại lý nói khách đã CK và có bill → duyệt theo
`duyet-don-0d` bình thường, lệch giá không chặn duyệt.

## Luật 4 — Không tự lôi chuyện tiền vào lượt giục

Đại lý đang hối đơn, không hỏi tiền. **Không** gọi `tra_tien_can_chuyen` và không dán khối chuyển
khoản chỉ vì thấy trạng thái đơn — trạng thái không đủ để kết luận đơn kẹt vì tiền.

Ngoại lệ duy nhất: trạng thái **"chờ đại lý chuyển tiền"** — chính trạng thái nói đơn kẹt vì
chưa thanh toán, nói thẳng sự thật đó và chỉ đường tạo phiếu gộp. Nhưng vẫn KHÔNG tự dán khối
chuyển khoản/QR — đại lý đồng ý thanh toán rồi mới tạo phiếu.

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
