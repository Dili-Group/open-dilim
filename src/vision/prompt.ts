// prompt.ts — khung câu hỏi gửi cho con đọc ảnh.
//
// Vì sao không đưa thẳng câu hỏi của agent xuống model: chất lượng đọc ảnh phụ thuộc gần như hoàn
// toàn vào cách hỏi, mà câu agent tự viết mỗi lượt một khác. Khung này là phần CỐ ĐỊNH (luật chống
// bịa, cách đánh dấu chữ không đọc được, dạng trả lời); phần BIẾN ĐỘNG theo ngữ cảnh là `question`
// và `knownFacts` do agent cấp.
//
// Bốn luật dưới đây không phải viết cho đẹp, mỗi luật chặn một kiểu hỏng đã được đo:
//   - Model có xu hướng BỊA một chuỗi hợp lý (mã đơn, số hoá đơn) khi ảnh không có, chỉ để lấp chỗ
//     trống của câu hỏi → luật 3 buộc nói "không có trong ảnh".
//   - Chữ mờ/bị che mà không có cách đánh dấu thì model đoán → luật 2 cho nó chỗ để nói "không rõ".
//   - Trộn thứ NHÌN THẤY với thứ SUY RA khiến agent trích số suy đoán như số thật → luật 5 tách hai.
//   - Số tiền/mã bị "sửa cho đẹp" (làm tròn, bỏ dấu chấm) là sai dữ kiện nghiệp vụ → luật 4.
//
// Thứ tự khối theo hướng dẫn thiết kế prompt của Google: bối cảnh + luật TRƯỚC, việc cần làm ĐẶT
// CUỐI — phần đứng cuối là phần model bám sát nhất.

/** Phần biến động theo lượt: agent muốn biết gì, và hệ thống đã biết sẵn gì để đối chiếu. */
export interface ImagePromptInput {
  /** Việc cần lấy ở ảnh, do agent viết theo ngữ cảnh đang hỏi. */
  readonly question: string;
  /**
   * Dữ kiện hệ thống ĐÃ BIẾT (mã đơn vừa tra được, số tiền phải chuyển...). Có thì model đối chiếu
   * thay vì đọc chay — cách rẻ nhất để giảm bịa. undefined = không có gì để đối chiếu.
   */
  readonly knownFacts?: string;
}

const ROLE_AND_SCOPE = [
  "Bạn đọc ảnh cho trợ lý của một công ty phân phối. Ảnh thường là: phiếu/biên lai chuyển khoản",
  "ngân hàng, ảnh chụp màn hình phần mềm bán hàng, đơn hàng in ra, phiếu giao hàng, ảnh sản phẩm",
  "hoặc thùng hàng.",
].join(" ");

const RULES = [
  "LUẬT (bắt buộc):",
  "1. Chỉ ghi thứ NHÌN THẤY trong ảnh. Không dùng kiến thức ngoài ảnh, không suy ra thứ ảnh không",
  "   thể hiện.",
  "2. Chữ/số mờ, bị che, bị cắt → ghi [không đọc được]. Đọc được nhưng không chắc → ghi giá trị",
  "   kèm [?]. KHÔNG đoán.",
  "3. Thứ được hỏi mà ảnh KHÔNG có → ghi thẳng \"không có trong ảnh\". TUYỆT ĐỐI không bịa mã đơn,",
  "   số tiền, ngày, tên người cho đủ câu trả lời.",
  "4. Số và mã chép NGUYÊN VĂN đúng ký tự trên ảnh: giữ dấu chấm/phẩy của số tiền, giữ tiền tố của",
  "   mã đơn, không làm tròn, không đổi định dạng ngày, không sửa chính tả tên riêng.",
  "5. Tách rõ thứ THẤY với thứ SUY LUẬN. Phần suy luận phải nói rõ là suy luận.",
].join("\n");

const OUTPUT_SHAPE = [
  "DẠNG TRẢ LỜI (tiếng Việt, không mở bài, không kết luận thừa):",
  "THẤY:",
  "- <nhãn>: <giá trị nguyên văn>",
  "SUY LUẬN: <1-2 câu, hoặc \"không cần\">",
  "",
  // Ví dụ có giá trị cụ thể thì model bám dạng trình bày tốt hơn hẳn, nhưng lại là mồi để nó chép
  // đúng mấy giá trị đó ra khi chữ trong ảnh mờ. Một dòng cảnh báo rẻ hơn nhiều so với bỏ ví dụ.
  "Ví dụ CHỈ ĐỂ MINH HOẠ CÁCH TRÌNH BÀY (số liệu dưới đây KHÔNG liên quan gì tới ảnh đang đọc,",
  "tuyệt đối không chép lại):",
  "- Ngân hàng: MB Bank",
  "- Số tiền: 2.000.000 VND",
  "- Nội dung chuyển khoản: DH12345 chi Lan",
  "- Thời gian: 14:32 09/08/2026",
  "- Mã giao dịch: [không đọc được]",
].join("\n");

/**
 * Dữ kiện đã biết là của HỆ THỐNG, không phải thứ đọc được từ ảnh — phải nói rõ, nếu không model
 * chép lại chúng vào phần THẤY và agent tưởng ảnh có xác nhận điều đó.
 */
function knownFactsBlock(facts: string): string {
  return [
    "<da_biet>",
    facts,
    "</da_biet>",
    "Đây là dữ kiện HỆ THỐNG đã biết, KHÔNG phải thứ nhìn thấy trong ảnh. Đối chiếu với ảnh: khớp",
    "thì nói khớp, lệch thì nói rõ lệch ở đâu, ảnh không thể hiện thì nói không đối chiếu được.",
    "KHÔNG chép chúng vào phần THẤY như thể đọc được từ ảnh.",
  ].join("\n");
}

/** Câu hỏi agent viết = DỮ LIỆU của lượt → bọc thẻ để không lẫn vào phần luật ở trên. */
export function buildImagePrompt(input: ImagePromptInput): string {
  const sections = [ROLE_AND_SCOPE, RULES, OUTPUT_SHAPE];

  if (input.knownFacts !== undefined && input.knownFacts !== "") {
    sections.push(knownFactsBlock(input.knownFacts));
  }

  sections.push(
    [
      "<can_lay>",
      input.question,
      "</can_lay>",
      "Việc cần làm: trả lời đúng phần trong <can_lay>. Ảnh còn dữ kiện khác quan trọng cho việc đó",
      "thì ghi thêm mục KHÁC ở cuối; không liên quan thì bỏ qua, đừng liệt kê cho dài.",
    ].join("\n"),
  );

  return sections.join("\n\n");
}
