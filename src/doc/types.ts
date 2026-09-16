// types.ts — hợp đồng tầng doc: "đưa link file, trả markdown".
//
// File LÁ: tools/ và bootstrap cùng import từ đây. Tool KHÔNG tự tải file, KHÔNG tự gọi dịch vụ
// chuyển đổi — hàng rào (allowlist host, trần dung lượng, key) nằm sau cổng này, y như vision/.

export interface DocReadRequest {
  /** Link file do channel cấp (Envelope.fileUrl). UNTRUSTED — cổng tự duyệt host trước khi tải. */
  readonly url: string;
  /**
   * Tên file channel gửi kèm (Envelope.fileName). Dùng để đoán định dạng khi nội dung không tự
   * nhận ra được (csv/txt không có magic bytes). undefined = để dịch vụ tự dò theo bytes.
   */
  readonly fileName?: string;
  readonly signal?: AbortSignal;
}

export interface DocReadResult {
  /** Nội dung file dạng markdown. Đã cắt theo trần ký tự của cổng. */
  readonly markdown: string;
  /** Định dạng dịch vụ nhận ra ("pdf", "docx"...). undefined = dịch vụ không nói. */
  readonly format?: string;
  /** true = tài liệu dài hơn trần nên markdown BỊ CẮT phần đuôi. */
  readonly truncated: boolean;
}

/** Cổng đọc file cho tool. Lỗi ĐỌC ĐƯỢC TRƯỚC (link lạ, file to, định dạng lạ) → DocReadError. */
export interface DocPort {
  read(req: DocReadRequest): Promise<DocReadResult>;
}

/**
 * Lỗi NGHIỆP VỤ của việc đọc file: link không hợp lệ/không được phép, file quá lớn, định dạng
 * không chuyển được, tài liệu rỗng. Tách khỏi lỗi hạ tầng (mạng chết, dịch vụ 5xx) vì tool xử lý
 * khác nhau: cái này báo lại cho model bằng lời, cái kia là sự cố phải lên log/Sentry.
 *
 * `message` viết cho MODEL đọc (tiếng Việt, nói rõ nên làm gì tiếp) — nó đi thẳng vào tool_result.
 */
export class DocReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocReadError";
  }
}
