// anydoc.ts — DocPort chạy thật: tải file từ CDN → đẩy sang dịch vụ anydoc → trả markdown.
//
// Đây là đường thứ hai (sau vision/) gọi ra một URL do người ngoài đưa vào, nên hàng rào lặp lại
// nguyên vẹn ở đây — cố ý KHÔNG dùng chung code với vision: hai bên khác trần, khác câu báo lỗi,
// và một hàng rào bảo mật đọc thẳng tại chỗ dễ soát hơn một hàm chung nhiều tham số.
//
//   - Allowlist host, FAIL-CLOSED: danh sách rỗng = không tải gì.
//   - KHÔNG đi theo redirect (`redirect: "manual"`).
//   - Trần dung lượng đọc theo luồng, không tin `content-length`.
//   - Trần ký tự markdown trả về: một PDF 200 trang chuyển ra chữ là nuốt trọn cửa sổ ngữ cảnh.
//
// Dịch vụ anydoc (Cloudflare Worker + container): POST /convert, body là bytes thô, trả JSON
// `{ markdown, format, filename, bytes, ms, ocr }` khi `?json=1`. PDF scan không có lớp chữ trả
// 422 `code:"needsOcr"` — thử lại đúng MỘT lần với `?ocr=hosted` (đường OCR tốn tiền, không mặc định).

import { DocReadError, type DocPort, type DocReadRequest, type DocReadResult } from "./types.ts";

/** Trần dung lượng file tải về. Tài liệu nghiệp vụ thật (hoá đơn, bảng kê) nằm dưới 5MB rất xa. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Trần thời gian TẢI file từ CDN (chưa tính lượt chuyển đổi). */
const DOWNLOAD_TIMEOUT_MS = 20_000;

/** Trần thời gian CHUYỂN ĐỔI. OCR chạy lâu hơn hẳn đường thường nên nới rộng. */
const CONVERT_TIMEOUT_MS = 60_000;

/**
 * Trần ký tự markdown trả về model. Vượt trần thì CẮT và nói rõ là đã cắt — thà model biết mình
 * đọc thiếu còn hơn im lặng đưa nửa tài liệu rồi kết luận như đã đọc hết.
 */
const MAX_MARKDOWN_CHARS = 24_000;

/** Body gửi anydoc là bytes thô (không multipart) — tên file đi qua query `filename`. */
const RAW_CONTENT_TYPE = "application/octet-stream";

export interface AnydocConfig {
  /** Gốc dịch vụ, vd https://anydoc.example.workers.dev (không kèm /convert). */
  readonly baseUrl: string;
  /** Key gọi dịch vụ, gửi qua header `x-api-key`. */
  readonly apiKey: string;
  /** Host CDN được phép tải file. Rỗng = cổng đóng (bootstrap không nên dựng cổng khi đó). */
  readonly allowedHosts: readonly string[];
}

/** Phần dùng được của JSON anydoc trả về. Ngoài ba khoá này không quan tâm (bytes/ms/ocr là log). */
interface AnydocResponse {
  readonly markdown: string;
  readonly format?: string;
}

export class AnydocDocReader implements DocPort {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #allowedHosts: readonly string[];
  readonly #fetchImpl: typeof fetch;

  constructor(config: AnydocConfig, fetchImpl: typeof fetch = fetch) {
    // Bỏ "/" đuôi một lần lúc dựng: nối đường dẫn ở dưới khỏi phải đoán có hay không.
    this.#baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.#apiKey = config.apiKey;
    this.#allowedHosts = config.allowedHosts;
    this.#fetchImpl = fetchImpl;
  }

