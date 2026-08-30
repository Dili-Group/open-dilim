# don-hang / video.md — video camera của đơn

Tool `video_don_hang` trả link video camera của từng **lần quét** đơn, kèm thời điểm quét và
**giờ hết hạn**. Bắt buộc có `ma_van_don`.

## Hai loại video — gửi đúng loại khách xin

Cột `loai` trong kết quả phân biệt hai loại:

- **đóng gói** — kho quay lúc soạn/đóng gói hàng xuất đi.
- **khui hàng hoàn** — kho quay lúc nhận và khui kiện hàng khách hoàn về.

Luật chọn:

- Xin **chung chung** ("cho xin video đơn này") → gửi **tất cả** link có, ghi rõ từng link là loại
  gì để khách khỏi nhầm.
- Xin **video đóng gói** / "lúc soạn hàng" → chỉ gửi link `loai` đóng gói.
- Xin **video hàng hoàn** / "khui hàng hoàn" / "lúc nhập hoàn" → chỉ gửi link `loai` khui hàng hoàn.
- Khách xin một loại mà đơn chỉ có loại kia → nói rõ chưa có loại đó (ví dụ đơn hoàn chưa về kho
  thì chưa có video khui hoàn), đừng gửi tạm loại còn lại như thể là thứ khách xin.
- Cột `loai` rỗng (dữ liệu cũ) → không rõ loại: gửi kèm thời điểm quét và nói đây là video lần quét
  đó, đừng tự dán nhãn đóng gói hay hàng hoàn.

## Link sống 15 phút

Đây là ràng buộc quan trọng nhất của việc này:

- Gọi tool **ngay lúc chuẩn bị gửi** link cho khách. Không gọi trước rồi để đó nói chuyện khác.
- **Không gửi lại link cũ** đã có trong lịch sử chat — link đó chắc chắn đã chết.
- Khách xin lại sau vài phút → gọi tool lần nữa lấy link mới, đừng dán lại link cũ.
- Luôn kèm câu "link có hiệu lực 15 phút" để khách bấm ngay.

> Video đóng gói đơn VTP0093412 đây ạ: <link>. Link có hiệu lực 15 phút thôi, anh/chị mở giúp em
> ngay nhé.

Nhiều lần quét → gửi kèm loại video + thời điểm quét của từng link để khách biết cái nào là cái nào.

## Chưa có video

Tool trả "chưa có video" → nói đúng là chưa có, kèm lý do hợp lý theo trạng thái đơn (đơn chưa tới
bước soạn/đóng gói, lần quét đó không gắn camera). **Không hứa gửi sau.** Khách cần gấp → chuyển
nhân viên vận hành kiểm tra kho.

## Không được

- Đưa link video của đơn khác, đại lý khác — tool đã chặn ở phạm vi đại lý, đừng lách bằng cách
  đoán mã vận đơn.
- Bịa link, sửa link, hay nói link "dùng vĩnh viễn" / "xem lại lúc nào cũng được".
- Kết luận đúng/sai tranh chấp dựa trên video. Agent đưa bằng chứng; kết luận thiếu hàng, đền bù,
  hoàn tiền là việc của nhân viên vận hành (hoàn/trả: skill `refund`).
