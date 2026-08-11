// image-vision.ts — VisionPort chạy thật: tải ảnh từ CDN → đưa bytes cho VisionReader → trả chữ.
//
// Đây là chỗ DUY NHẤT trong hệ gọi ra một URL do người ngoài đưa vào, nên hàng rào nằm hết ở đây:
//
//   - Allowlist host, FAIL-CLOSED: danh sách rỗng = không tải gì. Link đến từ webhook; tải bừa là
//     biến agent thành cái máy quét mạng nội bộ (SSRF) cho bất kỳ ai nhắn được vào nhóm.
//   - KHÔNG đi theo redirect (`redirect: "manual"`): host đã duyệt mà bị 302 sang chỗ khác thì
//     danh sách trên thành vô nghĩa.
//   - Trần dung lượng đọc theo luồng, không tin `content-length` (header nói dối được).
//   - Chỉ nhận đúng bộ MIME con đọc ảnh hiểu được.

import type { VisionReader } from "../llm/types.ts";
import { buildImagePrompt } from "./prompt.ts";
import { ImageReadError, type VisionPort, type VisionReadRequest } from "./types.ts";

/** Trần dung lượng ảnh tải về. Ảnh chụp màn hình/hoá đơn thật nằm dưới 2MB rất xa. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/** Trần thời gian TẢI (chưa tính lượt gọi model). Ảnh không về trong chừng này coi như link hỏng. */
const DOWNLOAD_TIMEOUT_MS = 15_000;

/** MIME con đọc ảnh nhận được. Ngoài bộ này (gif, pdf, video...) → báo lỗi nghiệp vụ, không gửi lên. */
const SUPPORTED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export class CdnImageVision implements VisionPort {
  constructor(
    private readonly reader: VisionReader,
    /** Host CDN được phép tải. Rỗng = cổng đóng (bootstrap không nên dựng cổng trong trường hợp đó). */
    private readonly allowedHosts: readonly string[],
    /** Điểm tiêm cho test — chạy thật luôn là fetch của runtime. */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async read(req: VisionReadRequest): Promise<string> {
    const url = this.#checkUrl(req.url);
    const image = await this.#download(url, req.signal);

    const text = await this.reader.describe({
      imageBase64: image.base64,
      mimeType: image.mimeType,
      // Câu của agent đi qua KHUNG cố định (luật chống bịa + dạng trả lời) — xem prompt.ts.
      question: buildImagePrompt({
        question: req.question,
        ...(req.knownFacts === undefined ? {} : { knownFacts: req.knownFacts }),
      }),
      signal: req.signal,
    });

    if (text === "") {
      throw new ImageReadError(
        "Không đọc được nội dung ảnh này (ảnh mờ, hoặc bị từ chối xử lý). Hỏi người gửi chụp lại " +
          "rõ hơn, hoặc gõ tay thông tin cần trao đổi.",
      );
    }
    return text;
  }

  /** Duyệt link TRƯỚC khi chạm mạng: sai giao thức / host lạ thì không có request nào được gửi đi. */
  #checkUrl(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new ImageReadError(`Link ảnh không hợp lệ: ${raw.slice(0, 200)}`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ImageReadError("Chỉ đọc được ảnh từ link http(s).");
    }

    if (!isAllowedHost(url.hostname, this.allowedHosts)) {
      throw new ImageReadError(
        "Link ảnh không thuộc kho ảnh được phép đọc nên hệ thống không tải. Chỉ dùng đúng link " +
          "ảnh đính kèm trong tin nhắn, đừng tự ghép link khác.",
      );
    }
    return url;
  }

  async #download(url: URL, signal?: AbortSignal): Promise<{ base64: string; mimeType: string }> {
    const timeoutSignal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const merged = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      // redirect manual: 3xx trả về nguyên trạng thay vì đi tiếp tới host chưa duyệt.
      response = await this.fetchImpl(url, { redirect: "manual", signal: merged });
    } catch (err) {
      const reason = timeoutSignal.aborted ? `quá ${DOWNLOAD_TIMEOUT_MS}ms` : describe(err);
      throw new ImageReadError(`Không tải được ảnh (${reason}). Nhờ người gửi gửi lại ảnh.`);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new ImageReadError("Link ảnh bị chuyển hướng nên hệ thống không tải. Nhờ gửi lại ảnh.");
    }
    if (!response.ok) {
      throw new ImageReadError(
        `Link ảnh trả lỗi ${response.status} (ảnh có thể đã hết hạn). Nhờ người gửi gửi lại ảnh.`,
      );
    }

    const mimeType = readMimeType(response.headers.get("content-type"));
    const bytes = await readCapped(response, MAX_IMAGE_BYTES);
    return { base64: Buffer.from(bytes).toString("base64"), mimeType };
  }
}

/** Khớp đúng host, hoặc là subdomain của host đã duyệt. So chữ thường (hostname luôn thường sẵn). */
function isAllowedHost(hostname: string, allowed: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function readMimeType(header: string | null): string {
  // "image/jpeg; charset=binary" → "image/jpeg".
  const mime = (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!SUPPORTED_MIME.has(mime)) {
    throw new ImageReadError(
      `File này không phải ảnh đọc được (kiểu "${mime === "" ? "không rõ" : mime}"). Hệ thống mới ` +
        "đọc được ảnh JPG/PNG/WEBP/HEIC — nhờ người gửi chụp màn hình rồi gửi lại.",
    );
  }
  return mime;
}

/**
 * Đọc body theo luồng và DỪNG khi vượt trần — không tin `content-length` (header nói dối được, và
 * body chunked thì không có header đó). Vượt trần là huỷ luôn kết nối, không nạp nốt vào RAM.
 */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const body = response.body;
  if (body === null) throw new ImageReadError("Link ảnh trả về rỗng. Nhờ người gửi gửi lại ảnh.");

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Kiểu của stream là `any` ở lớp Response → narrow thật bằng instanceof, không ép kiểu.
      const chunk: unknown = value;
      if (!(chunk instanceof Uint8Array)) {
        await reader.cancel();
        throw new ImageReadError("Ảnh tải về sai định dạng dữ liệu. Nhờ người gửi gửi lại ảnh.");
      }
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ImageReadError(
          `Ảnh nặng quá ${Math.floor(maxBytes / (1024 * 1024))}MB nên hệ thống không đọc. Nhờ ` +
            "người gửi chụp màn hình (ảnh nhẹ hơn) rồi gửi lại.",
        );
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) throw new ImageReadError("Ảnh tải về rỗng. Nhờ người gửi gửi lại ảnh.");

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
