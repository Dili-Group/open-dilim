---
name: duyet-don-0d
description: Duyệt đơn qua kho ngay trong nhóm đại lý khi khách lẻ đã thanh toán cho đại lý — đại lý gửi bill khách chuyển khoản kèm mã vận đơn (kể cả đơn COD 0đ cũng cần bill). Load khi đại lý gửi ẢNH BILL chuyển khoản kèm mã đơn, nói "khách đã chuyển khoản", "khách ck rồi", "đơn 0đ", "đơn ck trước", "duyệt đơn", "cho đơn đi", "đơn em sao chưa đi".
agents: dealer
---

# Duyệt đơn đã thanh toán — nhóm đại lý

"Thanh toán" ở skill này là **KHÁCH LẺ (người mua cuối) trả tiền CHO ĐẠI LÝ** — bill là lệnh
chuyển khoản của khách vào tài khoản đại lý. KHÔNG phải tiền đại lý chuyển cho công ty (việc đó
là `tra_tien_can_chuyen` / phiếu thanh toán gộp — đừng lẫn hai dòng tiền).

Đại lý muốn đơn được đi tiếp qua bước kho. Điều kiện duyệt **DUY NHẤT**:

> **Bill khách chuyển khoản + mã vận đơn.** Kể cả đơn COD 0đ trên hệ thống cũng PHẢI có bill —
> 0đ không phải đường tắt. Có bill kèm mã là đủ, KHÔNG đối chiếu số tiền trên bill với tiền đơn.

⚠️ **COD trên hệ thống CÓ THỂ SAI** với các đơn dạng này: đơn đưa lên hệ thống không phản ánh
chính xác vụ bán cho khách lẻ, và khách hay **thanh toán trước MỘT PHẦN** mà hệ thống không ghi
prepaid bao nhiêu. Vì vậy:

- Số COD (0đ hay > 0) KHÔNG quyết định gì — không phải bằng chứng khách đã trả hay chưa trả.
  Đừng lấy số COD hệ thống ra phản bác bill của đại lý, đừng nói "khách còn phải trả X" theo số đó.
- Bill **ít tiền hơn tiền đơn là BÌNH THƯỜNG** (khách trả một phần) — vẫn duyệt, không hỏi
  "sao thiếu", không đòi bill cho phần còn lại.

Chưa thấy bill (dù đơn 0đ) → chưa duyệt, hỏi xin bill khách chuyển khoản. Một câu.

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
  Có → đi tiếp Bước 3, **mặc kệ số COD và số tiền trên bill** (COD có thể sai, khách có thể mới
  trả một phần — xem cảnh báo đầu skill). Chưa có bill → xin bill, dừng — **kể cả đơn 0đ**.
  Nhắc COD với đại lý thì nói rõ là *"trên hệ thống đang ghi"*, không khẳng định khách còn nợ.
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
  duyệt nếu đã có bill.
- Chưa đối chiếu số tiền bill với tiền đơn ở giai đoạn này — nhưng nếu đọc bill thấy điều bất
  thường rõ ràng (bill mờ, không phải bill chuyển khoản) thì nói thẳng và chưa duyệt.
- Chỉ duyệt đơn của đại lý phòng này. Đơn của đại lý khác gửi hộ → từ chối, chỉ sang nhóm của
  đại lý đó.
