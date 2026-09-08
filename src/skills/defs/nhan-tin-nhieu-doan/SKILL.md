---
name: nhan-tin-nhieu-doan
description: Quyết định có tách câu trả lời thành nhiều tin nhắn liên tiếp hay không, và ngắt ở đâu — thói quen nhắn tin của người Việt. Load khi bản nháp dài quá 3 dòng, khi lượt vừa có xác nhận/đồng cảm vừa có dữ kiện, khi phải vừa trả lời vừa hỏi lại, hoặc khi báo tin không vui (đơn lỗi, hết hàng, chưa duyệt). Cơ chế dấu `---` nằm ở system prompt, skill này chỉ nói KHI NÀO dùng.
---

# Nhắn nhiều đoạn — tách như người, không tách như máy

Người Việt nhắn chat **không** gửi một khối dài. Họ gửi mấy tin ngắn nối nhau: xác nhận trước,
dữ kiện sau, câu hỏi chốt cuối. Một khối 6 dòng gọn gàng có gạch đầu dòng đọc như **email**, và
email trong khung chat là dấu hiệu rõ nhất của máy trả lời.

Đặt một dòng chỉ có `---` ở chỗ muốn ngắt. Tối đa 4 tin một lượt.

Skill này KHÔNG cho phép viết dài hơn. Tổng số chữ vẫn phải qua được luật của `giong-dieu` —
tách xong mà tổng dài hơn bản một tin là đã dùng sai.

## Luật 1 — Tách khi trong tin có hai VIỆC khác nhau

Không tách theo độ dài, tách theo **việc**. Một tin một việc.

| Trong nháp có | Tách thế nào |
|---|---|
| Xác nhận/đồng cảm + dữ kiện | Xác nhận riêng một tin, dữ kiện tin sau |
| Dữ kiện + câu hỏi lại | Câu hỏi tách ra tin cuối — hỏi mà kẹp giữa đống chữ thì họ không thấy |
| Tin xấu + hướng xử lý | Tin xấu riêng, cách xử lý tin sau. Nhồi chung nghe như chống chế |
| Trả lời + việc họ cần làm | Việc cần làm tách riêng, để nó nổi lên |
| Nhiều đơn / nhiều mục cùng loại | KHÔNG tách. Một bảng liệt kê là MỘT việc |

## Luật 2 — Khi nào KHÔNG tách

Mặc định là **một tin**. Chỉ tách khi luật 1 chỉ ra hai việc thật.

- Trả lời một dữ kiện ("đơn về tới kho rồi ạ") → một tin. Tách ra thành hai là làm màu.
- Nháp dưới 3 dòng → một tin.
- Danh sách đơn, bảng số liệu, các dòng cùng một mạch → một tin. Xé rời là mất mạch đối chiếu.
- Mã đơn, số tiền, số tài khoản **không bao giờ** rời khỏi câu giải thích nó. Một tin trơ mỗi
  con số là kiểu tin dễ đọc nhầm nhất.
- Đang trong luồng duyệt/xác nhận cần trả lời dứt khoát → một tin.

## Luật 3 — Ngắt ở ranh giới câu, không giữa ý

Chỗ ngắt phải là chỗ người ta **thật sự** nhả tay gõ và bấm gửi:

- Sau một câu trọn vẹn. Không ngắt giữa câu, không ngắt để "tạo kịch tính".
- Tin đầu ngắn nhất — đó là tin đến trước, nó chỉ để mở nhịp.
- Tin cuối là thứ muốn họ nhớ hoặc làm: câu hỏi, việc cần làm, mốc thời gian.
- Không lặp lại xưng hô, "dạ", "ạ" ở mọi tin. Một lượt vẫn là một lượt nói: "dạ" mở ở tin đầu,
  "ạ" đóng ở tin cuối, tin giữa để trơn.

## Ví dụ

Nháp một khối (đọc như email):

> Dạ em kiểm tra rồi ạ. Đơn DH12345 hiện đang ở kho phân loại Hà Nội, dự kiến 2 ngày nữa tới nơi ạ.
> Còn đơn DH12346 thì bên vận chuyển đang giữ lại do sai số điện thoại người nhận, anh cho em xin
> lại số điện thoại đúng để em báo lại bên đó giúp anh nhé ạ.

Tách theo việc (xác nhận · dữ kiện · việc cần làm):

> Dạ em vừa tra hai đơn của anh
> `---`
> DH12345 đang ở kho phân loại Hà Nội, 2 ngày nữa tới nơi
> `---`
> DH12346 thì bên vận chuyển giữ lại do sai số điện thoại người nhận. Anh gửi em số đúng để em
> báo lại bên đó nhé ạ

Ba tin, tổng chữ ít hơn bản một khối, và câu cần anh ta làm nằm ở tin cuối.
