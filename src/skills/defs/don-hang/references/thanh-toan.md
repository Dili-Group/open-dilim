# don-hang / thanh-toan.md — tiền của một đơn

**Hai loại tiền khác nhau, hai tool khác nhau. Trả nhầm là đại lý chuyển sai tiền.**

| Khách hỏi | Tool | Con số |
|---|---|---|
| "Đơn này em cần chuyển bao nhiêu để đơn được đi?" · "giá đại lý đơn này?" | `tra_tien_can_chuyen` | Tiền ĐẠI LÝ trả CÔNG TY = giá đại lý theo bậc chiết khấu + phí hộp giấy |
| "Khách phải trả bao nhiêu?" · "COD đơn này?" · "phí ship?" | `tra_don_hang` | Tiền của đơn: `Tạm tính`, `Giảm giá`, `Phí ship`, `Tổng tiền`, `Thu hộ COD` |

Không lấy số của tool này trả lời câu hỏi của tool kia, không cộng hai bên lại với nhau.

`tra_tien_can_chuyen` **bắt buộc mã vận đơn** — chưa có mã thì chốt đơn bằng `tra_don_hang` trước
(xem `SKILL.md` bước 1).

## Hai dòng tiền vào công ty — KHÔNG trộn

| Dòng tiền | Nội dung CK | Tiền về thì sao |
|---|---|---|
| **Thanh toán đơn** — phiếu gộp `tao_phieu_thanh_toan` | `DH` + mã phiếu | Webhook khớp phiếu → các đơn trong phiếu TỰ mở khoá, tự đi tiếp |
| **Nạp ví** — `lay_qr_nap_vi` | `DLM` + mã đại lý | Tiền CHỈ vào ví (bù lại nếu ví đang âm). KHÔNG mở khoá đơn nào |

Đại lý muốn đơn đi mà chuyển theo nội dung nạp ví → tiền nằm trong ví, đơn vẫn đứng ở *chờ đại lý
chuyển tiền*. Vì vậy: **muốn đơn được đi thì LUÔN tạo phiếu thanh toán gộp — kể cả chỉ 1 đơn.**
Phiếu 1 mã là hợp lệ.

## Trả lời "cần chuyển bao nhiêu"

Nêu số cần chuyển + phần tách, rồi đề nghị tạo phiếu luôn — `tra_tien_can_chuyen` chỉ trả con số,
KHÔNG có khối chuyển khoản:

> Dạ đơn GHTK123456 mình cần chuyển **1.005.000 ₫** ạ (giá đại lý 1.000.000 ₫ + phí hộp giấy
> 5.000 ₫). Em tạo phiếu thanh toán cho đơn này để anh quét QR chuyển luôn nhé anh?

Đại lý đồng ý (hoặc câu hỏi gốc đã là "cho chị thanh toán đơn này") → gọi `tao_phieu_thanh_toan`
với mã vận đơn đó, đưa đúng khối QR + nội dung `DH…` phiếu trả về.

Phí hộp giấy áp cho **mọi đơn** — không phải phát sinh lạ.

- **Nội dung chuyển khoản in NGUYÊN VĂN** như tool trả: không viết tắt, không đổi hoa thường,
  không chèn thêm mã đơn hay tên khách. Sai nội dung là webhook không khớp phiếu, tiền về mà đơn
  không đi. Câu dặn phải gọi thẳng người nhận, đừng viết như trích quy định:

  > Anh gõ nguyên văn `DH000123` giúp em nhé anh, đừng thêm mã đơn hay ký tự nào — sai nội dung
  > là đơn không được mở khoá ạ.

- Đại lý hỏi "sao không chuyển theo nội dung nạp ví / em nạp ví rồi mà" → giải thích: nạp ví chỉ
  cộng tiền vào ví, hệ thống KHÔNG lấy tiền ví trả cho đơn; đơn đi bằng phiếu `DH…`. Đã lỡ nạp
  ví thay vì thanh toán phiếu → tiền vẫn nằm trong ví, báo sẽ nhờ vận hành đối soát, đừng hứa
  hệ thống tự trừ.
- `tra_tien_can_chuyen` không trả tên hàng (chỉ có số dòng hàng tính theo giá đại lý). Đại lý
  muốn biết đơn gồm những gì → gọi `tra_don_hang`.

## Trả lời "khách phải trả bao nhiêu"

Đọc lại đúng các dòng `tra_don_hang` in ra, dòng nào tool bỏ thì cũng không được nói tới:

> Đơn VTP0093412 tổng 12.400.000 ₫, thu hộ COD 12.400.000 ₫, phí ship 35.000 ₫ ạ.

Định dạng giữ nguyên như tool in: `1.234.567 ₫`.

## Không được

- **Tự cộng trừ.** Không cộng giá đại lý với phí hộp giấy, không trừ giảm giá, không cộng dồn nhiều
  đơn. Chiết khấu, phí, điều chỉnh sau đặt đều nằm ở hệ vận hành — tính tay là ra số sai và đại lý
  chuyển sai tiền. Chỉ đọc lại đúng con số tool trả.
- **Xác nhận đã nhận tiền.** Đại lý nói "em chuyển rồi" mà đơn vẫn ở trạng thái *chờ đại lý chuyển
  tiền* → hỏi lại đã chuyển theo nội dung `DH…` của phiếu hay nội dung nạp ví `DLM…`; chuyển nhầm
  nạp ví thì nói đúng như mục trên. Không kết luận là chưa trả, cũng không xác nhận là đã trả.
- Đọc số tài khoản hay nội dung chuyển khoản **từ trí nhớ**. Chỉ dùng đúng khối `tao_phieu_thanh_toan`
  (hoặc `lay_qr_nap_vi` nếu việc là nạp ví) vừa trả.
- Trả lời công nợ tổng của đại lý — hiện chỉ tra được **theo từng đơn**. Cần số tổng → chuyển nhân
  viên phụ trách.
- Nói số tiền của đơn thuộc đại lý khác.

## Ghép với việc khác

- Đại lý hỏi tiền để đơn được đi → kèm luôn trạng thái đơn (`trang-thai.md`), khách biết đơn đang
  chờ ở bước nào.
- Khách đòi hoàn tiền → đó là skill `refund`, không phải việc ở đây.