  async read(req: DocReadRequest): Promise<DocReadResult> {
    const url = this.#checkUrl(req.url);
    const bytes = await this.#download(url, req.signal);

    const fileName = req.fileName ?? fileNameFromUrl(url);
    let converted = await this.#convert(bytes, fileName, false, req.signal);
    // PDF scan: đường thường không có chữ để lấy → thử lại bằng OCR, đúng một lần.
    if (converted.needsOcr) {
      converted = await this.#convert(bytes, fileName, true, req.signal);
      if (converted.needsOcr) {
        throw new DocReadError(
          "File này là bản scan, đọc bằng OCR vẫn không ra chữ. Nhờ người gửi gửi lại bản gốc " +
            "(file Word/Excel/PDF xuất từ máy) hoặc gõ tay phần thông tin cần trao đổi.",
        );
      }
    }

    const markdown = converted.body.markdown.trim();
    if (markdown === "") {
      throw new DocReadError(
        "File mở được nhưng không có chữ nào bên trong. Nhờ người gửi kiểm tra lại file, hoặc gõ " +
          "tay thông tin cần trao đổi.",
      );
    }

    const truncated = markdown.length > MAX_MARKDOWN_CHARS;
    return {
      markdown: truncated ? markdown.slice(0, MAX_MARKDOWN_CHARS) : markdown,
      ...(converted.body.format === undefined ? {} : { format: converted.body.format }),
      truncated,
    };
  }

  /** Duyệt link TRƯỚC khi chạm mạng: sai giao thức / host lạ thì không request nào được gửi đi. */
  #checkUrl(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new DocReadError(`Link file không hợp lệ: ${raw.slice(0, 200)}`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new DocReadError("Chỉ đọc được file từ link http(s).");
    }
    if (!isAllowedHost(url.hostname, this.#allowedHosts)) {
      throw new DocReadError(
        "Link file không thuộc kho file được phép đọc nên hệ thống không tải. Chỉ dùng đúng link " +
          "file đính kèm trong tin nhắn, đừng tự ghép link khác.",
      );
    }
    return url;
  }

  async #download(url: URL, signal?: AbortSignal): Promise<Uint8Array> {
    const timeoutSignal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const merged = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      // redirect manual: 3xx trả nguyên trạng thay vì đi tiếp tới host chưa duyệt.
      response = await this.#fetchImpl(url, { redirect: "manual", signal: merged });
    } catch (err) {
      const reason = timeoutSignal.aborted ? `quá ${DOWNLOAD_TIMEOUT_MS}ms` : describe(err);
      throw new DocReadError(`Không tải được file (${reason}). Nhờ người gửi gửi lại file.`);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new DocReadError("Link file bị chuyển hướng nên hệ thống không tải. Nhờ gửi lại file.");
    }
    if (!response.ok) {
      throw new DocReadError(
        `Link file trả lỗi ${response.status} (file có thể đã hết hạn). Nhờ người gửi gửi lại.`,
      );
    }
    return await readCapped(response, MAX_FILE_BYTES);
  }

  /**
   * Một lượt gọi anydoc. `needsOcr` là kết cục BÌNH THƯỜNG (PDF scan), không phải lỗi → trả cờ
   * cho caller quyết thử lại, không throw.
   */
  async #convert(
    bytes: Uint8Array,
    fileName: string | undefined,
    ocr: boolean,
    signal?: AbortSignal,
  ): Promise<{ body: AnydocResponse; needsOcr: boolean }> {
    const endpoint = new URL(`${this.#baseUrl}/convert`);
    endpoint.searchParams.set("json", "1");
    if (fileName !== undefined) endpoint.searchParams.set("filename", fileName);
    if (ocr) endpoint.searchParams.set("ocr", "hosted");

    const timeoutSignal = AbortSignal.timeout(CONVERT_TIMEOUT_MS);
    const merged = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      response = await this.#fetchImpl(endpoint, {
        method: "POST",
        headers: { "x-api-key": this.#apiKey, "content-type": RAW_CONTENT_TYPE },
        // Bun/undici nhận Uint8Array làm body — không copy thêm lần nữa.
        body: bytes,
        signal: merged,
      });
    } catch (err) {
      // Dịch vụ không với tới được = SỰ CỐ hạ tầng, không phải lỗi của file → để runner bắt.
      const reason = timeoutSignal.aborted ? `quá ${CONVERT_TIMEOUT_MS}ms` : describe(err);
      throw new Error(`anydoc không phản hồi (${reason})`, { cause: err });
    }

    const raw = await response.text();

    if (response.ok) {
      return { body: parseAnydoc(raw), needsOcr: false };
    }

    const failure = parseFailure(raw);
    if (response.status === 422 && failure.code === "needsOcr") {
      return { body: { markdown: "" }, needsOcr: true };
    }
    if (response.status === 401 || response.status === 403) {
      // Key sai/hết hạn: lỗi CẤU HÌNH của hệ, người gửi file không sửa được gì → sự cố.
      throw new Error(`anydoc từ chối key (${response.status})`);
    }
    if (response.status >= 500) {
      throw new Error(`anydoc lỗi ${response.status}: ${raw.slice(0, 300)}`);
    }
    if (response.status === 413) {
      throw new DocReadError(
        "File nặng quá mức dịch vụ đọc được. Nhờ người gửi tách nhỏ file rồi gửi lại.",
      );
    }
    throw new DocReadError(
      `Không đọc được file này (${failure.error}). Hệ thống đọc được PDF, Word (doc/docx), Excel ` +
        "(xlsx), PowerPoint (ppt/pptx), CSV, RTF, OpenDocument và EPUB — nhờ người gửi đổi sang " +
        "một trong các dạng đó rồi gửi lại.",
    );
  }
}

