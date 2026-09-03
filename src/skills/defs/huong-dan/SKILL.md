---
name: huong-dan
description: Chỉ đại lý CÁCH LÀM và cấp link tài liệu chính thức — quên mật khẩu / đăng nhập app, ký hợp đồng, đăng ký MST hộ kinh doanh, ký rules hệ thống, lấy API Key và gắn webhook PosCake (Pancake POS) để đơn tự về hệ thống, tích hợp app giao hàng cá nhân (Viettel Post), cách tạo đơn trên app, quy trình thanh toán - COD - hoá đơn, giờ shipper lấy hàng, địa chỉ kho, bảng giá niêm yết, drive tài liệu, group cộng đồng, ai phụ trách việc gì (trùng đơn, bán sai giá, đăng ký sale mới, khiếu nại - vi phạm Rule). Load khi đại lý hỏi "làm sao", "cách nào", "hướng dẫn", "link ở đâu", "chưa biết làm", "quên mật khẩu", "đăng ký ở đâu", "API key", "webhook", "poscake", "pancake", "liên hệ ai", "ai phụ trách", "trùng đơn", "khiếu nại", "đăng ký sale".
agents: dealer
---

# Hướng dẫn đại lý — chỉ cách làm, đưa link chuẩn

Skill này trả lời **"làm thế nào"** và **"link ở đâu"**. Nó KHÔNG tra dữ liệu của đại lý (đơn nào,
tiền bao nhiêu, bậc nào) — việc đó ở skill khác.

## Bước 1 — Chọn đúng reference, đọc đúng một file

| Đại lý hỏi | Đọc |
|---|---|
| Quên mật khẩu, không đăng nhập được, không nhớ email đăng ký | `references/mat-khau.md` |
| Ký hợp đồng ở đâu, MST hộ kinh doanh, quy định chiết khấu là gì | `references/gia-nhap.md` |
| Rules hệ thống, form rule, nộp bản scan, khai page/shop | `references/rules-he-thong.md` |
| PosCake / Pancake POS: lấy API Key, Shop ID, gắn webhook để đơn tự về hệ thống — và **nạp** tài khoản đó vào hệ thống (`nap_poscake`) | `references/poscake.md` |
| Tích hợp app giao hàng cá nhân / Viettel Post với hệ thống, tích hợp để làm gì | `references/tich-hop-van-chuyen.md` |
| Tạo đơn trên hệ thống thế nào, điền ô nào, ghi tên hàng ra sao | `references/tao-don.md` |
| Lên đơn xong trả tiền kiểu gì, COD về khi nào, hoá đơn ra sao | `references/thanh-toan-cod.md` |
| Mấy giờ shipper lấy hàng, kho ở đâu | `references/kho-lay-hang.md` |
| Bảng giá niêm yết, drive tài liệu, vào group nào | `references/tai-lieu-group.md` |
| Trùng đơn, bán sai giá, đăng ký đại lý/sale mới, check khách theo Rule, khiếu nại / vi phạm Rule — **liên hệ ai** | `references/nhan-su-phu-trach.md` |

Hỏi hai việc trong một tin → đọc đủ hai file, trả lời gộp một tin, đừng bắt đại lý hỏi lại.

## Bước 2 — Việc KHÔNG thuộc skill này

| Đại lý hỏi | Nạp skill |
|---|---|
| Đơn CỦA HỌ tới đâu, tiền của đơn, huỷ đơn, xin video đóng gói | `don-hang` |
| Bậc chiết khấu hiện tại, nâng bậc | `chiet-khau` |
| Còn hàng không, đơn kẹt vì hết hàng | `het-hang` |
| Giục đơn đi nhanh | `giuc-don` |

Đây là ranh giới **hướng dẫn** (quy trình chung, ai cũng như nhau) với **tra cứu** (dữ liệu riêng
của đại lý này). Hỏi "lên đơn thế nào" là hướng dẫn; hỏi "đơn tôi lên hôm qua đi chưa" là tra cứu.

## Link chuẩn — chép nguyên văn, không rút gọn, không tự chế

Reference bên dưới gọi link theo **tên trong bảng này**, không chép URL. Cần link nào thì lấy đúng
dòng đó.

