// reply-checks.ts — luật câu trả lời kiểm bằng code, root agent khai trong `replyChecks`.
//
// Mỗi check ở đây là một lỗi ĐÃ lọt ra production rồi mới sửa bằng prompt. Prompt vẫn giữ để model
// đúng ngay lần đầu; check là lưới cuối khi model quên. Thêm check mới = có transcript lỗi thật
// + test tái hiện trong reply-checks.test.ts.
//
// Chỉ bắt chữ không mơ hồ. Luật cần hiểu ý (xưng hô, nói thay chuyên môn…) KHÔNG để ở đây: regex
// bắt nhầm thì model bị bắt sửa câu đúng, tệ hơn không kiểm.

import type { ReplyCheck } from "./types.ts";

// NFC trước khi so: model và kênh có thể trả tiếng Việt dạng tổ hợp (NFD), regex dấu sẽ trượt.
function normalize(reply: string): string {
  return reply.normalize("NFC");
}

const DOCTOR_PATTERN = /bác\s+s[ĩỹ]|\bbs\b/iu;

/**
 * Nhóm xác nhận đơn gọi người xác nhận là "Bác Sơn" — không bao giờ "bác sĩ Sơn", "BS Sơn" hay
 * "chờ bác sĩ duyệt" (bdb12ad). "Bác Sơn" thì đạt: "s" + "ơ" không khớp "bác sĩ/sỹ".
 */
export const NO_DOCTOR_MENTION: ReplyCheck = {
  name: "no_doctor_mention",
  check: (reply) =>
    DOCTOR_PATTERN.test(normalize(reply))
      ? "Câu trả lời dùng chữ 'bác sĩ' hoặc 'BS'. Trong nhóm này gọi là 'Bác Sơn' — không bao giờ 'bác sĩ Sơn', 'BS Sơn'. Trạng thái ghi sổ nói 'đang chờ duyệt'."
      : undefined,
};

const AD_DISCLAIMER_PATTERN = /thay\s+thế\s+thuốc\s+chữa\s+bệnh/iu;

/**
 * Câu miễn trừ là câu bắt buộc của QUẢNG CÁO (video, bài đăng). Chèn vào tin chat thì trả lời
 * thành máy móc (7f145ba). Khách hỏi có thay thuốc được không thì nói bằng lời của mình.
 */
export const NO_AD_DISCLAIMER: ReplyCheck = {
  name: "no_ad_disclaimer",
  check: (reply) =>
    AD_DISCLAIMER_PATTERN.test(normalize(reply))
      ? "Câu trả lời chép câu miễn trừ của quảng cáo ('không có tác dụng thay thế thuốc chữa bệnh') — tin chat không dùng câu này. Bỏ câu đó; nếu khách vừa hỏi có thay thuốc được không thì trả lời tự nhiên bằng lời của mình."
      : undefined,
};
