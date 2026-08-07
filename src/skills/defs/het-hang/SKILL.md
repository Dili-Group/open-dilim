---
name: het-hang
description: Đại lý hỏi hàng còn hay hết, hàng về chưa, hoặc đơn nằm im vì trong đơn có sản phẩm hết hàng — "còn hàng không em", "sản phẩm A còn không", "đơn này đi được chưa", "bao giờ có hàng", "hết hàng thì huỷ giúp chị", "cháy hàng à". Load kèm skill don-hang khi tin nhắn hỏi tồn kho, hoặc khi đại lý muốn huỷ/giữ/đổi đơn vì hết hàng.
agents: dealer
---

# Hết hàng — trả lời đại lý về tồn kho và đơn bị kẹt vì hết hàng

**Agent KHÔNG có dữ liệu tồn kho.** Không tool nào tra được còn bao nhiêu hàng, hàng về ngày nào,
sản phẩm nào đang cháy. Nguồn sự thật duy nhất là **thông báo của nhân viên trong chính nhóm này**.

Việc của agent đúng bốn phần: **tra trạng thái đơn thật → nói đúng thông tin hết hàng đã có trong
nhóm (nếu có) → nêu đủ ba hướng xử lý → hỏi đại lý chọn hướng nào rồi chuyển vận hành.**

## Luật 1 — Không tự kết luận còn hay hết

Cấm nói "sản phẩm này còn hàng ạ" hay "cái này hết rồi ạ" khi không có thông báo của nhân viên.
Cấm suy ra hết hàng từ trạng thái đơn: đơn nằm ở *đơn hàng mới / đã kiểm duyệt / đang soạn hàng* có
hàng trăm lý do (chờ tiền, kho đông, chờ ĐVVC) — hết hàng chỉ là một trong số đó.

Không có thông báo → nói thẳng là **em không tra được tồn kho**, đơn đang ở khâu `<trạng thái>`, và
em chuyển vận hành xác nhận còn hàng hay không. Nói được đúng ranh giới đó tốt hơn đoán một câu dễ
nghe rồi sai.

## Luật 2 — Thông báo trong nhóm là nguồn duy nhất, phải trích rõ

Nhân viên vận hành báo hết hàng thẳng trong nhóm. Tin đó nằm trong **lịch sử hội thoại của phòng**
(mỗi lượt có dấu `[HH:mm dd/mm/YYYY]` + người gửi) hoặc trong khối **GHI NHỚ DÀI HẠN** ở đầu ngữ
cảnh. Đọc ở đó — không có tool nào để gọi.

Khi dùng lại thông tin đó, luôn kèm **ai nói + ngày nào**: *"theo thông báo của bên vận hành ngày
05/08"*. Đại lý cần biết tin cũ hay mới để tự quyết.

- Thông báo cũ (vài ngày trở lên) → nói rõ là **tính tới thời điểm thông báo đó**, và em nhờ vận
  hành xác nhận lại hiện tại. Không tự cho là vẫn còn hiệu lực.
- Thông báo mâu thuẫn nhau → lấy tin mới nhất theo dấu thời gian, nói rõ mốc.
- Đại lý khẳng định "hôm qua chị nghe nói hết rồi" mà nhóm không có thông báo nào → **không cãi,
  cũng không xác nhận**: ghi nhận và chuyển vận hành kiểm tra.

## Luật 3 — "Đơn này đi được chưa?" — tra đơn trước, luôn luôn

Câu này là câu hỏi trạng thái, không phải câu hỏi tồn kho. Gọi `tra_don_hang` (chốt đơn nào: skill
`don-hang` bước 1), trả trạng thái thật trước, rồi mới nói phần hết hàng.

| Đơn đang ở | Nói gì thêm về hết hàng |
|---|---|
| đã bàn giao ĐVVC / đang vận chuyển / giao thành công | Đơn **đã đi rồi** — chuyện hết hàng không còn liên quan tới đơn này. Đưa ĐVVC + mã vận đơn. |
| mới / đã kiểm duyệt / đang soạn hàng | Đơn còn trong kho. Có thông báo hết hàng đúng sản phẩm trong đơn → nêu (Luật 2) rồi sang Luật 4. Không có → Luật 1. |
| đã huỷ | Đơn huỷ rồi. Hỏi đại lý có lên lại đơn không; đừng bàn tiếp chuyện giữ đơn. |

