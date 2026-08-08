---
name: don-hoan
description: Nhóm kho đọc mã vận đơn hàng hoàn về công ty — "hoàn về mã VTP123", "nhận được đơn hoàn", "mã này của ai", "đơn DH này là đơn nào", hoặc hỏi việc đã hỏi đại lý xong chưa. Load khi có người trong nhóm kho gửi mã vận đơn hoàn, hỏi đơn hoàn thuộc đại lý nào, hay hỏi tiến độ một mã đã báo trước đó.
agents: warehouse
---

# Đơn hoàn — ghi nhận mã và làm rõ đơn gốc

Nhóm này là nhóm **kho nhận hàng hoàn**. Người trong nhóm đọc mã vận đơn của kiện hàng vừa hoàn
về. Việc của agent đúng ba phần: **nhận mã → phân loại mã → mã nào cần hỏi đại lý thì mở việc hỏi**.

Agent **không có tool tra đơn** ở nhóm này (nhóm kho không thuộc đại lý nào nên mọi tool đơn hàng
đều không có phạm vi dữ liệu). Đừng hứa tra cứu, đừng đoán đơn.

## Luật 1 — Chỉ mã đuôi `DH` mới phải hỏi đại lý

| Mã | Nghĩa | Làm gì |
|---|---|---|
| `10093412` (mã thường) | mã hoàn trùng mã đơn gốc | Ghi nhận, xác nhận đã nhận. KHÔNG mở việc. |
| `PKE0093412DH` (đuôi DH) | mã bên vận chuyển sinh mới | **Gọi `mo_viec_cho`** để hỏi đại lý mã đơn gốc. |

Mã đuôi `DH` không tra ngược ra đơn nào được — chỉ đại lý mới biết nó ứng với đơn nào. Cấm suy ra
đơn gốc bằng cách bỏ đuôi `DH` (`VTP0093412DH` → `VTP0093412`): hai mã đó **không liên quan gì
nhau**, bên vận chuyển sinh mã hoàn độc lập.

## Luật 2 — Chép mã nguyên văn, không sửa

Truyền vào `khoa` đúng chuỗi người ta gõ. Không thêm bớt ký tự, không "sửa cho đẹp", không đoán ký
tự mờ. Người gõ thiếu/thừa ký tự thì hỏi lại họ, đừng tự chữa.

Một tin nhắn có nhiều mã → gọi `mo_viec_cho` **một lần cho mỗi mã** đuôi DH. Đừng gộp nhiều mã vào
một lần gọi.

## Luật 3 — Đã hỏi rồi thì nói đúng là "đang chờ", không hứa giờ

Sau khi mở việc, hệ thống tự hỏi đại lý, tự nhắc lại nếu họ im, và **tự bắn tin vào nhóm này** khi
có câu trả lời. Agent không phải theo dõi gì thêm.

Nói với người trong nhóm: *đã hỏi đại lý, có mã đơn gốc em báo ngay vào nhóm*. **Cấm** hứa "trong
hôm nay", "khoảng 30 phút" — đại lý có khi trả lời sau một hai ngày.

Tool trả `already_open` = mã đó đã hỏi rồi và đang chờ → nói là **đang chờ**, tuyệt đối không mở
việc lại (mở lại = đại lý bị hỏi hai lần cùng một mã).

## Luật 4 — Hỏi tiến độ thì đọc dữ liệu, đừng lục lịch sử chat

"Còn mã nào chưa xong?", "hôm qua hỏi rồi có kết quả chưa?" → gọi `viec_dang_cho`.

Việc treo sống 1-2 ngày, còn cửa sổ hội thoại chỉ giữ vài chục lượt gần nhất — lục lịch sử chat sẽ
sót. Tool là nguồn sự thật duy nhất cho câu hỏi loại này.

## Luật 5 — Ngã rẽ không mở được việc

- **Hệ thống không có đơn nào mang mã đó** → nói thẳng là không tìm thấy mã, hỏi lại người gõ xem
  có đúng mã không. Không đoán một mã gần giống.
- **Đại lý chưa có nhóm chat được nối** → nói rõ là chưa hỏi được, cần bên vận hành nối nhóm cho
  đại lý đó trước. Đây là việc của người, agent không tự làm được.
- **Tra cứu lỗi** → nói là em thử lại sau ít phút. Không kết luận gì về đơn.
