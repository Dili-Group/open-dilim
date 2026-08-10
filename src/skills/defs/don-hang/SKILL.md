---
name: don-hang
description: Xử lý mọi việc về đơn hàng của đại lý — tra trạng thái, liệt kê đơn theo ngày tạo, báo huỷ đơn, hỏi số tiền của đơn, xin video camera đóng gói. Load khi đại lý hoặc thành viên nhắc "đơn", "hàng", "giao", "huỷ", "thanh toán", "chuyển khoản", "nạp ví", "QR", "công nợ", "COD", "video", "camera", "mã vận đơn", "đơn hôm nay", "đơn ngày...".
agents: dealer
---

# Đơn hàng — đại lý

Năm việc khách hay hỏi, dùng chung 3 bước: **phân loại việc → chốt đơn nào → làm đúng phần được phép**.

| Khách muốn | Tool | Chi tiết |
|---|---|---|
| Đơn tới đâu rồi | `tra_don_hang` | `references/trang-thai.md` |
| Đơn hôm nay / trong khoảng ngày | `tra_don_hang` (`hom_nay`, `tu_ngay`/`den_ngay`) | mốc là NGÀY TẠO đơn — xem Bước 2 |
| Báo huỷ đơn | KHÔNG có tool ghi | `references/huy-don.md` |
| Tiền của đơn (tổng, COD, phí ship) | `tra_don_hang` (chi tiết đơn) | `references/thanh-toan.md` |
| Cần chuyển bao nhiêu để đơn được đi | `tra_tien_can_chuyen` | `references/thanh-toan.md` |
| Xin video camera đóng gói | `video_don_hang` | `references/video.md` |
| Hàng còn hay hết, đơn kẹt vì hết hàng | KHÔNG có tool tồn kho | skill `het-hang` |

Một tin nhắn có thể là **hai việc**: "Đơn A đi giúp chị nhé!" vừa hỏi trạng thái vừa giục. Trả lời
phần đọc được trước (trạng thái), rồi mới xử lý phần yêu cầu. Giọng giục rõ (đơn hoả tốc, khách
đang đợi, giục lại lần hai) → nạp thêm skill `giuc-don` để lấy cách trả lời từng khâu.

Hỏi kèm tồn kho ("đơn này đi được chưa, còn hàng không") → nạp thêm skill `het-hang`: agent không
tra được tồn kho, và đơn kẹt vì hết hàng có ba hướng xử lý riêng.

## Bước 1 — Chốt đơn nào, trước mọi thứ khác

Có mã vận đơn trong tin nhắn → truyền `ma_van_don` để lấy chi tiết. Không có mã (khách nói "đơn của
chị Lan", "đơn hôm qua") → gọi `tra_don_hang` với `tim_kiem` (tên hoặc SĐT khách nhận), hoặc gọi
trống để lấy đơn gần đây, rồi:

- Đúng 1 đơn khớp mô tả → nói rõ mình đang nói về đơn đó rồi trả lời luôn.
- Nhiều đơn có thể khớp → hỏi lại **đúng một câu**, kèm mã vận đơn + ngày tạo để khách chọn nhanh.
- Không đơn nào → nói thẳng chưa thấy đơn nào, hỏi mã vận đơn.

Không đoán bừa một mã. `video_don_hang` và `tra_tien_can_chuyen` **bắt buộc có mã vận đơn** — sai đơn
ở đây là đưa nhầm bằng chứng cho một vụ tranh chấp, hoặc để đại lý chuyển sai số tiền.

## Bước 2 — Lọc theo ngày, và cửa sổ 30 ngày

Khách hỏi cả **nhóm đơn theo ngày** ("hôm nay em lên mấy đơn", "đơn tuần này", "đơn ngày 8 sao
rồi") → `tra_don_hang` với `hom_nay: true`, hoặc `tu_ngay`/`den_ngay` dạng `dd/mm/yyyy`. Không tự
tính hôm nay là ngày mấy — cứ `hom_nay: true`, hệ thống chốt theo giờ Việt Nam.

Mốc ở đây là **NGÀY TẠO ĐƠN**, không phải ngày xuất kho. Đơn tạo hôm qua mà hôm nay mới xuất thì
KHÔNG nằm trong `hom_nay`. Khách hỏi "hôm nay xuất mấy đơn / hôm nay phải chuyển bao nhiêu" là
việc của sổ ngày (skill `bao-cao-cuoi-ngay`, tool `bao_cao_ngay`) — đừng trả bằng danh sách này.

Tool liệt kê tối đa 10 đơn nhưng có báo tổng. Còn dư thì nói rõ tổng bao nhiêu đơn và hỏi khách
muốn lọc thêm gì (trạng thái, tên khách), **đừng** gọi lặp để gom cho đủ rồi tự cộng.

Hệ thống chỉ tra được **đơn trong 30 ngày gần nhất**. Không thấy đơn thì nói là *không thấy đơn đó
của đại lý mình* và hỏi lại mã vận đơn — **đừng nói "đơn không tồn tại"**: có thể là đơn của đại lý
khác, hoặc đơn đã quá 30 ngày. Đơn cũ hơn → chuyển nhân viên vận hành tra giúp.

## Bước 3 — Ranh giới ĐỌC / GHI

Cả ba tool đều CHỈ ĐỌC. Agent **không** huỷ đơn, không sửa đơn, không đổi địa chỉ, không xác nhận
đã thanh toán, không hứa hoàn tiền. Mọi việc GHI: nói rõ sẽ chuyển nhân viên phụ trách, rồi dừng.

Chỉ nói dữ kiện tool trả về. Thiếu dữ liệu (chưa có ngày giao, chưa có video) → nói là chưa có,
không ước lượng hộ hệ thống. Tiền hiển thị đúng như tool trả (`1.234.567 ₫`), **không tự cộng trừ**,
không cộng dồn tiền giữa nhiều đơn.

## Bước 4 — Trả lời

Một tin, thứ tự: **kết quả → mốc thời gian / số tiền → việc kế tiếp**. Không lặp lại câu
"Dạ để em kiểm tra…" — hệ thống đã tự gửi câu đó ngay khi bạn gọi tool.

Chỉ nói về đơn của đại lý trong phòng này. Không nhắc mã đơn, số tiền hay tình trạng của đại lý khác.
