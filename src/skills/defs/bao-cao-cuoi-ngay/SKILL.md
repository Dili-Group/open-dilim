---
name: bao-cao-cuoi-ngay
description: Chạy báo cáo tổng kết cuối ngày cho nhóm đại lý — đơn xuất kho trong ngày, đơn hoàn về trong ngày, tổng tiền đại lý phải thanh toán cho đơn xuất kho và tổng tiền của đơn hoàn về. Load khi lượt này do scheduler bắn (tin "Chạy báo cáo cuối ngày"), hoặc khi đại lý/nhân viên hỏi "hôm nay xuất bao nhiêu đơn", "chốt sổ hôm nay", "tổng kết ngày".
agents: dealer
---

# Báo cáo cuối ngày — nhóm đại lý

Lượt này thường KHÔNG do người gõ: scheduler bắn lúc 17h (§8 kiến trúc), text yêu cầu vào history
phòng như một lượt người dùng. Không ai đang ngồi chờ để hỏi lại → câu trả lời phải **đủ và tự đứng
được một mình**.

## Luật 0 — Chưa có tool tổng hợp thì KHÔNG báo cáo

Tool tổng hợp số liệu ngày (`bao_cao_ngay`) **chưa được nối**. Cho tới khi có, tuyệt đối:

- **Không** cộng tay từ nhiều lần gọi `tra_don_hang` rồi báo tổng.
- **Không** suy số liệu ngày từ trí nhớ dài hạn hay từ hội thoại trong nhóm.
- **Không** báo "hôm nay không có đơn nào" — không tra được KHÁC với không có.

Không có tool → trả đúng một câu: *báo cáo cuối ngày chưa chạy được vì hệ thống chưa nối dữ liệu
tổng hợp, em sẽ gửi lại khi có.* Rồi dừng. Một dòng thật thà tốt hơn một bảng số bịa.

Tool có rồi thì bỏ luật này, làm tiếp Luật 1.

## Luật 1 — Bốn con số, đúng bốn, không thêm

Báo cáo trả lời đúng bốn thứ, theo thứ tự này:

1. **Đơn xuất kho hôm nay** — số đơn.
2. **Tổng tiền phải thanh toán cho đơn xuất kho** — tiền ĐẠI LÝ chuyển cho công ty (giá đại lý +
   phí hộp giấy), **không phải** COD khách trả. Nhầm hai con số này là đại lý chuyển sai tiền.
3. **Đơn hoàn về hôm nay** — số đơn.
4. **Tổng tiền của đơn hoàn về** — theo đơn.

Không kèm: danh sách toàn bộ mã đơn, tồn kho, doanh số lũy kế, so sánh với đại lý khác, dự báo.
Đại lý cần bốn con số để đối chiếu sổ, không cần bản trình bày.

## Luật 2 — Số nào tool trả, số đó in

Mọi con số phải đến từ tool. Agent **không cộng trừ**, không quy đổi, không làm tròn "cho đẹp",
không tự tính trung bình. Tool trả 0 đơn → nói *không có đơn nào* (đó là dữ liệu thật, khác với
Luật 0). Tool trả thiếu một mục → nói thiếu mục đó, ba mục còn lại vẫn báo.

Tiền in nguyên đơn vị đồng như tool trả. Ngày in `dd/mm/YYYY`.

## Luật 3 — Chỉ dữ liệu của phòng này

Phạm vi đại lý lấy từ **chủ phòng** (nhóm đã `/ketnoi-daily`), agent không tự chọn đại lý. Phòng
chưa nối → không có phạm vi để tra: nói thẳng là nhóm chưa `/ketnoi-daily` nên chưa chạy được báo
cáo, cần nhân viên nối nhóm trước. Không mượn tạm đại lý khác, không báo số của toàn hệ thống.

## Luật 4 — Dạng tin nhắn

Ngắn, dán được vào sổ, không lời dẫn dài. Khung:

```
Báo cáo cuối ngày dd/mm/YYYY
• Xuất kho: <n> đơn — cần thanh toán: <tổng tiền>
• Hoàn về: <n> đơn — giá trị: <tổng tiền>
```

Có bất thường (một mục tra không được, hoặc số 0 ở cả hai mục) → thêm **một** dòng nói rõ, không
thêm đoạn giải thích.

Không mở đầu bằng chào hỏi, không kết bằng câu hỏi mời trao đổi — đây là bản tin, không phải hội
thoại. Đại lý hỏi lại chi tiết một đơn cụ thể thì đó là lượt mới, dùng skill `don-hang`.

## Luật 5 — Không hứa, không kết luận thay đại lý

Không nói "đơn hoàn nhiều bất thường", "hôm nay bán tốt", không nhắc đại lý chuyển tiền gấp, không
suy ra lý do đơn hoàn. Báo số, hết. Đại lý hỏi vì sao hoàn nhiều → chuyển vận hành.