Đơn hai mặt hàng, chỉ một mặt hết → nói rõ **mặt nào** kẹt, đừng nói cả đơn hết hàng. Danh sách hàng
trong đơn nằm ở phần `Hàng trong đơn` của `tra_don_hang`.

## Luật 4 — Ba hướng xử lý, agent nêu đủ, KHÔNG chọn hộ

Khi đã có thông báo sản phẩm A hết hàng và đơn còn trong kho, đại lý có ba hướng:

1. **Lấy từ hàng hoàn đã nhập kho** — nếu kho còn hàng hoàn của đúng sản phẩm đó, vận hành hỗ trợ
   lấy ra cho đơn đi. Agent **không tra được kho hoàn còn hay không** → chỉ nêu là hướng ưu tiên để
   vận hành kiểm, tuyệt đối không hứa là có.
2. **Huỷ đơn, lên đơn khác** — bỏ đơn đang kẹt, đại lý lên đơn mới với sản phẩm khác. Huỷ là việc
   của vận hành, lên đơn là việc của đại lý; agent không làm cả hai.
3. **Giữ đơn chờ hàng về** — đơn nằm chờ, khi có hàng nhân viên duyệt cho đơn đi. Không hứa ngày.

Thứ tự nói: 1 → 2 → 3, vì hướng 1 giữ được đơn mà không mất thời gian. Nêu xong **hỏi đại lý chọn
hướng nào** — một câu, đừng bắt đại lý đọc quy trình rồi tự suy.

Chi tiết từng hướng + đại lý im lặng/nói nước đôi thì làm gì: `references/phuong-an.md`.

## Luật 5 — Chốt xong phải bàn giao đủ dữ kiện

Đại lý chọn xong, câu trả lời của agent phải có đủ để nhân viên trong nhóm xử lý ngay, không hỏi lại:
**mã vận đơn · sản phẩm hết hàng · hướng đại lý chọn**. Thiếu mã đơn thì hỏi trước, đừng bàn giao
một yêu cầu treo.

Agent **không**: huỷ đơn, giữ đơn, duyệt đơn, đổi mặt hàng trong đơn, lên đơn mới, đặt giữ hàng khi
hàng về. Không có tool ghi nào — mọi thao tác đó đi qua nhân viên vận hành.

## Luật 6 — Cấm hứa ngày có hàng

Không nói "mai có hàng", "cuối tuần về", "tầm 2-3 hôm nữa". Chỉ nêu ngày khi **nhân viên đã nói ngày
đó trong nhóm**, và khi nêu thì trích nguyên: *"vận hành báo ngày 09/08 hàng về"* kèm mốc thông báo.

Không hứa **giữ hàng** cho đại lý khi hàng về, không hứa đơn sẽ được duyệt đi đầu tiên, không hứa
được lấy hàng từ kho hoàn. Ba thứ đó đều do vận hành quyết.

## Luật 7 — Đại lý hỏi lại lần hai

Không lặp nguyên câu cũ. Mỗi lần hỏi lại phải thêm ít nhất một dữ kiện mới: trạng thái đơn vừa tra
lại, mốc chuyển trạng thái gần nhất, thông báo mới của nhân viên trong nhóm, hoặc tên nhân viên đã
nhận việc. Chưa có gì mới → nói thẳng là chưa có cập nhật mới tính tới lúc này, kèm mốc.

Giọng khi đại lý bực (khách cuối đang đợi, đơn hoả tốc): ghi nhận trước, dữ kiện sau, không xin lỗi
dài dòng, không đổ lỗi cho kho. Đơn có giọng giục → nạp thêm skill `giuc-don`.

## Luật 8 — Chỉ nói chuyện đơn và hàng của phòng này

Không nói đại lý khác đã ôm hết hàng, không nêu số lượng còn lại của kho, không so sánh với đơn của
đại lý khác. Đại lý hỏi "sao đại lý kia có mà em không có" → không bàn, chuyển vận hành.

Mẫu câu từng nhánh: `references/mau-cau.md`.
