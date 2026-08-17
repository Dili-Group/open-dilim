---
name: chinh-sach-hoa-hong
description: Đại lý hỏi về Chính sách hoa hồng & phát triển hệ thống (bản mới thay thế 001/CS-DLS.KT, hiệu lực 26/08/2026) — "doanh thu xét thưởng là gì", "doanh số nhóm / gộp nhóm là gì", "Leader là gì", "tách nhánh", "mở khóa tầng F1 F2 F3 cần gì", "hoa hồng lãnh đạo bao nhiêu một sản phẩm", "duy trì tầng", "auto unlock 500 triệu", "hoán đổi F1 F2", "ân hạn", "bị khóa lấy lại hệ thống", "bao giờ được trả hoa hồng", "chốt sổ ngày 25", "đối soát ngày 06 16 26", "trả hàng có bị trừ hoa hồng không", "vợ chồng cùng tuyến", "trừ thuế TNCN". Load khi tin nhắn nhắc chính sách hoa hồng / chính sách 001 / chính sách mới / hoa hồng lãnh đạo / Leader / doanh số nhóm / tầng / F1 F2 F3 / mở khóa / duy trì / đối soát / kỳ chốt sổ / doanh thu xét thưởng.
agents: dealer
---

# Chính sách hoa hồng & phát triển hệ thống — bản thay thế 001/CS-DLS.KT

Văn bản gốc: Công ty CP DiLi Supplement, **hiệu lực 26/08/2026**, **thay thế thông báo số
001/CS-DLS.KT** (Điều 18). Đại lý vẫn quen gọi "chính sách 001" — hiểu là đang hỏi chính sách này.
Khi khác với thỏa thuận/thông báo ban hành trước đó về cùng nội dung, chính sách này ưu tiên áp
dụng (Điều 2).

Video giải thích chính sách mới: https://youtu.be/2CDjils_jco — đại lý hỏi về chính sách hoa hồng
mới thì gửi kèm link này để họ xem giải thích đầy đủ.

Chính sách này chia làm hai dòng tiền hoàn toàn khác nhau, đại lý rất hay gộp làm một:

| Dòng tiền | Bản chất | Tính trên | Chi tiết |
|---|---|---|---|
| **Chiết khấu bán lẻ** | giảm giá lúc lấy hàng | % trên doanh thu tích lũy cá nhân | `references/chiet-khau-001.md` |
| **Hoa hồng lãnh đạo** | tiền công ty trả về tài khoản | số tiền CỐ ĐỊNH trên mỗi sản phẩm tuyến dưới bán | `references/tang-va-hoa-hong.md` |

Đại lý hỏi "em được bao nhiêu %" mà đang nói chuyện tuyến dưới → đang nhầm hai dòng này. Hoa hồng
lãnh đạo **không có phần trăm**.

## Luật 1 — Ngày 26/08/2026 là ranh giới, đừng trả lời trước mốc bằng bảng sau mốc

Chính sách này chỉ áp **từ 26/08/2026**. Đơn và kỳ trước mốc đó vẫn theo văn bản cũ — bảng chiết
khấu cũ nằm ở skill `chiet-khau`.

Đại lý hỏi chuyện đang xảy ra hôm nay mà hôm nay còn trước 26/08 → trả lời theo bảng cũ, và nói
thêm là từ 26/08 có chính sách mới. Đừng hứa mức mới cho đơn hiện tại.

**Đại lý đã hợp tác trước 26/08/2026 thì GIỮ NGUYÊN mức chiết khấu đã ký** (Điều 7, ghi chú). Bảng
tích lũy mới không tự động kéo mức của họ xuống 30%. Đại lý cũ hỏi "vậy em có bị tính lại từ đầu
không" → trả lời: theo văn bản thì giữ nguyên mức đã ký, phần áp dụng cụ thể cho từng mã số do vận
hành xác nhận.

## Luật 2 — Doanh thu xét thưởng KHÔNG phải doanh số bán lẻ, và agent không tra được

Doanh thu xét thưởng = **số tiền DiLiM thực thu** từ đơn đã giao thành công và thanh toán đủ 100%,
sau khi trừ giảm giá/khuyến mãi. Bán 1.290.000 mà công ty thực thu 645.000 thì doanh thu xét thưởng
là 645.000 — không phải 1.290.000.

Đây là căn cứ **duy nhất** cho mọi mốc: chiết khấu, hoa hồng lãnh đạo, mở khóa và duy trì tầng.

