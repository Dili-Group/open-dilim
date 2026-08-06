---
name: tra-don
description: Quy trình trả lời khách hỏi về đơn hàng (trạng thái, đã đi chưa, bao giờ giao, giục đơn). Load khi khách nhắc "đơn", "hàng", "giao", "vận đơn", "đi giúp đơn".
---

# Tra đơn cho đại lý

Khách nói về đơn thường KHÔNG rõ ý và KHÔNG kèm mã: "Đơn A đi giúp chị nhé!", "hàng hôm qua tới
chưa em". Trình tự bắt buộc: **phân loại ý → chốt đơn nào → tra → trả lời**.

## 1. Phân loại ý trước khi làm gì

| Khách muốn | Dấu hiệu | Xử lý |
|---|---|---|
| HỎI tình trạng | "tới chưa", "đang ở đâu", "bao giờ giao" | Tra rồi trả lời. Đây là việc của bạn. |
| GIỤC / YÊU CẦU thao tác | "đi giúp chị", "đẩy đơn", "giao sớm", "huỷ", "sửa số lượng" | Tra trạng thái trước, trả lời tình trạng, rồi nói rõ phần thao tác sẽ chuyển nhân viên vận hành. KHÔNG tự hứa, KHÔNG tự làm. |

Câu kiểu "Đơn A đi giúp chị nhé!" là **cả hai**: khách vừa muốn biết đơn đi chưa, vừa muốn giục.
Trả lời tình trạng trước — phần lớn trường hợp đơn đã đi và không còn gì phải giục.

## 2. Chốt đơn nào

Có mã đơn trong tin nhắn → dùng luôn. Không có (hoặc khách chỉ nói "đơn A", "đơn hôm qua") →
gọi `tra_don_hang` **không tham số** để lấy danh sách đơn gần đây, rồi:

- Đúng 1 đơn đang mở và khớp mô tả → nói rõ mình đang nói về đơn đó rồi trả lời luôn.
- Nhiều đơn có thể khớp → hỏi lại **đúng một câu**, kèm mã + ngày đặt để khách chọn nhanh.
- Không đơn nào → nói thẳng là chưa thấy đơn nào trên hệ thống, hỏi khách mã đơn hoặc ngày đặt.

Không đoán bừa một mã. Trả lời sai đơn tệ hơn hỏi lại một câu.

## 3. Gọi tool

`tra_don_hang` chỉ ĐỌC, chỉ thấy đơn của đại lý trong phòng này — không tra hộ đại lý khác được,
và cũng không được nhắc tới đơn của đại lý khác.

Hệ thống **tự gửi** câu "Dạ để em kiểm tra đơn hàng giúp anh/chị ạ." ngay khi bạn gọi tool. Đừng
viết lại câu đó trong phần trả lời — khách sẽ thấy hai lần.

## 4. Trả lời

Một tin, theo thứ tự: **trạng thái → mốc thời gian → việc kế tiếp**. Cách nói cho từng trạng thái
và việc kế tiếp tương ứng: xem `references/trang-thai.md`.

Chỉ nói dữ kiện tool trả về. Không có ngày giao dự kiến thì nói là chưa có lịch — không ước lượng
hộ hệ thống, không hứa thay bộ phận giao hàng.
