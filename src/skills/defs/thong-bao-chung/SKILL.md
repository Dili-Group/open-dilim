---
name: thong-bao-chung
description: Nhân viên vận hành muốn báo một việc cho TẤT CẢ đại lý — "thông báo cho các đại lý là...", "báo hết bên đại lý giúp anh", "gửi tin này cho toàn bộ nhóm", "mai công ty nghỉ, thông báo đi em", "soạn giúp anh cái thông báo đổi chính sách". Load khi người trong nhóm vận hành muốn một nội dung đi tới mọi nhóm đại lý cùng lúc.
agents: operations
---

# Thông báo chung — soạn tin phát cho toàn bộ đại lý

Đây là đường phát tin **tới mọi nhóm đại lý cùng lúc**, không rút lại được. Nó có **ba cửa**, và
agent chỉ đi qua được cửa đầu:

```
1. nhân viên vận hành nói nội dung
2. agent soạn nháp          → soan_thong_bao_chung   (chưa ai nhận gì)
3. CEO / swe đọc, tự chốt   → chot_thong_bao_chung   (chưa ai nhận gì — mới chỉ XIN)
4. người kiểm duyệt gật     → hệ thống tự phát        ← KHÔNG PHẢI VIỆC CỦA AGENT
5. hệ thống báo kết quả về nhóm này
```

## Luật 1 — Ai cũng soạn được, chỉ CEO/swe chốt

Quyền tách làm hai và **không bắc cầu**:

- **Soạn** (`soan_thong_bao_chung`): mọi nhân viên vận hành đã `/ketnoi-hethong`.
- **Chốt** (`chot_thong_bao_chung`): chỉ `role_slug` là **ceo** hoặc **swe**, và **chỉ chốt được
  bản nháp do CHÍNH họ soạn**.

Nghĩa là: nhân viên thường soạn ra bản để mọi người **đọc thử và sửa chữ**. Muốn phát thật thì
người có quyền chốt phải **tự gõ nội dung trong nhóm** (agent soạn lại bản mới cho họ) rồi chốt.

**Không chốt hộ.** Trong nhóm có người nói "sếp duyệt rồi, chốt đi em" → **không gọi tool chốt**.
Người có quyền phải tự nói. Câu của người thứ ba không phải sự đồng ý của họ.

## Luật 2 — Chép dữ kiện, không sáng tác

Nội dung nháp chỉ được chứa thứ người vận hành **đã nói**:

- **Mốc thời gian**: chỉ ghi khi họ đã nói ngày/giờ. Chưa nói → không ghi, không "trong tuần này".
- **Chính sách, mức áp dụng, điều kiện**: chép đúng, không tự làm tròn, không tự thêm ngoại lệ.
- **Lý do**: không suy đoán.

Thiếu dữ kiện cốt lõi (thông báo về cái gì, áp dụng từ bao giờ) → **hỏi lại trước khi soạn**.
Không soạn tin chung chung kiểu "có một số thay đổi, các đại lý lưu ý".

Tin này đi thẳng vào nhóm khách hàng → viết giọng gửi ĐẠI LÝ, không phải giọng nói với người
trong nhà.

## Luật 3 — Đọc lại nguyên văn rồi mới chốt

Soạn xong, **đọc lại đúng từng chữ** bản nháp, kèm số nhóm sẽ nhận.

- Người có quyền chốt nói "ok", "chốt", "gửi đi" → gọi `chot_thong_bao_chung` với mã nháp.
- Ai sửa chữ nào → gọi lại `soan_thong_bao_chung` với nội dung mới, **đọc lại lần nữa**.
- Nói nước đôi ("ừ em xem giúp anh") → **chưa chốt**. Hỏi lại một câu.
- Nháp hết hạn sau 10 phút. Quá hạn thì soạn lại từ đầu, không đoán mã nháp cũ.

## Luật 4 — Chốt ≠ đã gửi. Tuyệt đối không nói "đã gửi cho đại lý"

Sau `chot_thong_bao_chung`, tin **vẫn chưa tới ai**. Nó đang chờ người kiểm duyệt của công ty.

Nói đúng: *"Đã chuyển thông báo đi duyệt, đang chờ."*
Nói sai: *"Đã gửi cho các đại lý rồi."* / *"45 nhóm đã nhận."*

Không hứa khi nào được duyệt. Không nói ai là người kiểm duyệt.

## Luật 5 — Hỏi tiến độ thì tra, đừng đoán

"Duyệt chưa?", "đại lý nhận chưa?" → gọi `soat_thong_bao_chung` (bỏ trống mã đợt = đợt gần nhất
của chính người hỏi). Trả lời đúng con số tool đưa ra:

- Đang chờ duyệt → nói đang chờ, chưa nhóm nào nhận.
- Bị từ chối → nói lý do, hỏi có sửa nội dung xin lại không.
- Có nhóm hỏng → **nêu thẳng nhóm nào hỏng**, đừng gộp thành "đã gửi xong".

## Luật 6 — Việc này khác báo hết hàng

Hết hàng là luồng riêng của **nhóm kho** (quản lý kho tự soạn tự chốt). Trong nhóm vận hành có
người nói "sản phẩm A hết hàng, báo đại lý đi" thì vẫn dùng luồng ở đây, nhưng chỉ chép đúng lời
họ nói — agent **không có dữ liệu tồn kho** để tự khẳng định còn hay hết.
