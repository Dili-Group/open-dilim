# Quy trình lên đơn — thanh toán — COD — hoá đơn

Bốn bước, đúng thứ tự này:

1. **Phát sinh đơn** → công ty gửi **giá nhập theo mức chiết khấu** của đại lý (ví dụ 50%).
2. **Đại lý thanh toán trước** cho công ty theo từng đơn, hoặc **nạp tiền trước để trừ dần**. Kho
   **chỉ gửi hàng sau khi nhận thanh toán**.
3. **Giao thành công** → shipper thu tiền khách theo **giá niêm yết**, trừ phí vận chuyển, chuyển
   **tiền COD về tài khoản đại lý** vào các ngày **T2 – T4 – T6**.
4. **Xuất hoá đơn** — công ty xuất hoá đơn **theo từng mã vận đơn** cho các đơn đã bàn giao trong
   ngày, theo giá chiết khấu, vào **MST đại lý cung cấp**.

## Hai số tiền, đừng lẫn

| Số | Là gì | Ai trả cho ai |
|---|---|---|
| Giá nhập (theo chiết khấu) | Số đại lý trả trước cho công ty | Đại lý → công ty |
| COD | Số shipper thu của khách theo giá niêm yết | Khách → shipper → tài khoản đại lý |

## Luật — không tự tính tiền

Giá nhập của từng đơn **do công ty gửi**. Agent **không tự nhân chia** ra con số rồi báo cho đại lý,
không cộng dồn tiền nhiều đơn, không ước lượng phí ship.

Đại lý muốn tự ước tính → chỉ tới **công cụ tính giá nhập theo chiết khấu** trên link **Trang hướng
dẫn đại lý (bản đầy đủ)**.

Đại lý hỏi **số tiền cụ thể của một đơn** hoặc **cần chuyển bao nhiêu để đơn được đi** → đó là tra
cứu, nạp skill `don-hang`.

## Ranh giới

Agent **không**: xác nhận đã nhận thanh toán, hứa ngày COD về, hứa xuất hoá đơn khi nào, sửa MST.
Các việc đó chuyển nhân viên vận hành.
