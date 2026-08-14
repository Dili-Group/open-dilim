// qr.ts — tách link QR chuyển khoản (SePay) ra khỏi câu trả lời để gửi dạng ẢNH thay vì text.
// Lý do: link QR dán vào Zalo chỉ là chữ, đại lý phải bấm mở trình duyệt rồi mới quét được —
// gửi thẳng ảnh QR thì quét ngay trong khung chat. URL qr.sepay.vn/img trả PNG nên dùng luôn
// làm imageUrl, không cần render gì thêm.

import type { OutboundMedia } from "./types.ts";

// Chỉ bắt QR SePay — nguồn duy nhất hệ này sinh ra link QR chuyển khoản (payment.ts /
// payment-batch.ts). Không bắt URL ảnh chung chung: câu trả lời có thể chứa link khác
// (bill khách gửi, tra cứu…) mà đại lý cần giữ nguyên dạng text.
const QR_URL_PATTERN = /https:\/\/qr\.sepay\.vn\/img\?[^\s"'<>()[\]]+/g;
// Model hay bọc link kiểu markdown `[Link QR](https://…)` — gỡ cả vỏ, không chỉ URL bên trong.
const QR_MARKDOWN_PATTERN = /\[[^\]\n]*\]\((https:\/\/qr\.sepay\.vn\/img\?[^\s)]+)\)/g;
// Nhãn mồ côi sau khi rút URL: "Link QR:", "- QR:", "• Mã QR :"… — dòng chỉ còn nhãn thì xoá.
const ORPHAN_LABEL_LINE = /^[\s\-*•+·]*(?:link\s*)?(?:mã\s*)?qr[\s:：\-–]*$/i;

export interface QrExtraction {
  /** Text đã rút hết link QR + dọn nhãn/dòng trống mồ côi. */
  readonly text: string;
  /** Mỗi URL QR (đã dedupe, giữ thứ tự xuất hiện) thành một ảnh gửi kèm. */
  readonly media: readonly OutboundMedia[];
}

/**
 * Rút link QR SePay khỏi câu trả lời. Không có link → trả nguyên văn, media rỗng —
 * caller cứ gọi vô điều kiện, không cần tự dò trước.
 */
export function extractQrMedia(text: string): QrExtraction {
  const urls: string[] = [];
  const collect = (url: string): string => {
    if (!urls.includes(url)) urls.push(url);
    return "";
  };

  let stripped = text.replace(QR_MARKDOWN_PATTERN, (_match, url: string) => collect(url));
  stripped = stripped.replace(QR_URL_PATTERN, (url) => collect(url));

  if (urls.length === 0) return { text, media: [] };

  const lines = stripped
    .split("\n")
    .filter((line) => !ORPHAN_LABEL_LINE.test(line))
    .map((line) => line.trimEnd());
  // Rút link xong hay để lại lỗ hổng dòng trống liền nhau — gom về một dòng cho sạch.
  const cleaned = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return {
    text: cleaned,
    media: urls.map((url) => ({ type: "image", url })),
  };
}
