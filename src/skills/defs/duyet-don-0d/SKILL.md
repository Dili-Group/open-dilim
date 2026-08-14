---
name: duyet-don-0d
description: Duyệt đơn qua kho ngay trong nhóm đại lý — hai cửa; khách lẻ đã thanh toán cho đại lý (đại lý gửi bill khách chuyển khoản kèm mã vận đơn, kể cả đơn COD 0đ cũng cần bill), hoặc đơn kẹt vì COD lệch bảng giá và đại lý yêu cầu cho đơn đi. Load khi đại lý gửi ẢNH BILL chuyển khoản kèm mã đơn, nói "khách đã chuyển khoản", "khách ck rồi", "đơn 0đ", "đơn ck trước", "duyệt đơn", "cho đơn đi", "cứ cho đơn chạy", "đơn em sao chưa đi".
agents: dealer
---

# Duyệt đơn qua kho — nhóm đại lý (đã thanh toán / kẹt lệch giá)

"Thanh toán" ở skill này là **KHÁCH LẺ (người mua cuối) trả tiền CHO ĐẠI LÝ** — bill là lệnh
chuyển khoản của khách vào tài khoản đại lý. KHÔNG phải tiền đại lý chuyển cho công ty (việc đó
là `tra_tien_can_chuyen` / phiếu thanh toán gộp — đừng lẫn hai dòng tiền).

Đại lý muốn đơn được đi tiếp qua bước kho. Có **HAI CỬA** duyệt, đơn qua một trong hai là đủ:

> **Cửa 1 — Bill khách chuyển khoản + mã vận đơn.** Kể cả đơn COD 0đ trên hệ thống cũng PHẢI có
> bill — 0đ không phải đường tắt. Có bill kèm mã là đủ, KHÔNG đối chiếu số tiền trên bill với
> tiền đơn.
>
> **Cửa 2 — Đơn kẹt vì LỆCH GIÁ + đại lý yêu cầu cho đơn đi.** Đơn COD thường nằm mãi ở "đơn
> hàng mới" do COD lệch bảng giá hệ thống (`kiem_tra_gia_cod` trả KHÔNG khớp) — giá đang trong
> giai đoạn chưa thống nhất nên công ty CHẤP NHẬN lệch: đại lý xác nhận vẫn muốn đơn đi với COD
> hiện tại thì duyệt, KHÔNG cần bill. Điều kiện: đã kiểm giá và NÓI RÕ mức lệch cho đại lý trước
> (đại lý phải biết mình đang chốt đi với số nào), và yêu cầu duyệt phải là của LƯỢT này —
> không suy ra từ việc đại lý giục chung chung. Duyệt xong vẫn ghi nhận chuyển vận hành soát
> lại giá.

⚠️ **COD trên hệ thống CÓ THỂ SAI** với các đơn dạng này: đơn đưa lên hệ thống không phản ánh
chính xác vụ bán cho khách lẻ, và khách hay **thanh toán trước MỘT PHẦN** mà hệ thống không ghi
prepaid bao nhiêu. Vì vậy:

- Số COD (0đ hay > 0) KHÔNG quyết định gì — không phải bằng chứng khách đã trả hay chưa trả.
  Đừng lấy số COD hệ thống ra phản bác bill của đại lý, đừng nói "khách còn phải trả X" theo số đó.
- Bill **ít tiền hơn tiền đơn là BÌNH THƯỜNG** (khách trả một phần) — vẫn duyệt, không hỏi
  "sao thiếu", không đòi bill cho phần còn lại.

Đại lý nói khách đã chuyển khoản mà chưa thấy bill (dù đơn 0đ) → chưa duyệt cửa 1, hỏi xin bill
khách chuyển khoản. Một câu. (Nếu đơn đồng thời kẹt lệch giá và đại lý yêu cầu đi thì cửa 2 vẫn
mở — không bắt đại lý chờ bill.)

## Bill thế nào là ĐỦ — đừng khó hơn mức cần

Bill đủ = **ảnh lệnh chuyển khoản đọc được** + **đại lý cung cấp mã vận đơn cho bill đó** (gõ
trong tin nhắn / nói trong lượt là đủ). Việc ghép bill nào với đơn nào là LỜI đại lý — tin theo
lời đại lý, agent không có dữ kiện để đối chiếu hộ. KHÔNG bác bill vì những thứ sau:

- **Nội dung CK không ghi mã đơn** — mã KHÔNG bắt buộc nằm trong nội dung chuyển khoản. Đại lý
  đưa mã kèm bill là đạt, đừng bắt khách chuyển lại "cho đúng cú pháp".
- **Tên người nhận không phải tên đại lý** — khách hay chuyển vào tài khoản khác của đại lý
  (tài khoản phụ, người nhà đứng tên). Agent không có danh sách tài khoản của đại lý để đối
  chiếu, nên tên người nhận không phải căn cứ từ chối.
- **Tên người gửi "lạ"** — agent không biết tên khách lẻ; không suy được người gửi là ai.

Lý do CHÍNH ĐÁNG duy nhất để chưa nhận bill: ảnh không phải lệnh chuyển khoản, hoặc mờ tới mức
không đọc được — nói thẳng đúng lý do đó, một câu.

## Bước 1 — Chốt mã vận đơn

Mã có thể nằm ở ba chỗ: gõ trong tin nhắn, trong nội dung chuyển khoản trên ảnh bill, hoặc đại
lý chỉ nói "đơn hôm qua của chị Lan". Thứ tự:

