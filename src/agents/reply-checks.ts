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
      ? "Câu trả lời khuyên khách ngưng dùng sản phẩm. Mình không biết triệu chứng có liên quan sản phẩm hay không — chỉ được khuyên ngưng khi hạn in trên hộp đã qua. Bỏ câu khuyên ngưng; không hỏi bệnh, xin số chuyển bạn phụ trách."
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

const MEDICAL_ADVICE_PATTERN =
  /(?<![\p{L}\p{M}])(?:đi\s+khám|khám\s+(?:bệnh|ngay)|bệnh\s+viện|cấp\s+cứu|bác\s+s[ĩỹ]|chỉ\s+định|chẩn\s+đoán|chuyên\s+gia\s+y\s+tế)(?![\p{L}\p{M}])/iu;

/**
 * Khách lẻ: không tư vấn bệnh — khách nhắc tới bệnh, thuốc, triệu chứng thì xin số để bạn phụ
 * trách gọi lại, không bảo "hỏi bác sĩ", "đi khám", "dùng theo chỉ định", không chẩn đoán. Chữ
 * "chữa/điều trị" KHÔNG bắt: ca khách kể lời bạn tư vấn cần đúng câu "hỗ trợ, không phải thuốc
 * điều trị". Không có ngoại lệ, kể cả dấu hiệu cấp — chủ quyết vậy, bạn phụ trách
 * gọi lại xử lý. Lọt ra OA ba lần: "không dùng để trị bệnh… hỏi bác sĩ điều trị", "nên đi khám để
 * có chẩn đoán rõ hơn", "với bệnh dạ dày nên đi khám và dùng theo chỉ định của bác sĩ".
 */
export const NO_MEDICAL_ADVICE: ReplyCheck = {
  name: "no_medical_advice",
  check: (reply) =>
    MEDICAL_ADVICE_PATTERN.test(normalize(reply))
      ? "Câu trả lời tư vấn bệnh (bảo hỏi bác sĩ, đi khám, bệnh viện, cấp cứu, dùng theo chỉ định, chuyên gia y tế, hoặc chẩn đoán). Với khách lẻ KHÔNG bàn chuyện bệnh: bỏ các câu đó, ghi nhận ngắn rồi xin số điện thoại để bạn phụ trách gọi lại trao đổi. Kể cả dấu hiệu cấp cũng không khuyên đi khám — xin số, báo sẽ chuyển gấp bạn phụ trách."
      : undefined,
};

const CONTRADICT_CONSULTANT_PATTERN =
  /(?:không|chưa)\s+(?:có|thấy)\s+thông\s+tin\s+(?:nào\s+)?(?:cho\s+thấy|về)|không\s+(?:thể\s+)?xác\s+nhận\s+(?:(?:điều|việc|chuyện)\s+(?:đó|này)|được)|không\s+có\s+tác\s+dụng\s+(?:đó|này|vậy|như\s+vậy)/iu;

/**
 * Khách kể "bạn tư vấn nói sản phẩm hỗ trợ X": sản phẩm CÓ tác dụng hỗ trợ, chỗ sai chỉ là cách
 * diễn đạt quá mức. Phủ nhận ("em không có thông tin", "không xác nhận được") là khách hiểu công ty
 * chối cả lời tư vấn lẫn giá trị sản phẩm — thấy bị lừa. Nhận "bên em diễn đạt chưa chính xác"
 * thì được, đó là bước 3 của luật, không phải phủ nhận.
 * Lọt ra OA: "Em không có thông tin nào cho thấy sản phẩm này hỗ trợ đau bao tử, nên em không xác
 * nhận điều đó được ạ".
 */
export const NO_CONTRADICT_CONSULTANT: ReplyCheck = {
  name: "no_contradict_consultant",
  check: (reply) =>
    CONTRADICT_CONSULTANT_PATTERN.test(normalize(reply))
      ? "Câu trả lời phủ nhận công dụng sản phẩm ('không có thông tin', 'không xác nhận được', 'không có tác dụng đó') — khách sẽ thấy bị lừa. Làm đủ 4 bước: (1) xác nhận công dụng hỗ trợ đúng như công bố trong references/san-pham.md; (2) nói rõ là hỗ trợ, không phải thuốc điều trị bệnh đó; (3) nhận phần diễn đạt chưa chính xác về phía bên em và xin lỗi; (4) xin số để bạn phụ trách gọi lại giải thích kỹ."
      : undefined,
};
