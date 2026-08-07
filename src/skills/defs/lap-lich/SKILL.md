---
name: lap-lich
description: Nhân viên muốn đặt việc chạy tự động theo giờ trong nhóm — "mỗi ngày 5h chiều gửi báo cáo", "đặt lịch nhắc chốt đơn", "cho bot tự gửi lúc 8h sáng", "sao hôm qua không thấy báo cáo", "tắt cái tin tự động đi", "đổi giờ gửi sang 18h". Load khi có ý định đặt/sửa/tắt/xoá việc theo giờ, hoặc khi người ta hỏi vì sao tin tự động không chạy.
agents: dealer, operations
---

# Lập lịch — hướng nhân viên gõ `/lich`

**Agent KHÔNG đặt được lịch.** Không có tool nào tạo/sửa/xoá việc theo giờ. Đặt lịch là **flash
command** — chỉ chạy khi CON NGƯỜI gõ vào khung chat. Việc của agent: dịch ý muốn của họ thành
**đúng một dòng lệnh để copy**, và giải thích khi lịch không chạy như mong đợi.

Trả lời sai kiểu ở đây rất tốn: hứa "em đặt lịch rồi ạ" là để cả nhóm chờ một tin không bao giờ tới.

## Luật 1 — Luôn kết thúc bằng một dòng lệnh gõ được

Người ta nói ý muốn bằng lời; agent trả về lệnh. Dòng lệnh phải **đứng riêng một dòng**, đã điền
sẵn giờ và mô tả việc — không để chỗ trống kiểu `<giờ>` cho họ tự sửa.

| Họ nói | Agent trả |
|---|---|
| "mỗi ngày 5h chiều gửi báo cáo" | `/lich 17:00 gửi báo cáo cuối ngày cho nhóm` |
| "8h sáng nhắc chốt đơn" | `/lich 08:00 nhắc đại lý chốt đơn trong ngày` |
| "đổi giờ sang 6h tối" | `/lich sua <mã> 18:00` |
| "tắt tin tự động đi" | `/lich tat <mã>` |
| "bỏ hẳn cái đó" | `/lich xoa <mã>` |
| "đang có những gì" | `/lich` |

Lệnh sửa/tắt/xoá cần **mã việc** — agent không tra được mã. Chưa biết mã → bảo họ gõ `/lich` xem
danh sách trước, rồi mới gõ lệnh kia. Đừng đoán mã.

## Luật 2 — Giờ: nói giờ Việt Nam, viết 24h

Đổi cách nói đời thường sang 24h trước khi ghép lệnh: *5h chiều* → `17:00`, *8h rưỡi sáng* →
`08:30`, *trưa* → hỏi lại đúng mấy giờ (đừng tự chọn 12:00).

Lịch chạy theo **giờ Việt Nam**, mỗi ngày một lần. Lệnh chỉ nhận giờ trong ngày.

Họ muốn **theo thứ / theo tháng** ("thứ hai hàng tuần", "mùng 1") → lệnh không làm được, nói thẳng
là phải nhờ kỹ thuật đặt tay, đừng ghép lệnh sai rồi để họ gõ vào và thất bại.

## Luật 3 — Mô tả việc viết như đang NHỜ agent

Mô tả đó chính là tin sẽ rơi vào nhóm lúc tới giờ, và agent lúc đó đọc nó như một yêu cầu của
người dùng. Nên viết bằng câu việc: *"gửi báo cáo cuối ngày cho nhóm"*, *"nhắc đại lý còn đơn chưa
chuyển tiền"*.

Không viết tên kỹ thuật (`job_report_v2`), không viết cụt lủn (`báo cáo`), không nhét cả quy trình
nhiều bước vào — việc dài dòng thuộc về skill, mô tả chỉ nói **làm gì**.

Việc yêu cầu phải nằm trong khả năng của agent. Họ nhờ một việc agent không có tool để làm
(vd "gửi doanh số toàn hệ thống") → nói trước là tới giờ agent cũng không tra được, đừng để họ đặt
lịch cho một tin sẽ báo lỗi mỗi ngày.

## Luật 4 — Ai gõ được, gõ ở đâu

- Chỉ **nhân viên** (đã `/ketnoi-hethong`) gõ được. Đại lý gõ → máy báo không đủ quyền; agent nói
  rõ là cần nhân viên đặt giúp, không hứa đặt hộ.
- Chỉ gõ **trong nhóm**, và việc đặt ở nhóm nào chạy cho nhóm đó. Muốn nhóm khác có báo cáo thì
  vào nhóm đó gõ — không có cách đặt từ xa.
- Mã việc chỉ có nghĩa trong chính nhóm đó.

## Luật 5 — "Sao không thấy tin tự động?" — hỏi theo thứ tự này

1. `/lich` xem việc còn không, đang bật hay `đang tắt`, và mốc **kế tiếp** là lúc nào.
2. Vừa đặt xong mà chưa tới giờ → bình thường: lịch chạy từ lần tới giờ **kế tiếp**, không chạy ngay.
3. Vừa bật lại sau khi tắt → cũng không chạy bù phần đã tắt, chờ mốc kế tiếp.
4. Nhóm có đang bị `/block` không — nhóm bị chặn thì agent im, tin theo giờ cũng không ra.
5. Vẫn không có → chuyển kỹ thuật, kèm **mã việc + giờ + nhóm**. Agent không tự kết luận là hệ hỏng.

Không hứa "để em kiểm tra lại rồi báo" — agent không có đường tra lịch, chỉ người gõ `/lich` mới thấy.

## Luật 6 — Tắt khác xoá, nói rõ trước khi họ gõ

`/lich tat <mã>` = dừng tạm, việc vẫn nằm trong danh sách, bật lại được bằng `/lich bat <mã>`.
`/lich xoa <mã>` = **xoá hẳn, không khôi phục**, muốn dùng lại phải đặt mới.

Họ nói "bỏ đi", "dẹp cái đó" → mặc định gợi ý **tắt**, và nói thêm là muốn xoá hẳn thì dùng `xoa`.
Chọn hộ hướng xoá là làm mất thứ họ chỉ định dừng vài hôm.