Agent **không có** con số này. Không cộng tiền trong `tra_don_hang` để ước lượng — danh sách đó là
30 ngày gần nhất, gồm cả đơn chưa giao/chưa thu đủ, không phải kỳ đối soát. Đại lý hỏi "em đủ mốc
chưa" → nêu ngưỡng để họ tự ước, rồi chuyển kế toán đối soát. Chi tiết:
`references/doanh-thu-xet-thuong.md`.

## Luật 3 — Doanh số CÁ NHÂN và doanh số NHÓM là hai con số khác nhau, hỏi rõ đang nói cái nào

Chính sách mới xét mọi điều kiện tầng theo **doanh số nhóm (Group)** — tổng doanh số của đại lý
CỘNG toàn bộ tuyến dưới **chưa** thành Leader, gộp không giới hạn tầng sâu cho tới khi gặp một
nhánh đã tách thành Leader (Điều 5). Trong doanh số nhóm đó luôn có yêu cầu **tối thiểu 30 triệu/
tháng là doanh số cá nhân** của chính đại lý.

- Chiết khấu bán lẻ → xét doanh thu **cá nhân** tích lũy.
- Mở khóa / duy trì / auto unlock tầng → xét doanh số **nhóm** + sàn 30 triệu cá nhân.

Thành viên tuyến dưới thành Leader thì doanh số nhánh đó **tách khỏi** nhóm của cấp trên — từ đó
cấp trên nhận hoa hồng lãnh đạo từ nhánh đó thay vì cộng gộp doanh số. Chi tiết cơ chế gộp, tách
nhánh, danh hiệu Leader: `references/leader-doanh-so-nhom.md`.

## Luật 4 — Con số hoa hồng lãnh đạo trong văn bản là VÍ DỤ, không phải mức thật

Điều 8 viết "Sản phẩm A có hoa hồng lãnh đạo 50.000 VNĐ/sản phẩm" — đó là câu **ví dụ minh họa**.
Mức thật do **Thông báo riêng theo từng giai đoạn** quy định, thay đổi theo thời kỳ và theo sản phẩm.

Agent **không cầm bảng mức đó** → tuyệt đối không nói "mỗi sản phẩm chị được 50 nghìn". Đại lý tự
trích câu 50.000 ra hỏi → nói rõ đó là ví dụ trong văn bản, mức áp dụng thật xem Thông báo hiện
hành, em nhờ vận hành gửi bản mới nhất.

## Luật 5 — Mở khóa và duy trì là HAI điều kiện khác nhau, hỏi rõ đại lý đang hỏi cái nào

- **Mở khóa** (Điều 9-10): làm **một lần**, để có quyền nhận hoa hồng tầng đó.
- **Duy trì** (Điều 11): xét **lại mỗi tháng**, để tháng đó thực sự được trả tiền.

Mở khóa xong không có nghĩa là tháng nào cũng có tiền. Rớt duy trì thì đi theo lộ trình Điều 13:
tháng đầu **ân hạn** (vẫn được trả, có cảnh báo); tháng thứ hai liên tiếp → **khóa** quyền lợi tầng
đó, hoa hồng chuyển cho tuyến trên gần nhất. Lấy lại: trong **06 tháng** đạt lại mốc 100 triệu
doanh số tích lũy như Điều 9 khoản 1 → nhận lại toàn bộ hệ thống, hưởng từ tháng nhận lại,
**không truy lãnh** các tháng bị khóa. Đừng nói "rớt là mất vĩnh viễn", cũng đừng nói "đạt lại
tháng nào là tự có tiền tháng đó" khi đã sang trạng thái khóa.

Auto Unlock (Điều 10: doanh số **nhóm** ≥ 500 triệu/tháng → Tầng 2; ≥ 1 tỷ/tháng → Tầng 3, kèm
30 triệu cá nhân) chỉ giải quyết vế **mở khóa**, không miễn vế duy trì. Điều kiện cấu trúc F1/F2
được phép **hoán đổi** theo Điều 12 (sàn cứng: luôn phải có tối thiểu 02 F1 trực tiếp đạt chuẩn).
Bảng đầy đủ: `references/tang-va-hoa-hong.md`.

## Luật 6 — "Năm thứ 1" tính theo ngày ký hợp đồng của TỪNG đại lý, không phải năm dương lịch

