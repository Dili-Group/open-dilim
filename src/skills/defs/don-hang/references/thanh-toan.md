# don-hang / thanh-toan.md — tiền của một đơn

**Hai loại tiền khác nhau, hai tool khác nhau. Trả nhầm là đại lý chuyển sai tiền.**

| Khách hỏi | Tool | Con số |
|---|---|---|
| "Đơn này em cần chuyển bao nhiêu để đơn được đi?" · "giá đại lý đơn này?" | `tra_tien_can_chuyen` | Tiền ĐẠI LÝ trả CÔNG TY = giá đại lý theo bậc chiết khấu + phí hộp giấy |
| "Khách phải trả bao nhiêu?" · "COD đơn này?" · "phí ship?" | `tra_don_hang` | Tiền của đơn: `Tạm tính`, `Giảm giá`, `Phí ship`, `Tổng tiền`, `Thu hộ COD` |

Không lấy số của tool này trả lời câu hỏi của tool kia, không cộng hai bên lại với nhau.

`tra_tien_can_chuyen` **bắt buộc mã vận đơn** — chưa có mã thì chốt đơn bằng `tra_don_hang` trước
(xem `SKILL.md` bước 1).

## Trả lời "cần chuyển bao nhiêu"

Nêu số cần chuyển trước, rồi mới tới phần tách và khối chuyển khoản:

> Dạ đơn GHTK123456 mình cần chuyển **1.005.000 ₫** ạ (giá đại lý 1.000.000 ₫ + phí hộp giấy 5.000 ₫).
> Ngân hàng Vietcombank · STK 0011000123456 · CONG TY DILI
> Nội dung chuyển khoản: NAP DL001
> QR: https://qr...

Phí hộp giấy áp cho **mọi đơn** — không phải phát sinh lạ.

- **Nội dung chuyển khoản in NGUYÊN VĂN** như tool trả: không viết tắt, không đổi hoa thường, không
  chèn thêm mã đơn hay tên khách. Sai nội dung là tiền không vào ví đại lý.
  Câu dặn phải gọi thẳng người nhận, đừng viết như trích quy định:

  > Anh gõ nguyên văn `NAP DL001` giúp em nhé anh, đừng thêm mã đơn hay ký tự nào — thêm vào là
  > tiền không vào ví ạ.

  Không viết: "Nội dung phải gõ nguyên văn NAP DL001, không thêm ký tự nào." — trống chủ ngữ.
- Nội dung đó là **nạp ví theo mã đại lý**, giống nhau cho mọi đơn của đại lý đó — tiền vào ví rồi
  hệ thống tự trừ. Đại lý thắc mắc "sao không có mã đơn" → giải thích đúng như vậy.
- Tool không trả tên hàng ở đây (chỉ có số dòng hàng tính theo giá đại lý). Đại lý muốn biết đơn gồm
  những gì → gọi `tra_don_hang`.

## Trả lời "khách phải trả bao nhiêu"

Đọc lại đúng các dòng `tra_don_hang` in ra, dòng nào tool bỏ thì cũng không được nói tới:

> Đơn VTP0093412 tổng 12.400.000 ₫, thu hộ COD 12.400.000 ₫, phí ship 35.000 ₫ ạ.

Định dạng giữ nguyên như tool in: `1.234.567 ₫`.

## Không được

- **Tự cộng trừ.** Không cộng giá đại lý với phí hộp giấy, không trừ giảm giá, không cộng dồn nhiều
  đơn. Chiết khấu, phí, điều chỉnh sau đặt đều nằm ở hệ vận hành — tính tay là ra số sai và đại lý
  chuyển sai tiền. Chỉ đọc lại đúng con số tool trả.
- **Xác nhận đã nhận tiền.** Đại lý nói "em chuyển rồi" mà đơn vẫn ở trạng thái *chờ đại lý chuyển
  tiền* → ghi nhận, nói sẽ nhờ vận hành đối chiếu. Không kết luận là chưa trả, cũng không xác nhận
  là đã trả.
- Đọc số tài khoản hay nội dung chuyển khoản **từ trí nhớ**. Chỉ dùng đúng khối tool vừa trả.
- Trả lời công nợ tổng của đại lý — hiện chỉ tra được **theo từng đơn**. Cần số tổng → chuyển nhân
  viên phụ trách.
- Nói số tiền của đơn thuộc đại lý khác.

## Ghép với việc khác

- Đại lý hỏi tiền để đơn được đi → kèm luôn trạng thái đơn (`trang-thai.md`), khách biết đơn đang
  chờ ở bước nào.
- Khách đòi hoàn tiền → đó là skill `refund`, không phải việc ở đây.
