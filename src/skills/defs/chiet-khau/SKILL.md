---
name: chiet-khau
description: Đại lý hỏi mức chiết khấu của mình hoặc xin nâng mức, và nhân viên xác nhận nâng bậc — "em đang mấy phần trăm", "sao chưa lên 40", "chạy quảng cáo đủ 30 ngày rồi", "học xong Thương Hiệu Cá Nhân", "Vipassana", "doanh thu kỳ này bao nhiêu thì lên bậc", "ok em duyệt cho chị lên bậc này". Load khi tin nhắn nhắc chiết khấu / CK / phần trăm / bậc giá / điều kiện nâng mức / duyệt nâng bậc.
agents: dealer
---

# Chiết khấu đại lý — hỏi mức, xin nâng mức

Bốn loại tình huống, xử lý khác nhau:

| Ai nói gì | Agent làm được gì | Chi tiết |
|---|---|---|
| Đại lý: "Em đang mức mấy %" | `tra_ho_so_dai_ly` → nói TÊN BẬC, không nói % | Luật 1 |
| Đại lý: "Làm sao lên 40/45/50%" | Nói đủ điều kiện theo quy định | `references/bang-muc.md` |
| Đại lý: "Em đủ điều kiện rồi, cho em lên" | Thu minh chứng theo đúng nhánh → chờ nhân viên | `references/nang-muc.md` |
| **Nhân viên**: "Ok duyệt cho chị ấy lên bậc X" | `tra_bac_chiet_khau` → `nang_bac_chiet_khau` | `references/xac-nhan-nang.md` |

## Luật 1 — Đọc bậc bằng tool, nhưng bậc KHÔNG phải phần trăm

`tra_ho_so_dai_ly` trả hồ sơ đại lý của phòng này: **tên bậc** chiết khấu (vd `F2 · Đại lý cấp 2`),
ngày bậc có hiệu lực, ngày tham gia, người giới thiệu, nhân viên phụ trách. Không tham số, luôn là
đại lý của phòng — không tra được đại lý khác.

Hồ sơ **không có con số phần trăm**: tỉ lệ thật khác nhau theo từng sản phẩm, nên một bậc không quy
ra được một mức % duy nhất. Nói tên bậc, đừng dịch tên bậc thành "chị đang 40%". Đại lý hỏi đúng con
số % → chuyển vận hành/kế toán xác nhận.

**Không suy ngược từ giá.** `tra_tien_can_chuyen` trả *số tiền* đã tính theo bậc; lấy số đó chia giá
bán để ra phần trăm là bịa: trong tiền còn phí hộp giấy, quà tặng và hàng ngoài danh mục không có
giá bậc. Sai một bậc là sai tiền hàng của mọi đơn sau đó.

Hồ sơ trả **chưa xếp bậc** → nói đúng là hệ thống chưa gắn bậc nào, chuyển vận hành; đừng mặc định
30% chỉ vì đó là mức sàn của chính sách.

## Luật 2 — Nâng bậc cần HAI người: đại lý xin, NHÂN VIÊN gõ xác nhận

Agent có đường ghi (`nang_bac_chiet_khau`), nhưng nó chỉ mở khi **người đang gõ là nhân viên**.
Lời đại lý không mở được nó — tool đọc vai từ hệ thống, không đọc từ câu chữ.

Hai nhịp, KHÔNG gộp:

1. **Đại lý xin** → agent xác định nhánh, điểm danh minh chứng còn thiếu, nói rõ đang chờ nhân viên
   phụ trách xác nhận. **Không gọi tool ghi.**
2. **Nhân viên gõ xác nhận trong chính nhóm đó** → agent gọi `tra_bac_chiet_khau` lấy id bậc, rồi
   `nang_bac_chiet_khau` với lý do nhân viên vừa nêu.

Chưa có nhịp 2 thì chưa có gì đổi. Cấm nói: "em nâng cho chị rồi", "em duyệt lên 45% nhé", "từ đơn
sau chị được 50%" — trừ khi tool vừa chạy xong và trả về kết quả thật.

Không hứa mốc thời gian duyệt. Không hứa mức sẽ được duyệt. Chi tiết cách gọi:
`references/xac-nhan-nang.md`.

