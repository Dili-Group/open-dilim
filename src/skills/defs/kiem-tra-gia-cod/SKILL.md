---
name: kiem-tra-gia-cod
description: Đối chiếu COD với bảng giá hệ thống bằng tool kiem_tra_gia_cod — "COD vậy đúng chưa", "giỏ này bao nhiêu tiền", "đơn bị giữ vì sai giá à", "sao đơn chưa đi" khi nghi lệch giá. Load khi cần kiểm giá một đơn/giỏ hoặc giải thích đơn mới bị giữ vì giá.
agents: dealer
---

# Kiểm tra giá COD — đối chiếu với bảng giá hệ thống

Tool `kiem_tra_gia_cod` hỏi engine giá: COD của một đơn (theo mã vận đơn) hoặc một giỏ tự nhập
(`gio_hang` + `cod`) có khớp bảng giá hiện hành không. CHỈ ĐỌC — không sửa giá, không duyệt đơn,
không đổi trạng thái. Mỗi lần gọi 1 đơn/giỏ; đại lý dán nhiều mã thì gọi từng mã.

⚠️ Bảng giá hệ thống đang cấu hình theo **phiên bản mới nhất**, và phiên bản đó **chưa chắc là
bản đại lý đã chốt** (giá đang trong quá trình thống nhất). Vì vậy "COD không khớp" nghĩa là
*lệch với bảng giá hệ thống đang áp*, KHÔNG đương nhiên nghĩa là *đại lý sai*. Không buộc tội.

## Gọi thế nào

- Có mã vận đơn → truyền `ma_van_don`, hệ thống tự lấy giỏ + COD của đơn. KHÔNG truyền kèm giỏ.
- Chưa lên đơn (đại lý hỏi "giỏ này COD bao nhiêu là đúng") → truyền `gio_hang` (mảng
  `{sku, so_luong}`) + `cod` là **tiền hàng VND nguyên, ĐÃ trừ phí ship**.
- Mã không ra kết quả → nói theo chuẩn `don-hang`: không thấy đơn, đừng nói "không tồn tại".

## Đọc kết quả — theo kết luận tool in

| Kết luận | Nói với đại lý | Đừng làm |
|---|---|---|
| ĐÚNG GIÁ (OPTIMAL) | COD đúng giá, nêu chương trình áp nếu tool in | Nghi ngờ thêm |
| Hợp lệ nhưng THU DƯ (VALID_COMBO) | COD hợp lệ nhưng đang thu dư X so với giá tốt nhất Y (kèm tên chương trình) | Nói đơn sai giá |
| KHÔNG khớp (INVALID) | COD lệch bảng giá hệ thống; nêu giá tốt nhất + mức hợp lệ gần nhất; có câu đoán nguyên nhân thì đọc NGUYÊN VĂN | Tự bịa nguyên nhân; khẳng định "giá phải là X" khi tool nói giỏ có nhiều mức hợp lệ |
| CHƯA CÓ bảng giá (UNREACHABLE) | Chưa đối chiếu được (SKU chưa vào bảng giá), không kết luận đúng sai | Buộc tội đại lý sai giá |
| Giỏ quá lớn (TOO_COMPLEX) | Hệ thống không tính được, cần người kiểm tay | Tự phán đúng sai |

Chi tiết luôn lấy từ chữ tool in ra — tool đã dán sẵn cảnh báo từng nhánh, làm theo đúng nhánh.

## Ranh giới

- **Hai số tiền khác nhau**: "tiền hàng đối chiếu" (đã trừ ship) ≠ "tài xế thu trên đơn" (COD gộp
  ship). Tool in nhãn rõ — trích đúng nhãn, đừng tráo hai số cho nhau.
- **Quà tặng**: chỉ khẳng định có/không có quà khi tool in dòng phân rã giỏ (đúng giá / thu dư).
  Các nhánh khác tool im về quà nghĩa là KHÔNG BIẾT — đừng nói "đơn không có quà".
- COD lệch **không chặn** duyệt: có bill khách CK → cửa 1 `duyet-don-0d` như thường; không bill
  nhưng đơn kẹt vì chính cái lệch này và đại lý YÊU CẦU cho đơn đi → cửa 2 `duyet-don-0d`
  (lệch giá đang được chấp nhận trong giai đoạn giá chưa thống nhất) — báo mức lệch trước,
  đại lý xác nhận rồi duyệt.
- Phát hiện lệch (INVALID) → báo mức lệch cho đại lý, ghi nhận chuyển vận hành soát giá. Agent
  KHÔNG sửa giá, KHÔNG bảo đại lý huỷ/tạo lại đơn, KHÔNG cam kết bên nào đúng. Riêng câu đoán
  "COD chỉ trả cho một phần giỏ" là tín hiệu thất thoát mạnh — vẫn duyệt được nếu đại lý yêu
  cầu, nhưng BẮT BUỘC chuyển vận hành, đừng để trôi.
- Đại lý phản bác "bảng giá đó cũ/chưa chốt" → ghi nhận và chuyển vận hành, không cãi giá.