- Tin nhắn có mã → dùng nguyên văn.
- Chỉ có ảnh → `xem_anh` đọc bill: lấy mã vận đơn trong nội dung CK (nếu có), số tiền, ngày giờ.
- Không mã nào → tìm qua `tra_don_hang` như skill `don-hang` Bước 1: đúng 1 đơn khớp thì chốt,
  nhiều đơn thì hỏi lại một câu kèm mã + ngày tạo. **Không đoán bừa mã** — duyệt là lệnh GHI.

## Bước 2 — Tra đơn, chốt đúng đơn

`tra_don_hang` với từng mã để có chi tiết: trạng thái, tên khách, COD hệ thống. Đây là phần
"đầy đủ thông tin để duyệt" — nói lại cho đại lý biết mình duyệt đơn nào, của khách nào.

- Lượt này (hoặc ngay trước đó) đại lý có gửi bill khách chuyển khoản cho đúng đơn này không?
  Có → cửa 1 mở, đi tiếp Bước 3, **mặc kệ số COD và số tiền trên bill** (COD có thể sai, khách
  có thể mới trả một phần — xem cảnh báo đầu skill).
  Nhắc COD với đại lý thì nói rõ là *"trên hệ thống đang ghi"*, không khẳng định khách còn nợ.
- Không có bill nhưng đơn kẹt lệch giá và đại lý YÊU CẦU cho đơn đi → kiểm cửa 2: đã gọi
  `kiem_tra_gia_cod` cho đúng đơn này chưa, đã nói mức lệch cho đại lý chưa. Đủ cả hai → Bước 3.
  Chưa kiểm giá → kiểm và báo mức lệch trước, đại lý xác nhận lại rồi mới duyệt.
- Không rơi vào cửa nào (đơn khách CK mà chưa có bill, hoặc đơn thường không kẹt giá) → xin bill
  / chuyển vận hành, dừng — **kể cả đơn 0đ**.
- Trạng thái **"chờ đại lý chuyển tiền"** → CẢ HAI CỬA ĐỀU ĐÓNG, dừng ngay: đây là tiền ĐẠI LÝ
  nợ CÔNG TY, không phải chuyện khách CK hay lệch giá. Hướng dẫn đại lý tạo phiếu thanh toán gộp
  (`tao_phieu_thanh_toan`, skill `don-hang`) và chuyển khoản — tiền về là đơn tự đi tiếp. Tool
  cũng tự loại các mã này khỏi lô.
- Không thấy đơn → nói *không thấy đơn đó của đại lý mình* (đừng nói "không tồn tại" — xem
  skill `don-hang`), hỏi lại mã.

## Bước 3 — Duyệt

Gọi `duyet_don_da_thanh_toan` với danh sách mã đã chốt (một bill nhiều đơn → gom một lần gọi).
Tool tự kiểm tra từng mã đúng là đơn của đại lý phòng này — mã lạ bị loại, không cần tự lo.

Chỉ gọi khi đại lý THẬT SỰ muốn đơn đi (gửi bill là muốn rồi). Không tự gom mã từ lịch sử chat
cũ vào lô mà đại lý không nhắc tới lượt này.

## Bước 4 — Báo kết quả

Báo ĐẦY ĐỦ như tool trả: số đơn duyệt được, đơn đã duyệt từ trước, và **từng mã không qua kèm
lý do** (bị từ chối theo trạng thái / không tìm thấy / bị loại) — đừng chỉ khoe phần thành công.

Tool báo lỗi kiểu "KHÔNG RÕ đã ghi hay chưa" → truyền đúng sự lửng đó cho đại lý: hệ thống đang
chậm, em kiểm tra lại rồi báo, anh/chị đừng gửi lại kẻo trùng. KHÔNG tự gọi lại tool.

## Ranh giới

- Duyệt qua kho là việc GHI **duy nhất** skill này được làm. Xác nhận đã nhận tiền, sửa COD,
  huỷ đơn → vẫn chuyển nhân viên phụ trách.
- Đại lý báo COD trên hệ thống sai → ghi nhận và chuyển nhân viên chỉnh; việc đó KHÔNG chặn
  duyệt (cửa 1 lẫn cửa 2 — lệch giá đang được chấp nhận trong giai đoạn giá chưa thống nhất).
  Cần đối chiếu số cụ thể với bảng giá → `kiem_tra_gia_cod` (skill `kiem-tra-gia-cod`).
- Cửa 2 KHÔNG phải cửa sửa giá: duyệt là cho đơn đi với COD đang có, không hứa hệ thống sẽ đổi
  số, không tự chỉnh COD. Chuyện chốt lại giá để vận hành và đại lý làm với nhau.
- Chưa đối chiếu số tiền bill với tiền đơn ở giai đoạn này — nhưng nếu đọc bill thấy điều bất
  thường rõ ràng (bill mờ, không phải bill chuyển khoản) thì nói thẳng và chưa duyệt.
  "Bất thường" KHÔNG gồm: thiếu mã đơn trong nội dung CK, tên người gửi/nhận lạ, ngày chuyển
  cũ — xem mục "Bill thế nào là ĐỦ".
- Chỉ duyệt đơn của đại lý phòng này. Đơn của đại lý khác gửi hộ → từ chối, chỉ sang nhóm của
  đại lý đó.
