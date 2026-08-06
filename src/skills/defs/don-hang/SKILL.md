---
name: don-hang
description: Xử lý mọi việc về đơn hàng của đại lý — tra trạng thái, báo huỷ đơn, hỏi số tiền phải trả, xin video đóng gói / khui hàng hoàn. Load khi đại lý hoặc thành viên nhắc "đơn", "hàng", "giao", "huỷ", "thanh toán", "công nợ", "video", "camera".
---

# Đơn hàng — đại lý

Bốn việc khách hay hỏi, dùng chung 3 bước: **phân loại việc → chốt đơn nào → làm đúng phần được phép**.

| Khách muốn | Tool | Chi tiết |
|---|---|---|
| Đơn tới đâu rồi | `tra_don_hang` | `references/trang-thai.md` |
| Báo huỷ đơn | KHÔNG có tool ghi | `references/huy-don.md` |
| Còn phải trả bao nhiêu | `tra_thanh_toan_don` | `references/thanh-toan.md` |
| Xin video đóng gói / khui hàng hoàn | `video_don_hang` | `references/video.md` |

Một tin nhắn có thể là **hai việc**: "Đơn A đi giúp chị nhé!" vừa hỏi trạng thái vừa giục. Trả lời
phần đọc được trước (trạng thái), rồi mới xử lý phần yêu cầu.

## Bước 1 — Chốt đơn nào, trước mọi thứ khác

Có mã đơn trong tin nhắn → dùng luôn. Không có (khách nói "đơn A", "đơn hôm qua") → gọi
`tra_don_hang` **không tham số** để lấy danh sách đơn gần đây, rồi:

- Đúng 1 đơn khớp mô tả → nói rõ mình đang nói về đơn đó rồi trả lời luôn.
- Nhiều đơn có thể khớp → hỏi lại **đúng một câu**, kèm mã + ngày đặt để khách chọn nhanh.
- Không đơn nào → nói thẳng chưa thấy đơn nào, hỏi mã đơn hoặc ngày đặt.

Không đoán bừa một mã. `tra_thanh_toan_don` và `video_don_hang` **bắt buộc có mã** — sai đơn ở hai
việc này là sai số tiền và sai bằng chứng tranh chấp.

## Bước 2 — Ranh giới ĐỌC / GHI

Cả ba tool đều CHỈ ĐỌC. Agent **không** huỷ đơn, không sửa đơn, không xác nhận đã thanh toán,
không hứa hoàn tiền. Mọi việc GHI: nói rõ sẽ chuyển nhân viên vận hành, rồi dừng ở đó.

Chỉ nói dữ kiện tool trả về. Thiếu dữ liệu (chưa có ngày giao, chưa có video) → nói là chưa có,
không ước lượng hộ hệ thống.

## Bước 3 — Trả lời

Một tin, thứ tự: **kết quả → mốc thời gian / số tiền → việc kế tiếp**. Không lặp lại câu
"Dạ để em kiểm tra…" — hệ thống đã tự gửi câu đó ngay khi bạn gọi tool.

Chỉ nói về đơn của đại lý trong phòng này. Không nhắc mã đơn, số tiền hay tình trạng của đại lý khác.
