# don-hang / trang-thai.md — nói gì cho từng trạng thái đơn

`tra_don_hang` trả nhãn tiếng Việt sẵn. Bảng này là **việc kế tiếp** đi kèm mỗi nhãn — phần khách
thật sự cần, ngoài chữ trạng thái. Nhãn lạ (tool in "mã 42") = trạng thái nội bộ mới: nói là đơn
đang ở một bước xử lý nội bộ và chuyển nhân viên vận hành, đừng đoán nghĩa.

| Nhãn tool trả | Nói với khách | Việc kế tiếp |
|---|---|---|
| đơn hàng mới / đã kiểm duyệt | Đơn đã nhận, đang chờ kho xử lý | Nêu ngày tạo. Khách giục → nói sẽ báo vận hành đẩy nhanh, không hứa giờ cụ thể |
| đang soạn hàng / đã soạn xong | Kho đang chuẩn bị hàng | Nêu ngày tạo + đơn vị vận chuyển nếu có |
| đã quét xuất kho, chờ bàn giao ĐVVC / đã bàn giao ĐVVC | Hàng đã rời kho, chờ ĐVVC lấy | Nêu ĐVVC + mã vận đơn |
| đang vận chuyển | Hàng đang trên đường | Nêu ĐVVC + mã vận đơn. Đây là câu trả lời cho "đơn đi chưa" |
| giao thành công | Đã giao xong | Nêu ngày cập nhật. Khách nói chưa nhận → không cãi, ghi nhận và chuyển vận hành đối chiếu |
| giao một phần | Khách chỉ nhận một phần kiện hàng | Nêu phần còn lại đang hoàn. Chuyển vận hành đối chiếu số lượng |
| chờ đại lý chuyển tiền / đại lý đã chuyển tiền | Đơn đang ở khâu tiền | Đơn đang chờ tiền → gọi `tra_tien_can_chuyen` đưa luôn số cần chuyển + khối chuyển khoản. KHÔNG tự xác nhận đã nhận tiền (xem `thanh-toan.md`) |
| đang hoàn một phần / đã hoàn một phần (chờ kiểm tra) / đã kiểm tra hàng hoàn | Hàng đang quay về kho | Quy trình hoàn: skill `refund`. Không kết luận đền bù |
| đang hoàn hàng / hoàn thành công tại ĐVVC / hoàn thành công tại kho | Hàng đã/đang hoàn về | Nêu mốc gần nhất trong lịch sử trạng thái. Chuyển vận hành nếu khách hỏi tiền hoàn |
| đã huỷ | Đơn đã huỷ | Nêu ghi chú lý do nếu tool trả về. Không tự suy diễn lý do. Khách muốn đặt lại → hướng dẫn đặt đơn mới |
| bản nháp / đã tạo lại | Đơn chưa vào luồng xử lý bình thường | Nói rõ đơn chưa chốt, chuyển nhân viên phụ trách xác nhận |

Chi tiết đơn còn kèm **lịch sử trạng thái** (mốc chuyển + người thao tác). Dùng nó khi khách hỏi
"đơn nằm ở đó từ bao giờ" — nêu mốc gần nhất, đừng đọc cả danh sách.

## Khách giục ("đi giúp chị nhé", "giao sớm giúp em")

Trả lời trạng thái thật trước, rồi:

- Đơn **đang vận chuyển / giao thành công** → không còn gì để giục: đưa mã vận đơn và ĐVVC.
- Đơn **mới / đang soạn hàng** → ghi nhận yêu cầu, nói rõ sẽ chuyển vận hành. Không cam kết thời gian.
- Đơn **đã huỷ** → nói rõ đơn đã huỷ, hỏi khách có đặt lại không. Không tự khôi phục đơn.

## Không được

- Bịa trạng thái, bịa ngày giao, bịa mã vận đơn khi tool không trả về.
- Nói "đơn không tồn tại" khi tool báo không thấy — chỉ nói là không thấy đơn đó của đại lý mình,
  và nhắc cửa sổ tra cứu 30 ngày.
- Nhắc đơn / số liệu của đại lý khác.
- Tự xác nhận, tự huỷ, tự sửa đơn — mọi thao tác GHI đều qua nhân viên vận hành.
