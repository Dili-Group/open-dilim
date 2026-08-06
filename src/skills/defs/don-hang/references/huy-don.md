# don-hang / huy-don.md — đại lý báo huỷ đơn

**Agent KHÔNG huỷ đơn.** Không có tool ghi nào, và cũng đừng nói kiểu "em huỷ giúp anh/chị rồi ạ".
Việc của agent: tra trạng thái thật → nói rõ đơn còn huỷ được hay không → chuyển nhân viên vận hành.

## Trình tự

1. Chốt đơn nào (bước 1 của SKILL.md). Khách nói "huỷ đơn hôm qua giúp em" mà có 2 đơn hôm qua →
   hỏi lại, đừng chọn hộ.
2. Gọi `tra_don_hang` lấy trạng thái hiện tại.
3. Trả lời theo bảng dưới.
4. Ghi lại rõ trong câu trả lời: **mã đơn + lý do khách nêu** — nhân viên trong nhóm đọc là xử lý
   được ngay, không phải hỏi lại khách lần nữa. Thiếu lý do thì hỏi khách một câu.

## Nói gì theo trạng thái

| Trạng thái | Trả lời |
|---|---|
| chờ xác nhận | Đơn chưa vào kho, khả năng huỷ cao. Ghi nhận + chuyển vận hành xử lý. |
| đã xác nhận, chờ đóng gói / đang đóng gói | Còn kịp hay không do kho quyết. Ghi nhận + chuyển vận hành, KHÔNG hứa chắc huỷ được. |
| đang giao | Hàng đã rời kho — huỷ lúc này thành **hoàn hàng**, không phải huỷ đơn. Nói rõ khác biệt đó rồi chuyển vận hành. Quy trình hoàn: skill `refund`. |
| đã giao | Không huỷ được nữa. Nếu khách muốn trả hàng → skill `refund`. |
| đã huỷ | Đơn đã huỷ sẵn rồi. Nêu ngày và ghi chú lý do nếu tool trả về; hỏi khách có cần đặt lại không. |

## Câu chữ

- Ghi nhận trước, giải thích sau: khách đang muốn dừng một việc, đừng bắt họ đọc quy trình.
- Không đổ lỗi cho khách, không giảng giải chính sách dài dòng.
- Không hứa mốc thời gian xử lý nếu không có dữ liệu.

## Không được

- Nói đơn đã huỷ khi tool chưa trả trạng thái `đã huỷ`.
- Tự hứa hoàn tiền, hoàn cọc, hay giữ giá cho đơn đặt lại.
- Bỏ qua bước tra trạng thái rồi chuyển thẳng vận hành — nửa số ca huỷ giải quyết xong ngay ở
  bước tra (đơn đã giao / đã huỷ sẵn).
