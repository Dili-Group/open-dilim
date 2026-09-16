// payload.ts — narrow payload webhook (untrusted) dùng chung cho mọi adapter.
//
// Ở đây vì kiểm URL là việc BẢO MẬT: hai bản copy trong hai adapter sớm muộn lệch nhau, và bên
// lệch là bên để lọt. Chỉ nhận thứ thuần + không I/O.

/** Trần độ dài URL nhận vào — link CDN thật ngắn hơn nhiều; dài hơn là rác/nhồi prompt. */
const MAX_URL_CHARS = 2048;

/**
 * Ký tự URL hợp lệ KHÔNG cần tới (đã encode được), nhưng lại bẻ được prompt: link ảnh in ra NGOÀI
 * cặp thẻ dữ liệu của lượt (context/assembler.ts) nên một dấu `]` hay `<` trong tên file là đóng
 * được ô hệ thống rồi viết tiếp như hệ thống. Chặn tại cửa vào thay vì cắt gọt lúc render.
 */
const UNSAFE_URL_CHARS = /[<>[\]\s"'`\\]/;

/**
 * Chỉ nhận http(s) tuyệt đối: `file://`, `data:` và đường dẫn tương đối không phải link CDN. Host
 * KHÔNG duyệt ở đây — allowlist nằm ở lúc tải (vision/image-vision.ts), chỗ duy nhất thật sự gọi ra
 * ngoài; chặn hai nơi bằng hai danh sách là sớm muộn lệch nhau.
 */
export function readHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (value === "" || value.length > MAX_URL_CHARS) return undefined;
  if (UNSAFE_URL_CHARS.test(value)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:" ? value : undefined;
}

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** String không rỗng → giá trị; còn lại → null. Id/msgId số cũng ép về string. */
export function readString(x: unknown): string | null {
  if (typeof x === "string") return x.length > 0 ? x : null;
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  return null;
}

/** ts Zalo là ms epoch dạng string/number. Không parse được → now (đừng rớt tin vì ts xấu). */
export function readTs(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return Date.now();
}

/**
 * Đuôi file TÀI LIỆU hệ thống đọc được. ĐÃ ĐỐI CHIẾU với enum Format thật của dịch vụ anydoc
 * (16/09/2026): txt, md, html, tsv, xls đều bị từ chối — nhận rộng hơn bộ này là hứa với model
 * một thứ mà tới lúc chuyển đổi mới báo không đọc được.
 */
const DOC_EXTENSION = /\.(pdf|docx?|xlsx|pptx?|csv|rtf|odt|ods|odp|epub)$/i;

/** Trần độ dài tên file: tên do người gửi đặt, đi thẳng vào ghi chú trong prompt. */
const MAX_FILE_NAME_CHARS = 120;

/**
 * Tên file người gửi đặt → untrusted y như tên hiển thị: cắt trần và gỡ ký tự bẻ được ô ghi chú
 * trong prompt (cùng lý do với `UNSAFE_URL_CHARS`). Không phải chuỗi / rỗng → undefined.
 */
export function readFileName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.replace(/[<>[\]\r\n]/g, "").trim().slice(0, MAX_FILE_NAME_CHARS);
  return name === "" ? undefined : name;
}

/** Link + tên có phải FILE TÀI LIỆU đọc được không: đuôi ở tên gửi kèm, hoặc đuôi trên đường dẫn. */
export function isDocAttachment(url: string, fileName: string | undefined): boolean {
  if (fileName !== undefined && DOC_EXTENSION.test(fileName)) return true;
  try {
    return DOC_EXTENSION.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
