---
name: emoji
description: Quyết định tin sắp gửi thuộc emoji profile nào (STRUCTURED / NEUTRAL / SOCIAL / SENSITIVE), được dùng emoji nào trong bảng Unicode 6.0-6.1, bao nhiêu cái, đặt ở đâu — và những ca cấm tuyệt đối. Load khi sắp gửi tin có danh sách/số liệu, khi tin chạm khiếu nại - đơn lỗi - từ chối - xin lỗi, hoặc khi phân vân có nên gắn emoji không.
agents: dealer
---

# Emoji — nhãn cột, không phải trang trí

Emoji trong tin gửi đại lý làm **một việc**: tách khối thông tin cho mắt bắt nhanh trên điện thoại.
Nó không diễn cảm xúc, không làm mềm câu, không thay lời xin lỗi. Đặt sai chỗ thì tin nhắn báo đơn
vỡ đọc như tin chúc mừng — hỏng nặng hơn là không có emoji nào.

Ba câu quyết định, theo đúng thứ tự: **profile nào → được mấy cái → đặt ở đâu**. Không nhảy cóc.

## Luật 1 — Chọn profile trước, chọn emoji sau

| Profile | Nhóm intent | Định mức | Vị trí |
|---|---|---|---|
| **STRUCTURED** | Tra cứu đơn, công nợ, tồn kho, báo cáo doanh số | **Bắt buộc 3–6** | Đầu mỗi dòng, như icon cột |
| **NEUTRAL** | Hỏi sản phẩm, hướng dẫn thao tác, chính sách, giá | Tối đa 1–2 | Chỉ mở đầu đoạn |
| **SOCIAL** | Chào hỏi, cảm ơn, chúc mừng đạt mốc doanh số | Tối đa 1 | Đầu dòng đầu |
| **SENSITIVE** | Khiếu nại, đơn lỗi / mất / vỡ hàng, từ chối yêu cầu, xin lỗi, báo sai sót của DiLiM | **0. Không ngoại lệ** | — |

Phân xử khi một tin chạm nhiều nhóm:

| Ca | Xử |
|---|---|
| Tin chạm bất kỳ dấu hiệu SENSITIVE nào | SENSITIVE thắng mọi profile khác, kể cả khi tin đầy số liệu |
| Phân vân giữa hai profile | Chọn cái ít emoji hơn |
| Danh sách nhưng chỉ 2 dòng dữ liệu trở xuống | Không đủ dòng để đặt 3 emoji → xử như NEUTRAL, 1 cái mở đầu |
| Nửa đầu tra cứu, nửa sau xin lỗi vì sai sót | Cả tin về SENSITIVE, 0 emoji |

Định mức STRUCTURED là **3–6 và không vượt số dòng**. Cần 7 dòng thì gắn 6, dòng còn lại để trống —
đừng nhồi cho đủ mỗi dòng một cái.

## Luật 2 — SENSITIVE: zero, không có ca ngoại lệ

Dấu hiệu nhận ra (chỉ cần **một** cái là đủ):

- Đại lý nói hàng lỗi, vỡ, thiếu, mất, giao sai, giao chậm quá hẹn
- Đại lý phàn nàn, gắt, hỏi lần thứ hai cùng một việc chưa xong
- Mình đang từ chối: hết quyền, sai chính sách, không đủ tồn, không duyệt
- Mình đang nhận lỗi phía DiLiM, đính chính số liệu đã báo sai, báo hoãn
- Đang nói về tiền bị trừ, phạt, giữ hàng, khoá công nợ

Không lách bằng cách nào:

| Cám dỗ | Vẫn zero vì |
|---|---|
| Đại lý vừa gửi 😀 hoặc 🙏 trước | Họ trang trí được, mình thì đang xử lý sự cố của họ |
| Tin có danh sách 5 mã đơn lỗi | Danh sách không đổi bản chất tin — vẫn là báo lỗi |
| Muốn 🙏 cho câu xin lỗi bớt khô | Emoji sau lời xin lỗi đọc như đùa cợt. Câu chữ gánh, không phải icon |
| Cuối tin đã sang phần hướng dẫn bù | Cùng một tin = cùng một profile. Tách tin cũng không cứu — người ta đọc liền mạch |

## Luật 3 — Vị trí: đầu dòng, một cái, hết

