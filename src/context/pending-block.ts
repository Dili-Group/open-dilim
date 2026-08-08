// pending-block.ts — khối "VIỆC NHÓM NÀY ĐANG ĐƯỢC HỎI" (§6) trong system prompt.
//
// TẠI SAO PHẢI CÓ: việc treo sống 1-2 NGÀY, còn cửa sổ history chỉ giữ vài chục lượt gần nhất.
// Câu hỏi hệ thống đã gửi hôm kia trôi mất từ lâu; đúng lúc người ta trả lời "đơn đó là VTP123
// nhé" thì model không còn manh mối nào để biết đó là trả lời cho việc gì. Khối này bơm lại danh
// sách việc đang chờ vào MỖI lượt, nên câu trả lời đến muộn cỡ nào cũng bắt được.
//
// KHÔNG dựa vào tool `viec_dang_cho` cho việc này: tool chỉ chạy khi model NGHĨ RA là phải gọi —
// mà lúc nguy hiểm nhất chính là lúc model không biết có việc gì để mà hỏi.

const HEADER = "VIỆC NHÓM NÀY ĐANG ĐƯỢC HỎI (chưa trả lời):";
const FOOTER =
  "Người trong nhóm vừa cung cấp đúng thông tin nào ở trên → gọi tool `tra_loi_viec` NGAY, " +
  "chép khoá nguyên văn. Họ nói chuyện khác thì cứ trả lời bình thường, TUYỆT ĐỐI KHÔNG thúc ép.";

/** Một việc đang chờ, đã rút gọn cho khối ngữ cảnh — context/ không import tầng workflows. */
export interface PendingNotice {
  /** Slug workflow — model truyền lại vào `ma_viec`. */
  readonly workflow: string;
  /** Khoá — model truyền lại vào `khoa`. Việc không có khoá thì không nạp vào đây. */
  readonly subject: string;
  /** Vd "mã đơn hoàn". */
  readonly subjectLabel: string;
  /** Vd "mã đơn gốc" — thứ đang chờ nhận. */
  readonly answerLabel: string;
}

/** Rỗng → chuỗi rỗng (assembler tự bỏ khối rỗng), KHÔNG in "không có việc nào" cho tốn context. */
export function renderPendingBlock(notices: readonly PendingNotice[]): string {
  if (notices.length === 0) return "";
  return [HEADER, ...notices.map(renderNotice), FOOTER].join("\n");
}

function renderNotice(notice: PendingNotice): string {
  return (
    `- ${notice.subjectLabel} "${notice.subject}" — đang chờ ${notice.answerLabel}. ` +
    `Trả lời bằng: tra_loi_viec(ma_viec="${notice.workflow}", khoa="${notice.subject}", tra_loi=<${notice.answerLabel}>)`
  );
}