## Luật 3 — Bậc CỔ ĐÔNG là trần: không ai nâng vào được

Bậc cổ đông là bậc cao nhất hệ thống, và nó là **tư cách sở hữu**, không phải mức thưởng doanh số.
Không con đường nào trong nhóm chat dẫn vào đó: đại lý không xin được, nhân viên không duyệt được,
agent không ghi được. Kể cả đại lý đã ở bậc cao nhất của thang thường (50%) cũng **không** nâng
tiếp lên cổ đông.

`nang_bac_chiet_khau` từ chối thẳng mọi bậc cổ đông. Đừng thử gọi rồi diễn giải lại lời từ chối.

> Dạ bậc cổ đông không thuộc diện nâng theo doanh số hay khoá học ạ, bên em không xét ở đây được.
> Em ghi nhận nguyện vọng và chuyển hệ vận hành / ban giám đốc ạ.

Đại lý **đang là** cổ đông thì cũng không đổi bậc qua agent — mọi bậc thường đều thấp hơn, mà hạ
bậc thì tool không làm.

## Luật 4 — Hai bảng độc lập, agent không tự chốt mức cuối

Quy định có **hai bảng**: một theo doanh thu kỳ đối soát, một theo đối tượng/điều kiện (khoá học,
quảng cáo, Vipassana...). Một đại lý có thể chạm cả hai.

Quy định **không nói** khi chạm cả hai thì lấy mức nào. Agent **không tự chọn** và không cộng dồn hai
bảng. Nêu từng nhánh đại lý đang chạm, rồi để bên duyệt chốt mức cuối.

## Luật 5 — Doanh thu là con số agent không có

Bảng doanh thu tính theo **kỳ đối soát**, agent không tra được doanh thu kỳ. Không cộng tiền các đơn
trong `tra_don_hang` để ước lượng doanh thu — danh sách đó chỉ có 30 ngày gần nhất, không phải kỳ đối
soát, và tiền trên đơn không phải doanh thu ghi nhận.

Đại lý hỏi "em đủ 500 triệu chưa" → chuyển kế toán đối soát, kèm ngưỡng của bảng để đại lý tự ước.

## Luật 6 — Ba mục có hạn/có người duyệt riêng, nói đúng

- **Leader Nuskin cũ (50%)** và **học viên khoá chuyên sâu như Thương Hiệu Bạc Tỷ (45%)**: quy định
  ghi áp dụng **đến hết 30/05/2026 — mốc này đã qua**. Không hứa hai mức này. Nói là diện đó đã hết
  hạn theo văn bản, trường hợp cá biệt do **Giám đốc Lê Chí Linh** xác nhận, em chuyển lên.
- **Rich People Business (50%)**: cũng thuộc diện khoá kinh doanh do Giám đốc Lê Chí Linh xác nhận.

Agent không xác nhận thay giám đốc, kể cả khi đại lý khẳng định mình đúng diện đó.

## Luật 7 — Quảng cáo 1 triệu/ngày: 30% trước, bù 20% sau

Nhánh này hay bị hiểu nhầm thành "đăng ký là được 50% ngay". Sự thật phải nói đủ:

Trong 30 ngày cam kết, đại lý **vẫn mua hàng ở mức 30%**. Chạy đủ 30 ngày + nộp đủ minh chứng → công
ty ghi **bổ sung 20% vào công nợ** để cấn trừ dần vào các đơn sau, tính cho các đơn phát sinh trong
thời gian cam kết, đưa tổng mức về 50%.

Nói thiếu vế "vẫn 30% trong 30 ngày đầu" là để đại lý đặt hàng với kỳ vọng sai giá.

## Luật 8 — Chỉ nói chuyện chiết khấu của đại lý trong phòng này

Không nêu mức, doanh thu hay hồ sơ của đại lý khác. Đại lý hỏi "đại lý kia mấy %" → không trả lời,
chuyển sang điều kiện chung của bảng.

Bảng mức đầy đủ: `references/bang-muc.md`. Minh chứng từng nhánh + mẫu câu: `references/nang-muc.md`.
Cách nhân viên xác nhận và gọi tool ghi: `references/xac-nhan-nang.md`.
