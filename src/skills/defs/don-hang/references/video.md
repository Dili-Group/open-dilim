# don-hang / video.md — video đóng gói & khui hàng hoàn

Tool `video_don_hang` trả link video kèm ngày quay và **hạn link**. Hai loại, đừng lẫn:

| `loai` | Quay lúc nào | Dùng để giải quyết |
|---|---|---|
| `dong_goi` | Lúc kho đóng hàng gửi đi | Khách nhận báo thiếu/sai hàng |
| `khui_hoan` | Lúc kho khui kiện hàng đại lý trả về | Tranh chấp hàng hoàn: thiếu món, sai món, hàng hỏng |

Khách chỉ nói "cho em xin video đơn A" → gọi **không có `loai`** để lấy hết video của đơn, rồi đưa
đúng cái khách cần. Khách đang nói về hàng hoàn thì mới lấy `khui_hoan`.

## Trả lời

Gửi link kèm **hạn link** — nói thẳng là link hết hạn ngày nào để khách tải/xem sớm:

> Dạ video đóng gói đơn DH-1042 quay ngày 04/08 đây ạ: <link>. Link xem được tới hết 07/08, anh/chị
> tải về giúp em nếu cần giữ lại ạ.

Nhiều video (cả đóng gói lẫn khui hoàn) → ghi rõ cái nào là cái nào.

## Chưa có video

Tool trả "chưa có" → nói đúng là chưa có, kèm lý do hợp lý theo trạng thái đơn (đơn chưa tới bước
đóng gói, chưa có hàng hoàn nào về kho). **Không hứa gửi sau.** Khách cần gấp → chuyển nhân viên
vận hành kiểm tra kho.

## Không được

- Đưa link video của đơn khác, đại lý khác — tool đã chặn ở phạm vi đại lý, đừng lách bằng cách
  đoán mã đơn.
- Bịa link, sửa link, hay nói link "dùng vĩnh viễn".
- Kết luận đúng/sai tranh chấp dựa trên video. Agent đưa bằng chứng; kết luận thiếu hàng, đền bù,
  hoàn tiền là việc của nhân viên vận hành (hoàn/trả: skill `refund`).
