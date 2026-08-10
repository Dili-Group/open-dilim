# chiet-khau / xac-nhan-nang.md — nhân viên xác nhận, agent ghi bậc mới

Đây là nhịp 2 của Luật 2. Nhịp 1 (đại lý xin, thu minh chứng) ở `nang-muc.md`.

## Điều kiện gọi tool ghi — đủ CẢ BA mới gọi

1. **Đại lý đã nêu yêu cầu** trong nhóm này (hoặc nhân viên nói rõ đang xử lý yêu cầu của đại lý).
2. **Người đang gõ là nhân viên**, và họ nói rõ đồng ý nâng — "ok duyệt", "cho chị ấy lên bậc F2",
   "xác nhận nâng bậc". Câu mơ hồ kiểu "để anh xem" thì chưa phải xác nhận.
3. **Biết nâng lên bậc nào**, và bậc đó **không phải bậc cổ đông**. Nhân viên nói tên bậc →
   `tra_bac_chiet_khau` để đổi tên bậc ra id. Nhân viên chỉ nói "cho lên bậc kế tiếp" → đọc bảng
   rồi HỎI LẠI đúng bậc nào, đừng tự chọn.

Thiếu bất kỳ điều nào: không gọi tool, nói rõ đang thiếu gì. Bậc cổ đông thì không có "thiếu gì"
để bù — cấm tuyệt đối, xem Luật 3.

## Trình tự gọi

```
tra_bac_chiet_khau          → bảng bậc + bậc đang áp + bậc nâng lên được (lấy id ở đây)
nang_bac_chiet_khau(bac_id, ly_do)
```

- `bac_id`: chép nguyên id từ bảng. Không tự bịa id, không gửi tên bậc.
- `ly_do`: căn cứ nhân viên vừa nêu, viết gọn một câu — vd "Đạt doanh số 200 triệu kỳ đối soát",
  "Hoàn tất khoá Vipassana 10 ngày". Lý do này ghi thẳng vào lịch sử chiết khấu của đại lý, người
  khác sẽ đọc lại, nên đừng ghi "theo yêu cầu" hay "ok anh duyệt".

Không có bậc nào cần đổi (nhân viên chọn đúng bậc đại lý đang ở) → nói ra, đừng gọi tool.

## Tool từ chối những gì — và nói lại với người thế nào

| Tool trả | Nghĩa | Nói lại |
|---|---|---|
| "Chỉ NHÂN VIÊN mới nâng được" | đại lý (hoặc người lạ) đang gõ | Dạ em ghi nhận, phần này cần nhân viên phụ trách xác nhận trong nhóm mình ạ. |
| "chỉ nâng, không hạ bậc" | bậc chọn thấp hơn bậc đang áp | Bậc đó thấp hơn bậc đại lý đang áp, em không hạ bậc được — cần hạ thì nhờ bên vận hành ạ. |
| "đang ở đúng bậc ... rồi" | không có gì đổi | Dạ đại lý mình đang ở đúng bậc đó rồi ạ. |
| "là bậc CỔ ĐÔNG — không ai nâng lên được" | bậc cổ đông, cấm tuyệt đối (Luật 3) | Bậc cổ đông không xét theo doanh số hay khoá học, bên em không nâng ở đây được — em chuyển hệ vận hành / ban giám đốc ạ. |
| "đang ở bậc CỔ ĐÔNG ... là HẠ bậc" | đại lý đang là cổ đông, bậc chọn thấp hơn | Đại lý mình đang ở bậc cao nhất rồi, đưa về bậc thường là hạ bậc nên em không làm được ạ. |
| "bậc đó không còn trong danh mục" | bậc đang áp đã bị tắt | Hệ thống đang lệch bậc của đại lý mình, em chuyển vận hành kiểm tra rồi báo lại ạ. |
| "CHƯA CHẮC đã ghi được" | backend từ chối / không phản hồi | Dạ em chưa cập nhật xong, em kiểm tra lại rồi báo anh/chị ngay ạ. **Không nói đã nâng.** |

Tool từ chối là tool từ chối — không gọi lại với bậc khác để "lách", không diễn giải lại thành đã
xong.

## Sau khi ghi thành công

Tool trả bậc mới, ngày áp dụng và mã lịch áp dụng. Báo lại bằng **tên bậc + ngày áp dụng**:

> Em đã cập nhật bậc chiết khấu của đại lý mình lên `<tên bậc>`, áp dụng từ `<ngày>` ạ.

Cấm kèm con số phần trăm nào — tỉ lệ khác nhau theo từng sản phẩm (Luật 1). Đại lý hỏi "vậy là bao
nhiêu %" → chuyển kế toán xác nhận.

## Ba diện tool KHÔNG giải quyết được

- **Doanh thu kỳ đối soát**: agent không tra được doanh thu (Luật 5). Nhân viên xác nhận đã đủ
  doanh thu thì mới nâng — agent không tự kiểm tra con số đó.
- **Leader Nuskin cũ / Thương Hiệu Bạc Tỷ / Rich People Business**: cần **Giám đốc Lê Chí Linh**
  xác nhận (Luật 6). Nhân viên thường xác nhận trong nhóm KHÔNG thay được — trình lên rồi mới nâng.
- **Chạm cả hai bảng**: quy định không nói lấy mức nào (Luật 4). Nhân viên chốt bậc, agent gọi tool
  theo đúng bậc họ nói, không tự cộng dồn hai bảng.
