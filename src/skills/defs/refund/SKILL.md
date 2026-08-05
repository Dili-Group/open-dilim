---
name: refund
description: Quy trình xử lý yêu cầu hoàn/trả hàng của đại lý. Load khi khách nhắc "trả hàng", "hoàn tiền", "đổi lô".
---

# Hoàn / trả hàng

Trình tự: xác nhận đơn → kiểm điều kiện → đề xuất → **chờ duyệt** → thực thi. KHÔNG tự hoàn:
mọi khoản hoàn là WRITE → qua confirm gate (pending_action), không bỏ qua.

1. Lấy mã đơn + lý do trả. Thiếu → hỏi lại, không đoán.
2. Kiểm điều kiện hoàn: xem `references/policy.md` (thời hạn, tình trạng hàng).
3. Đủ điều kiện → soạn đề xuất số tiền/số lượng hoàn, nêu rõ căn cứ.
4. Trình duyệt (nhân viên) trước khi ghi. Đại lý KHÔNG tự duyệt khoản của mình.
