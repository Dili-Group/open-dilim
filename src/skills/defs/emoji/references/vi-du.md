# Ví dụ trước / sau — bốn profile

Dữ kiện giữ nguyên trong mọi cặp. Chỉ khác chỗ đặt và số lượng emoji.

## STRUCTURED — tra cứu đơn (bắt buộc 3–6, đầu dòng)

Đại lý: "check giúp 3 đơn hôm qua"

Sai — emoji cuối câu, có dòng 2 cái, có dòng không nhãn:

```
Dạ 3 đơn hôm qua của anh đây ạ 📦
- DH12001 đã giao ✅
- DH12002 🚚📦 đang giao
- DH12003 chờ lấy hàng
```

Đúng — emoji thay `- `, mỗi dòng một cái, cùng loại dùng cùng emoji:

```
3 đơn ngày 9/8:
📦 DH12001 · đã giao · 2.400.000đ
📦 DH12002 · đang giao · dự kiến 11/8
📦 DH12003 · chờ lấy hàng
```

Cần phân biệt trạng thái thì đổi sang nhóm trạng thái, vẫn một emoji một dòng:

```
Đơn ngày 9/8:
✅ DH12001 · đã giao · 2.400.000đ
🚚 DH12002 · đang giao · dự kiến 11/8
⏳ DH12003 · chờ lấy hàng
```

## STRUCTURED — công nợ

```
🔍 Công nợ đại lý Bình Dương tính tới 10/8:
💰 Tổng dư nợ: 12.400.000đ
📅 Hạn thanh toán gần nhất: 15/8
📦 Đơn chưa đối soát: 3
```

Bốn emoji, bốn loại dữ liệu khác nhau, không cái nào lặp — đúng luật 5.

## NEUTRAL — hỏi chính sách (tối đa 1–2, chỉ mở đầu đoạn)

Đại lý: "chiết khấu bậc 2 là bao nhiêu %"

Sai — gắn emoji vào từng dòng liệt kê như STRUCTURED:

```
📌 Chiết khấu bậc 2 là 12%.
💰 Áp dụng khi doanh số tháng đạt 50 triệu.
📅 Tính lại vào ngày 1 hàng tháng.
```

Đúng — một emoji mở đầu, các dòng dưới giữ dấu `- ` của luật nền:

```
📌 Chiết khấu bậc 2 là 12%.
- Điều kiện · doanh số tháng đạt 50 triệu
- Tính lại · ngày 1 hàng tháng
```

## SOCIAL — chúc mừng (tối đa 1)

Sai:

```
🎉 Chúc mừng đại lý đạt mốc 100 triệu tháng 7 🎉🏆
```

Đúng:

```
🎉 Đại lý đạt mốc 100 triệu doanh số tháng 7. Chiết khấu bậc 3 áp dụng từ 1/8.
```

## SENSITIVE — đơn vỡ hàng (0, kể cả khi có danh sách)

Sai — có danh sách nên tưởng là STRUCTURED, lại thêm 🙏 cho câu xin lỗi:

```
📦 DH12005 · 2 hộp vỡ
📦 DH12007 · 1 hộp vỡ
🙏 Em xin lỗi anh ạ
```

Đúng — cùng dữ kiện, cùng cấu trúc dòng, không emoji:

```
2 đơn có hàng vỡ, lỗi từ khâu đóng gói bên em:
- DH12005 · 2 hộp
- DH12007 · 1 hộp
Em đã tạo phiếu bù hàng, hàng bù đi cùng chuyến 12/8.
```

## SENSITIVE — từ chối yêu cầu

Sai:

```
❌ Đơn này quá 7 ngày nên không đổi trả được ạ 🙏
```

Đúng:

```
Đơn DH11980 giao ngày 30/7, quá hạn đổi trả 7 ngày nên em không mở được yêu cầu này.
Trường hợp lỗi nhà sản xuất thì không tính hạn — anh gửi em ảnh tem lô là em chuyển bộ phận kiểm.
```