/** Khớp đúng host, hoặc là subdomain của host đã duyệt. So chữ thường (hostname luôn thường sẵn). */
function isAllowedHost(hostname: string, allowed: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * Tên file suy từ đường dẫn URL. CẦN cho định dạng không có magic bytes: CSV không kèm tên file
 * bị dịch vụ trả "unrecognized file content" (thử trên anydoc thật 16/09/2026). Sai tên thì cùng
 * lắm là rơi về dò theo bytes, không hỏng gì.
 */
function fileNameFromUrl(url: URL): string | undefined {
  const last = url.pathname.split("/").pop();
  if (last === undefined || last === "" || !last.includes(".")) return undefined;
  return decodeURIComponent(last).slice(0, 200);
}

function parseAnydoc(raw: string): AnydocResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`anydoc trả về không phải JSON: ${raw.slice(0, 200)}`);
  }
  if (!isRecord(parsed) || typeof parsed.markdown !== "string") {
    throw new Error("anydoc trả về JSON thiếu trường markdown");
  }
  const format = typeof parsed.format === "string" ? parsed.format : undefined;
  return { markdown: parsed.markdown, ...(format === undefined ? {} : { format }) };
}

/** Thân lỗi anydoc `{ error, code, hint }`. Không parse được → coi như lỗi không rõ, vẫn đọc tiếp. */
function parseFailure(raw: string): { error: string; code: string | undefined } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: raw.slice(0, 200) === "" ? "không rõ lý do" : raw.slice(0, 200), code: undefined };
  }
  if (!isRecord(parsed)) return { error: "không rõ lý do", code: undefined };
  return {
    error: typeof parsed.error === "string" ? parsed.error : "không rõ lý do",
    code: typeof parsed.code === "string" ? parsed.code : undefined,
  };
}

/**
 * Đọc body theo luồng và DỪNG khi vượt trần — không tin `content-length` (header nói dối được, và
 * body chunked thì không có header đó). Vượt trần là huỷ luôn kết nối, không nạp nốt vào RAM.
 */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const body = response.body;
  if (body === null) throw new DocReadError("Link file trả về rỗng. Nhờ người gửi gửi lại file.");

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
        throw new DocReadError("File tải về sai định dạng dữ liệu. Nhờ người gửi gửi lại.");
      }
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new DocReadError(
          `File nặng quá ${Math.floor(maxBytes / (1024 * 1024))}MB nên hệ thống không đọc. Nhờ ` +
            "người gửi tách nhỏ hoặc gửi phần cần xem.",
        );
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) throw new DocReadError("File tải về rỗng. Nhờ người gửi gửi lại file.");

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
