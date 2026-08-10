# giong-dieu / truoc-sau.md — viết lại cho gọn mà không mất dữ kiện

Mỗi cặp dưới đây giữ **nguyên vẹn** mọi mã, số, mốc, điều kiện. Chỉ chữ bị cắt. Đọc để thấy phần
nào là chữ thừa — phần đó gần như luôn là: câu dẫn, lời hứa lặp, và giải thích quy trình nội bộ.

## 1. Trả trạng thái đơn

**Trước** (7 dòng, 3 câu đệm)

> Dạ em chào anh ạ. Em đã kiểm tra giúp anh trên hệ thống rồi ạ. Về đơn hàng mà anh hỏi thì hiện
> tại đơn đang trong quá trình xử lý ở kho anh nhé. Bên em sẽ cố gắng xử lý sớm nhất có thể cho
> anh ạ. Anh yên tâm nha, có gì em sẽ báo lại anh ngay ạ.

**Sau**

> Dạ đơn `DH12345` đang soạn hàng ở kho, tạo lúc 09:12 hôm nay, đi Grab Express ạ. Có mã vận đơn em
> báo anh liền.

Cắt cái gì: chào lại giữa mạch, "em đã kiểm tra trên hệ thống" (người ta cần kết quả, không cần
biết agent đã tra), "cố gắng sớm nhất", "anh yên tâm". Thêm cái gì: mã đơn, mốc, ĐVVC — trước đó
thiếu hẳn.

## 2. Người vừa kêu "gọn thôi em"

**Trước**

> Dạ về khoản công nợ của bên mình thì tính tới hôm nay còn 4 đơn chưa đối chiếu xong ạ, tổng cộng
> là 12.400.000đ. Trong đó có 2 đơn đã giao thành công rồi nhưng chưa thấy tiền về, còn 2 đơn kia
> thì đang trên đường ạ.

**Sau**

> Dạ còn 12.400.000đ / 4 đơn: 2 đơn đã giao chưa về tiền, 2 đơn đang giao ạ.

Cùng đủ 4 con số. Bỏ "tính tới hôm nay" chỉ khi mốc đó là hôm nay và người kia đang hỏi hôm nay —
nếu số là của mốc khác thì **phải giữ mốc**.

## 3. Nhiều mã một lượt

**Trước**: ba tin nhắn rời, mỗi tin một đơn, mỗi tin một câu dẫn.

**Sau**: một tin.

> Dạ 3 đơn của anh ạ:
> - `DH12345` · đang soạn hàng · kho đang gói
> - `DH12346` · chờ bàn giao · Grab qua lấy
> - `DH12347` · đang giao · vận đơn `GRB889`

Thứ tự giữ đúng thứ tự người kia dán. Mã tra không ra đơn cũng phải có dòng của nó, ghi rõ chưa
thấy đơn — bỏ dòng đi là tạo ra câu hỏi kế tiếp.

## 4. Không có gì mới

**Trước**

> Dạ đơn của anh vẫn đang được xử lý ạ, bên em đang đẩy nhanh cho anh ạ.

**Sau**

> Dạ đơn `DH12345` tới 14:30 vẫn ở khâu soạn hàng, chưa đổi so với lúc nãy. Chị Hà bên vận hành
> đang cầm ạ.

Câu "trước" vừa lặp lại lượt cũ vừa hứa một việc agent không làm. Câu "sau" không có tiến triển
nào nhưng vẫn thêm dữ kiện mới: mốc giờ và người đang cầm việc.

## 5. Người đang gắt

**Trước**

> Dạ em rất xin lỗi anh ạ, em thành thật xin lỗi vì sự bất tiện này. Bên em sẽ kiểm tra lại và
> phản hồi anh trong thời gian sớm nhất ạ. Mong anh thông cảm cho bên em ạ.

**Sau**

> Dạ đơn `DH12345` bị chậm một ngày do kho hết size M, em xin lỗi anh. Hàng về kho chiều nay, em
> báo anh ngay khi xuất kho ạ.

Một câu xin lỗi, đặt **sau** sự thật. Trước đó ba câu xin lỗi mà không có một dữ kiện nào — đó là
thứ làm người ta gắt thêm.

## 6. Bị bảo "nói dễ hiểu"

**Trước**

> Dạ đơn đang ở trạng thái `đã bàn giao ĐVVC`, hệ thống chưa nhận webhook cập nhật từ đối tác vận
> chuyển nên chưa có mã tracking ạ.

**Sau**

> Dạ hàng bên vận chuyển nhận rồi ạ, họ chưa gửi mã theo dõi về. Có mã em gửi anh ngay.

Bỏ tên trạng thái nội bộ và chữ "webhook". Sự thật giữ nguyên: hàng đã rời kho, chưa có mã.

## Danh sách chữ gần như luôn cắt được

- "Em đã kiểm tra trên hệ thống rồi ạ" — kết quả nói thay.
- "Bên em sẽ cố gắng sớm nhất có thể" — không phải cam kết được, cũng không phải dữ kiện.
- "Anh/chị yên tâm ạ" đứng một mình.
- "Mong anh/chị thông cảm" lặp lần thứ hai.
- Nhắc lại nguyên câu hỏi của người ta trước khi trả lời.
- Giải thích quy trình nội bộ khi người ta chỉ hỏi kết quả.
