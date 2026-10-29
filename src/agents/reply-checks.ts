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

// Biên chữ dựng tay: `\b` của JS chỉ hiểu ASCII, đứng sau "é" là trượt. Chừa "nha khoa", "nha sĩ",
// "Nha Trang" — khách lẻ nhắc tới thật (đi nha sĩ, ship ra Nha Trang).
const CASUAL_CLOSING_PATTERN =
  /(?<![\p{L}\p{M}\p{N}])(?:nhé|nhe|nha)(?![\p{L}\p{M}\p{N}])(?!\s+(?:khoa|sĩ|sỹ|trang)(?![\p{L}\p{M}]))/iu;

/**
 * Khách lẻ: kết câu bằng "ạ", không bao giờ "nhé/nha" — câu mẫu trong skill từng dạy "nha cô",
 * model chép theo.
 */
export const NO_CASUAL_CLOSING: ReplyCheck = {
  name: "no_casual_closing",
  check: (reply) =>
    CASUAL_CLOSING_PATTERN.test(normalize(reply))
      ? "Câu trả lời dùng 'nhé', 'nha' hoặc 'nhe' với khách. Với khách lẻ kết câu bằng 'ạ' (\"cô chụp giúp con chỗ hộp móp ạ\"), đáp đồng ý thì 'Vâng ạ'. Bỏ hết 'nhé/nha/nhe', giữ nguyên ý."
      : undefined,
};

const STOP_ADVICE_PATTERN =
  /(?<![\p{L}\p{M}])(?:(?:ngưng|ngừng|dừng)\s+(?:dùng|uống|sử\s+dụng|sản\s+phẩm|hộp|thuốc)|(?:đừng|không\s+nên)\s+(?:dùng|uống)\s+(?:tiếp|nữa|thêm))(?![\p{L}\p{M}])/iu;
// Không cờ `i`: chữ hoa sau "ngưng" là tên sản phẩm ("anh vẫn ngưng AFCRICH").
const STOP_PRODUCT_PATTERN = /(?<![\p{L}\p{M}])[Nn]g[ưừ]ng\s+\p{Lu}/u;
const EXPIRY_PATTERN = /(?:quá|hết)\s+hạn|hạn\s+(?:sử\s+dụng|dùng)/iu;

/**
 * Khách lẻ: khuyên ngưng sản phẩm chỉ đúng khi hộp đã quá hạn — câu đó luôn nói chữ "hạn", nên
 * thiếu chữ đó là sai mà không cần hiểu ý. Lọt ra OA: khách kể "đau" + "đã uống AFCRICH" → agent bảo
 * ngưng trước khi biết đau ở đâu (đau ngón chân).
 */
export const NO_STOP_ADVICE: ReplyCheck = {
  name: "no_stop_advice",
  check: (reply) => {
    const text = normalize(reply);
    const advisesStop = STOP_ADVICE_PATTERN.test(text) || STOP_PRODUCT_PATTERN.test(text);
    return advisesStop && !EXPIRY_PATTERN.test(text)
      ? "Câu trả lời khuyên khách ngưng dùng sản phẩm. Mình không biết triệu chứng có liên quan sản phẩm hay không — chỉ được khuyên ngưng khi hạn in trên hộp đã qua. Bỏ câu khuyên ngưng; hỏi rõ thêm (đau ở đâu, từ khi nào, có từ trước khi uống không) hoặc xin số chuyển bạn phụ trách. Dấu hiệu cấp thì khuyên đi khám ngay."
      : undefined;
  },
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
