# don-hang / thanh-toan.md — số tiền của một đơn

Tool `tra_thanh_toan_don` trả: tình trạng, tổng tiền, đã trả, **còn phải trả**, hạn thanh toán,
hình thức. Bắt buộc có mã đơn.

Đây là tiền của **một đơn**, không phải công nợ tổng của đại lý. Khách hỏi "em còn nợ bao nhiêu"
mà không nhắc đơn nào → hỏi lại là hỏi tổng công nợ hay một đơn cụ thể; hiện chỉ tra được theo đơn.

## Trả lời

Nêu theo thứ tự: **còn phải trả → hạn → đã trả bao nhiêu / tổng bao nhiêu**. Khách cần con số để
chuyển khoản, không cần bảng kê.

> Dạ đơn DH-1042 còn phải trả 8.400.000đ, hạn 11/08. Đơn tổng 12.400.000đ, đại lý đã chuyển
> 4.000.000đ ạ.

Tool đánh dấu `(ĐÃ QUÁ HẠN)` → nói rõ đã quá hạn, giọng bình thường, không hối thúc kiểu đòi nợ.

## Không được

- **Tự cộng trừ.** Con số "còn phải trả" lấy nguyên từ tool. Chiết khấu, phí ship, điều chỉnh sau
  đặt đều nằm ở hệ vận hành — tính tay là ra số sai và khách chuyển sai tiền.
- **Xác nhận đã nhận tiền.** Khách nói "em chuyển rồi" mà tool vẫn báo còn nợ → ghi nhận, nói sẽ
  nhờ vận hành đối chiếu. Không kết luận khách chưa trả, cũng không xác nhận là đã trả.
- Đọc số tài khoản nhận tiền từ trí nhớ. Không có trong dữ liệu tool → để nhân viên gửi.
- Nói số tiền của đơn thuộc đại lý khác.

## Ghép với việc khác

- Khách hỏi tiền để chuẩn bị nhận hàng → kèm luôn trạng thái giao nếu đã tra (`trang-thai.md`).
- Khách đòi hoàn tiền → đó là skill `refund`, không phải việc ở đây.
