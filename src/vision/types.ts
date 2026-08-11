// types.ts — hợp đồng tầng vision: "đưa link ảnh, trả chữ".
//
// File LÁ: tools/ và bootstrap cùng import từ đây. Tool KHÔNG tự tải file, KHÔNG tự gọi model —
// hai việc đó có hàng rào riêng (allowlist host, trần dung lượng, key) nằm sau cổng này.

export interface VisionReadRequest {
  /** Link ảnh do channel cấp (Envelope.imageUrl). UNTRUSTED — cổng tự duyệt host trước khi tải. */
  readonly url: string;
  /**
   * Hỏi gì về ảnh, theo NGỮ CẢNH đang trao đổi. Câu này là phần biến động của prompt gửi con đọc
   * ảnh — phần luật cố định (chống bịa, đánh dấu chữ mờ, dạng trả lời) do vision/prompt.ts gắn.
   */
  readonly question: string;
  /**
   * Dữ kiện hệ thống ĐÃ BIẾT để đối chiếu (mã đơn vừa tra, số tiền phải chuyển). Cho model thứ để
   * XÁC NHẬN/BÁC BỎ thay vì đọc chay là cách rẻ nhất giảm bịa. undefined = không có gì đối chiếu.
   */
  readonly knownFacts?: string;
  readonly signal?: AbortSignal;
}

/** Cổng đọc ảnh cho tool. Lỗi ĐỌC ĐƯỢC TRƯỚC (link lạ, file to, không phải ảnh) → ImageReadError. */
export interface VisionPort {
  read(req: VisionReadRequest): Promise<string>;
}

/**
 * Lỗi NGHIỆP VỤ của việc đọc ảnh: link không hợp lệ/không được phép, file quá lớn, không phải ảnh,
 * model không đọc ra gì. Tách khỏi lỗi hạ tầng (mạng, 5xx của Gemini → LLMError) vì tool xử lý
 * khác nhau: cái này báo lại cho model bằng lời, cái kia là sự cố.
 *
 * `message` viết cho MODEL đọc (tiếng Việt, nói rõ nên làm gì tiếp) — nó đi thẳng vào tool_result.
 */
export class ImageReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageReadError";
  }
}
