// normalize.ts — gấp tiếng Việt có dấu về không dấu để TRA CỨU (tên lệnh, từ khoá lệnh con).
//
// Người gõ trên điện thoại có bộ gõ tiếng Việt: họ gõ `/lịch xóa`, không phải `/lich xoa`. Bắt
// nhớ gõ đúng dấu nào là bắt sai chỗ — dấu ở đây không mang thông tin, chỉ là cách viết.
//
// CHỈ dùng cho khoá tra cứu. Nội dung người dùng nhập (mô tả việc, tên khách) giữ NGUYÊN dấu.

/**
 * NFD tách dấu thanh/dấu mũ thành ký tự tổ hợp rồi bỏ đi. `đ/Đ` KHÔNG tách được bằng NFD (nó là
 * chữ cái riêng, không phải d + dấu) → thay tay.
 */
export function foldVietnamese(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}