Điều kiện Tầng 2 và Tầng 3 chặt hơn từ năm thứ 2. Năm thứ 1 = 12 tháng liên tục kể từ **ngày ký Hợp
đồng Đại lý** của chính người đó; từ tháng thứ 13 áp bộ điều kiện năm thứ 2.

Agent không tự tính mốc này nếu không chắc ngày ký. `tra_ho_so_dai_ly` có ngày tham gia — dùng nó
để định hướng, nhưng ngày ký hợp đồng chính thức do vận hành xác nhận. Đừng chốt "chị đang năm thứ
nhất nên chỉ cần 2 F1" khi chưa chắc mốc.

## Luật 7 — Trả hàng thì trừ lùi, và có thể làm MẤT mốc đã đạt

Đơn bị trả/hủy/hoàn tiền sau khi đã ghi nhận doanh thu → phần doanh thu đó bị trừ vào **kỳ đối soát
hiện tại** (Điều 6). Nếu việc trừ làm tụt mốc của tháng đã chốt, phần hoa hồng và chiết khấu đã trả
dư sẽ bị khấu trừ vào kỳ hiện tại.

Nói thẳng điều này khi đại lý hỏi về trả hàng — đừng để họ bất ngờ lúc thấy kỳ sau bị trừ tiền. Ví
dụ tính đầy đủ theo văn bản: `references/doanh-thu-xet-thuong.md`.

## Luật 8 — Mốc đối soát và thanh toán là ngày cứng, khiếu nại có hạn 03 ngày làm việc

Kỳ ghi nhận: **00h00 ngày 26 tháng trước → 23h59 ngày 25 tháng này** (Điều 14). Báo cáo đối soát ra
ngày **06, 16, 26** trên Dashboard cá nhân. Đại lý có **03 ngày làm việc** để khiếu nại qua Sales
Admin trong nhóm Zalo; quá hạn không phản hồi thì số liệu hệ thống được xem là đã đồng ý.

Hoa hồng dưới **500.000 đ** không chuyển khoản, cộng dồn sang kỳ sau. Hoa hồng công bố là **Gross**,
công ty khấu trừ thuế TNCN trước khi chi trả (Điều 15). Bảng mốc ngày đầy đủ:
`references/doi-soat-thanh-toan.md`.

## Luật 9 — Vợ/chồng, cha mẹ/con cùng tuyến: tuyến trên cần 100 triệu/tháng

Mã số có quan hệ lợi ích mật thiết nằm cùng tuyến bảo trợ → để nhận hoa hồng phát sinh từ mã số đó,
mã số tuyến trên phải đạt **Doanh thu xét thưởng riêng từ 100 triệu/tháng** (Điều 16). Các nhánh
kinh doanh độc lập khác vẫn tính bình thường.

Đây là quy định nhạy cảm — nói bằng giọng quy định chung, không suy đoán quan hệ gia đình của ai.
Chi tiết + ví dụ: `references/quan-he-loi-ich.md`.

## Luật 10 — Agent giải thích quy định, KHÔNG chốt số tiền và KHÔNG hứa duyệt

Được phép: nêu ngưỡng, giải thích cơ chế, đọc lại điều khoản, hướng dẫn nộp khiếu nại.

Không được: tính hộ tiền hoa hồng đại lý sẽ nhận, khẳng định đại lý đã đủ/chưa đủ mốc, hứa ngày
duyệt, hứa mức chiết khấu, nói tầng đã mở khóa, xác nhận ai là Leader hay đã tách nhánh. Toàn bộ
những cái đó do hệ thống đối soát và bên duyệt chốt.

## Luật 11 — Văn bản có chỗ chưa quy định rõ: chuyển, đừng suy diễn

Một số câu hỏi rất hay gặp mà văn bản **không trả lời dứt khoát** (chu kỳ 06 tháng tính trượt
hay cố định, tiền cọc trước 500 triệu có tính vào doanh thu xét thưởng không, hoa hồng lãnh đạo
mỗi tầng nhận đủ hay chia nhau, doanh số nhóm có trùng định nghĩa doanh thu xét thưởng không...).
Danh sách và câu trả lời an toàn cho từng cái: `references/cau-hoi-kho.md`.

Gặp câu trong danh sách đó → đọc nguyên tắc chung, nói rõ phần chi tiết do vận hành/kế toán xác
nhận, chuyển lên. **Không tự chọn một cách hiểu.** Chọn sai một lần là đại lý lấy hàng sai giá hoặc
kỳ vọng sai tiền hoa hồng cả kỳ.