| Tên | Link |
|---|---|
| Hệ thống DiLiM | https://app.dilisupplement.com |
| Đăng nhập hệ thống | https://app.dilisupplement.com/login |
| Form ký hợp đồng | https://dangky.dilisupplement.com |
| Quy định mức chiết khấu | https://drive.google.com/file/d/14vaDnu_81ayjXboVL3pfK2qCbYTf9Jhs/view |
| Video đăng ký MST hộ kinh doanh | https://www.youtube.com/watch?v=lmc32PY6v0I |
| Form Rule hệ thống | https://sale.dilisupplement.com/register |
| Sheet khai page/shop | https://docs.google.com/spreadsheets/d/1RhkM9s0_anieohKKQ23OGpQfaX31yHr-ia5N97xZX9k/edit?usp=sharing |
| PosCake (Pancake POS) | https://pos.pages.fm |
| Video tạo tài khoản Viettel Post (1) | https://www.youtube.com/watch?v=n06g7lAh_9I |
| Video tạo tài khoản Viettel Post (2) | https://youtu.be/B7xywuTDGUc |
| Video tích hợp với Hệ thống DiLiM | https://youtu.be/yq1fH-tmzYs?list=PLhrRBPvwjwrXYm3IYiefWFgSZL-ypNtXa&t=167 |
| Bảng giá niêm yết | https://docs.google.com/spreadsheets/d/16fPI2XwRYaVfALeo_atx9zxxZDASzQLUV4RFZlpHpWA/edit?gid=1114013565#gid=1114013565 |
| Drive tài liệu tổng | https://drive.google.com/drive/u/0/folders/1FvTZlP-LXfqB23vwP84IoZmBnQvlG2N6 |
| Trang hướng dẫn đại lý (bản đầy đủ) | https://dilim-guide-docs.solitary-rice-590b.workers.dev |
| Văn bản phân công nhân sự | https://drive.google.com/file/d/11EpZt-du-wM8XigcWntfsKPyfjdMUxkB/view |

**Webhook URL nhận đơn PosCake KHÔNG có trong bảng này** — vận hành cấp riêng cho từng đại lý. Agent
không tự ghép, không đoán; đại lý cần thì chuyển Nhóm Hỗ trợ.

## Luật chung — áp cho mọi hướng dẫn

1. **Gửi trọn một lần.** Đủ các bước + link trong MỘT tin. Không nhỏ giọt từng bước rồi bắt hỏi tiếp.
2. **Chỉ gửi link trong bảng trên.** Việc không có link → nói thẳng là chưa có link cho việc đó rồi
   chuyển Nhóm Hỗ trợ. **Không đoán URL**, không rút gọn, không đổi domain.
3. **Agent không làm hộ.** Không ký hộ hợp đồng, không nộp form hộ, không tích hợp hộ tài khoản vận
   chuyển, không đăng nhập hộ, không duyệt group. Nói rõ đại lý tự làm hay ai làm.
4. **Số liệu chép đúng.** Giờ lấy hàng, địa chỉ kho, số điện thoại — chép nguyên, không làm tròn,
   không diễn giải lại.
5. **Việc cần người xác nhận** (nộp rules, duyệt vào group riêng, tích hợp tài khoản vận chuyển) →
   đề nghị đại lý nhắn **Nhóm Hỗ trợ**. Riêng việc đã có **người phụ trách đích danh** (trùng đơn,
   sai giá, đăng ký sale mới, Rule) → chỉ thẳng người đó theo `references/nhan-su-phu-trach.md`.
6. Đại lý hỏi lại lần hai → **không lặp nguyên tin cũ**. Thêm dữ kiện mới, hoặc chuyển Nhóm Hỗ trợ.

## DILIM hỗ trợ đại lý những gì

Hỏi chung chung ("công ty hỗ trợ gì", "vào hệ thống được gì") thì trả lời sáu điểm này:

- Marketing thương hiệu cá nhân — bộ Video / Hình ảnh / Content có sẵn để chạy quảng cáo
- Đóng gói hàng hoá và giao cho đơn vị vận chuyển
- Tiếp nhận và xử lý toàn bộ đơn hoàn về
- Đối soát dòng tiền và công nợ theo kỳ
- Đào tạo nội bộ định kỳ tuần / tháng / năm
- Đồng hành vận hành ổn định

Kèm **điều kiện**: hỗ trợ đầy đủ khi đại lý làm đúng rules và quy trình hệ thống.
