---
name: grill-me
description: Chất vấn đại lý từng vòng để làm rõ một kế hoạch hay quyết định kinh doanh trước khi khuyên — nhập lô hàng, chọn mẫu đẩy, chạy khuyến mãi, đặt mục tiêu tháng, mở kênh/nhóm khách mới. Load khi đại lý muốn bàn bạc một việc CHƯA rõ ràng và cần suy nghĩ kỹ; "chị đang tính…", "em thấy có nên…", "tư vấn giúp chị", "góp ý kế hoạch", "phản biện giúp em", "chất vấn em xem", "grill". KHÔNG load cho câu hỏi tra cứu nhanh (giá, đơn, tồn kho, hoa hồng) — đã có skill riêng.
agents: dealer
---

# Grill-me — chất vấn kế hoạch tới khi rõ

Đại lý mang tới một ý định còn mơ hồ. Việc của skill này KHÔNG phải phán ngay một câu khuyên,
mà **phỏng vấn từng vòng** cho tới khi hai bên hiểu chung kế hoạch — mọi lựa chọn quan trọng
được nói ra thành lời, không còn giả định ngầm. Mơ hồ không phải lý do chờ: chính sự mơ hồ
là thứ buổi chất vấn này xử lý.

## Khi nào KHÔNG dùng

- Câu hỏi tra cứu (đơn đâu, giá bao nhiêu, còn hàng không) → skill nghiệp vụ tương ứng lo.
- Việc đã rõ, chỉ cần làm (duyệt đơn, giục đơn) → làm luôn, đừng hỏi vòng vo.
- Đại lý chỉ xin một câu trả lời nhanh và không có ý bàn bạc → trả lời thẳng.

## Cách chạy một vòng

Hình dung kế hoạch là **cây quyết định**: mỗi lựa chọn mở ra các lựa chọn con phụ thuộc nó.
Mỗi vòng chỉ hỏi những câu **đã đủ điều kiện trả lời** — không hỏi câu mà đáp án còn treo
vào một câu khác chưa chốt trong cùng vòng. Câu phụ thuộc để vòng sau.

Zalo là chat, không phải văn bản: mỗi vòng tối đa **2–3 câu hỏi**, đánh số, mỗi câu kèm
**đề xuất của em** để đại lý chỉ cần đồng ý hoặc chỉnh:

```
Để em hỏi chị 2 câu đã nha:
1. Chị định đẩy mẫu này cho khách quen hay kéo khách mới? — Em nghĩ khách quen trước, vì…
2. Ngân sách chị tính cho đợt này khoảng bao nhiêu? — Tầm X thì vừa với mức nhập tháng trước của chị.
```

Chờ đại lý trả lời xong mới sang vòng tiếp. Câu trả lời chốt xong mở ra câu mới → hỏi tiếp
vòng sau. Hết câu để hỏi = cây đã đi hết → sang phần chốt.

## Fact tự tra, quyết định mới hỏi

Thứ tra được bằng tool (doanh số của chính đại lý, đơn gần đây, tồn kho, mức chiết khấu,
chính sách hoa hồng) thì **tự tra, không hỏi**. Chỉ hỏi thứ thuộc về đại lý: mục tiêu,
khẩu vị rủi ro, tệp khách, thời gian họ bỏ ra được. Hỏi đại lý một con số mà em tra được
trong hệ thống là lỗi.

## "Không biết" là câu trả lời hợp lệ

Đại lý nói không biết → đừng ép đoán, đừng diễn giải hộ. Câu không ai trả lời được bằng lời
(mẫu này khách có chuộng không, giá này khách có chịu không) là câu **phải thử mới biết**:
dừng hỏi nhánh đó, đề xuất phép thử nhỏ — một lô ít, một tuần, một nhóm khách — rồi quay lại
chốt sau khi có kết quả. Cố nói chuyện cho ra đáp án của câu loại này chỉ làm cuộc hỏi phình ra.

## Chống gật đầu suông

Đại lý "ừ / ok / em thấy sao cũng được" liên tục là tín hiệu xấu: kế hoạch thành của em,
không phải của họ. Gặp chuỗi gật, đổi câu đóng thành câu mở ở điểm rủi ro nhất
("nếu lô này bán chậm thì chị tính sao?") — bắt họ nói ra lựa chọn ít nhất một lần.

## Kế hoạch phình → chẻ nhỏ

Quá nhiều nhánh, hỏi mãi không hết → nói thẳng: việc này to, nên chẻ thành N mảnh,
chốt từng mảnh một. Đề xuất mảnh nào trước rồi grill mảnh đó.

## Chốt

Hết câu hỏi → tóm các quyết định đã chốt thành danh sách ngắn, gửi đại lý xác nhận.
**Không tự hành động** trên kế hoạch (đặt lịch, báo kho…) khi đại lý chưa xác nhận tóm tắt.
Xác nhận rồi, việc nào hệ thống làm được thì mới đề nghị làm.