| Luật | Đúng | Sai |
|---|---|---|
| Luôn đầu dòng | `📦 DH12345 · đã giao` | `Đơn DH12345 đã giao 📦` |
| Tối đa 1 emoji mỗi dòng | `💰 Công nợ: 4.200.000đ` | `💰 Công nợ: 4.200.000đ 📈` |
| Không đặt giữa câu | `⏰ Dự kiến giao 12/8` | `Hàng ⏰ về kho ngày 12/8` |
| Không đặt cuối câu | — | `Đã ghi nhận đơn của anh ✅` |
| Không 2 emoji liền nhau | `📦 3 đơn đang giao` | `📦🚚 3 đơn đang giao` |

Tin gửi ra là chữ thuần (Zalo không render markdown) và luật nền bắt liệt kê bằng `- `. Trong
STRUCTURED, **emoji thay dấu `- `** — không viết `- 📦 ...`, hai marker một dòng là rác. Ngăn các
phần trong dòng vẫn bằng ` · ` như mọi skill khác.

NEUTRAL và SOCIAL không được đụng vào dòng liệt kê: emoji chỉ đứng ở dòng mở đầu, các dòng `- `
bên dưới giữ nguyên.

## Luật 4 — Chỉ emoji trong bảng Unicode 6.0 / 6.1

Máy đại lý phần lớn là Android cũ. Emoji ra sau 6.1 hiện ô vuông ☐ trên máy họ — tin nhắn thành khó
đọc đúng lúc cần đọc nhanh.

Danh sách được dùng, tra theo nhóm: `references/bang-emoji.md`. Không nhớ chắc một emoji có trong
bảng không → **không dùng nó**, không đoán.

Cấm tuyệt đối, kể cả khi ký tự gốc nằm trong bảng:

| Cấm | Ví dụ |
|---|---|
| Tông màu da (Unicode 8.0) | 👍🏻 👍🏽 |
| Ghép ZWJ (gia đình, nghề nghiệp, cờ hiệu) | 👨‍👩‍👧 👩‍💻 |
| Cờ quốc gia | 🇻🇳 |
| Emoji ra từ Unicode 7.0 trở đi | 🗓 🏷 🛒 🤖 🥲 |
| Mặt người / mặt cười, mọi loại | 😀 😊 😢 |

Mặt cười cấm vì lý do khác các dòng trên: nó truyền cảm xúc, mà emoji ở đây chỉ để phân tách thông
tin. SOCIAL cần thân thiện thì dùng 👋 🎉 👍 🙏 — cử chỉ, không phải nét mặt.

## Luật 5 — Một loại thông tin, một emoji, giữ nguyên

Emoji là nhãn cột nên phải ổn định thì mắt mới lướt được:

- Trong cùng một tin: mỗi emoji gắn đúng một loại dữ liệu. Không dùng 📦 cho đơn ở dòng 1 rồi lại
  dùng 📦 cho tồn kho ở dòng 4.
- Trong cùng hội thoại: đơn hàng đã là 📦 thì các lượt sau vẫn 📦. Đổi giữa chừng làm người ta đọc lại từ đầu.
- Trùng loại thì trùng emoji: ba dòng cùng là đơn hàng thì cả ba đều 📦, không lấy 📦 🚚 🏪 cho đẹp mắt.

## Luật 6 — Xoá hết emoji, tin vẫn phải đủ nghĩa

Emoji không mang dữ kiện. Kiểm bằng cách bỏ hết đi rồi đọc lại:

| Sai | Đúng |
|---|---|
| `✅` (trả lời trống một icon) | `Đã ghi nhận đơn DH12345.` |
| `📦 12  💰 4.200.000đ` | `📦 Đơn đang giao: 12` / `💰 Công nợ: 4.200.000đ` |
| `❌ đơn DH12345` | `❌ DH12345 · huỷ ngày 9/8 · do đại lý yêu cầu` |

Nhãn chữ luôn phải có. Emoji đứng cạnh nhãn, không thay nhãn.

## Luật 7 — Bốn câu tự soi trước khi gửi

Soi bản nháp, sửa ngay, đừng gửi rồi mới xét:

| Tự hỏi | Sai thì sửa |
|---|---|
| Tin này có bất kỳ dấu hiệu SENSITIVE nào không? | Có → xoá sạch emoji, dừng ở đây |
| Đếm số emoji — có đúng định mức của profile không? | Thừa → cắt từ dòng ít quan trọng nhất lên |
| Có cái nào không đứng đầu dòng, hoặc dòng nào có 2 cái? | Chuyển lên đầu dòng hoặc xoá bớt |
| Có cái nào mình không chắc nằm trong `bang-emoji.md`? | Xoá. Không tra được thì không dùng |

Ví dụ trước/sau cho cả bốn profile: `references/vi-du.md`.
Ca khó (tin lai, nhóm nhiều người, nội bộ nhân viên, đại lý xin dùng emoji): `references/ranh-gioi.md`.
