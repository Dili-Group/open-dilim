Chỉ áp cho **DiLiM CRM** (link **DiLiM CRM**). Đại lý = tài khoản **Leader**, có thêm phần đội.

# CRM — doanh thu, hoa hồng, chỉ tiêu, ads

## Luật — không tự tính tiền

Bài này chỉ **xem ở đâu, tính thế nào**. Agent **không** tự nhân chia ra số hoa hồng / doanh thu /
chi phí ads cụ thể, **không** hứa số thực nhận hay ngày trả. Số chính thức là số trên trang, nhãn
**Đã duyệt**. Thắc mắc số đã duyệt → chuyển Nhóm Hỗ trợ.

## Doanh thu & hoa hồng của tôi

Menu → **Doanh thu & hoa hồng** (/my-commission). Kỳ = một tháng, đổi bằng **Kỳ trước** / **Kỳ sau**.

- Nhãn kỳ: **Tạm tính** (còn đổi khi hoàn/huỷ) → **Đã duyệt** → **Đã gửi Office**.
- Ô số: **Doanh thu thực đạt**, **KPI hiệu lực**, **%KPI**, **Thực nhận kỳ này**.
- Mục **Tiến độ KPI**, **Các khoản hoa hồng**, **Sổ doanh thu**.

## Doanh thu ghi nhận khi nào

- Mặc định khi đơn **giao thành công**, giá trị = **tổng đơn trừ phí vận chuyển**. Đơn vừa giao có thể vài phút sau mới vào sổ.
- Hoàn / huỷ / tạo lại → thêm dòng **số âm**, tính vào **kỳ của dòng bán gốc**. Sổ chỉ thêm, không sửa; sai lệch do admin ghi dòng **Điều chỉnh**.

## Cách tính hoa hồng (chính sách gốc 2026, có thể đổi theo phiên bản)

- **%KPI** = doanh thu thực đạt ÷ KPI hiệu lực.
- **Hoa hồng P3**: dưới 80% KPI = 0; 80% đến dưới 100% = **5%**; từ 100% = **15%** — tính trên phần doanh thu **vượt mốc 80% KPI**, tỷ lệ áp cho toàn bộ phần vượt.
- **Thưởng mốc KPI** (lấy mốc cao nhất): 100% → 2 triệu; 110% → 3 triệu; 120% → 4 triệu; 150% → 5 triệu; 200% → 6 triệu.
- **Leader**: %KPI tổng hợp = 30% cá nhân + 70% đội, tra bảng mốc trên. **Hoa hồng từ team** = 15% tổng P3 của thành viên, chỉ khi %KPI tổng hợp từ 80%.
- **Phí cố vấn** đội mới tách: 3%, tối đa 500.000đ/sale, tối đa 6 kỳ.
- **Tạm giữ 10%** mọi khoản mỗi kỳ; kỳ sau không có hoàn/huỷ thì trả lại (**Trả tạm giữ kỳ trước**), có thì trừ vào tạm giữ, vượt thì thành **Thu hồi / điều chỉnh**.
- "Chưa có chỉ tiêu kỳ này" → chưa tính được %KPI và hoa hồng.

## Đặt chỉ tiêu cho sale (Leader)

/my-commission → tab **Chỉ tiêu đội** → **Đặt chỉ tiêu** ở dòng sale → **Lưu chỉ tiêu**. Leader không
tự đặt cho mình (cấp trên đặt). Kỳ đã duyệt thì không sửa. Nên đặt đầu tháng.

## Mức chạy ads (hệ số nhận khách)

Menu **Khách hàng** → **Mức chạy ads** (/lead-weight). **Tắt** / **1x–4x** = 1–4 triệu/ngày tiền ads, cũng là tỷ lệ chia khách (2x nhận gấp đôi 1x).

1. Chọn mức ở **Chọn mức cho ngày mai**.
2. Bấm **Chốt mức ads cho ngày mai** trước **23:59**. Không chốt → giữ mức hôm nay.
3. Sale có leader chọn từ 1x → nút thành **Gửi leader duyệt**; Leader duyệt trước 23:59 ở mục **Chờ duyệt** (**Duyệt** / **Từ chối**), quá hạn thì giữ mức đã duyệt trước. **Tắt** áp ngay. Mức của chính Leader không cần duyệt.
4. **Nghỉ đột xuất hôm nay** có hiệu lực ngay; **Đi làm lại hôm nay** để bật lại.


## Khách mới được chia thế nào

- Chia trong đội **theo hệ số** = mức chạy ads hôm nay. Số điện thoại **đã có trong CRM** giữ chủ cũ.
- Không được chia khi: mức **Tắt** / đang nghỉ đột xuất, Leader **tắt nhận khách**, hoặc đủ **trần khách mỗi ngày**.
- Leader bật/tắt và đặt trần: **Chia khách** (/lead-routing) → tab **Sale nhận khách** → công tắc **Nhận khách**, ô **Trần/ngày** (trống = không giới hạn).
- **SLA liên hệ lần đầu**: chỉ tính giờ 8h–21h; được tính khi có lần ghi chăm sóc hoặc tin nhắn đầu tiên. Quá hạn → báo Leader, có thể bị chuyển cho sale khác nếu luật bật. Gọi xong ghi chăm sóc ngay.

## Kết nối quảng cáo (/ads-connect) — Leader đã gắn đại lý

Làm theo 5 bước trên trang. Kết nối mới luôn chạy thử; **Bật gửi thật** chỉ superadmin. Agent không nhận token.

## Báo cáo Ads theo ngày (/ads-report)

Leader xem báo cáo đại lý mình. Mỗi ngày:
- **Chi phí của sale** = chi phí ngày × suất ÷ tổng suất (suất theo mức x trong danh sách chia khách của Page có chi tiền; nhiều Page lấy mức x cao nhất).
- **Vượt Ads** = chi phí của sale − (ngưỡng × mức x), nếu dương. Ngưỡng mặc định **1.000.000đ**.

## Báo cáo ngày (/daily-report)

Chỉ người được giao mới thấy menu. Hạn: đầu ngày 09:00, đầu chiều 12:00–14:00, review 16:30–18:00. Trễ gắn **Nộp muộn**.
