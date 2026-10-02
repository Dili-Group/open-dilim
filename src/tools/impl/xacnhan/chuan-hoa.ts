// chuan-hoa.ts — hàng rào dữ liệu của một dòng sổ xác nhận: 5 số cuối, lý do chính đáng, độ dài
// từng trường. Đặt ở TOOL chứ không chỉ ở prompt — prompt là gợi ý, tool là hàng rào.
//
// File LÁ, thuần, không I/O: test được mà không cần env lẫn DB.

/** Ít nhất 5 chữ số — khoá đối soát với bảng đơn là 5 số cuối (quy trình §11). */
const MIN_PHONE_DIGITS = 5;
/** Trần `customer_phone varchar(20)` của backend; SĐT VN có mã nước dài nhất ~12 chữ số. */
const MAX_PHONE_DIGITS = 15;

/**
 * Lý do chung chung quy trình §6 chặn thẳng: ghi vậy thì bác sĩ vào cuộc gọi mà không biết khách
 * vướng gì, thành ra phải tư vấn lại từ đầu — đúng thứ quy trình sinh ra để tránh.
 *
 * So khớp sau khi BỎ DẤU: sale gõ "tv them", "tư vấn thêm", "TƯ VẤN THÊM" đều phải chặn như nhau.
 */
const VAGUE_REASONS: readonly string[] = [
  "tu van them",
  "tv them",
  "hoi them",
  "ho tro them",
  "can ho tro",
  "can tu van",
  "xac nhan don",
  "xac nhan",
  "nhu moi khi",
  "nhu cu",
];

/**
 * Phần mở đầu KHÔNG mang thông tin: "gặp bác để hỏi thêm" (tin thật 02/10/2026) vẫn là "hỏi thêm"
 * sau khi bóc vỏ. Bóc lặp từ đầu câu, đã bỏ dấu. Thứ tự: cụm dài trước cụm ngắn.
 */
const FILLER_PREFIXES: readonly string[] = [
  "gap bac son de",
  "gap bac si de",
  "gap bac de",
  "gap bs de",
  "nho bac",
  "khach",
  "muon",
  "can",
  "de",
];

/** Lý do ngắn hơn mức này thì không thể nêu được khách vướng gì. */
const MIN_REASON_CHARS = 8;

/** Trần độ dài từng trường — tin nhóm đi thẳng vào prompt, để trôi là nổ context của mọi lượt sau. */
export const MAX_LEN = {
  name: 80,
  condition: 600,
  product: 200,
  reason: 300,
  note: 500,
  team: 16,
  /** Trần backend `dealers.code varchar(64)` — dài hơn thì lookup trả 400. */
  dealerCode: 64,
} as const;

/**
 * Gọn lại một trường chữ: bỏ khoảng trắng thừa, cắt trần. Rỗng → undefined (nơi gọi quyết định
 * trường đó có bắt buộc hay không, ở đây không tự bịa giá trị mặc định).
 */
export function cleanText(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.replace(/\s+/g, " ").trim();
  return text === "" ? undefined : text.slice(0, max);
}

/**
 * CHỮ SỐ của SĐT sale gõ. Sale hay gõ dính vào tên ("chị TRANG 94734"), trong ngoặc ("(021329)"),
 * hoặc gõ đủ số — bóc chữ số, GIỮ NGUYÊN cả cụm (backend tự lấy 5 số cuối làm khoá). Dưới 5 chữ
 * số hoặc dài quá một SĐT → undefined để tool hỏi lại, KHÔNG đệm số 0 cho đủ.
 */
export function normalizePhoneDigits(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const digits = raw.replace(/\D/g, "");
  return MIN_PHONE_DIGITS <= digits.length && digits.length <= MAX_PHONE_DIGITS ? digits : undefined;
}

/** Số thứ tự sale tự đánh ("STT: 8"). Không đọc được → undefined, dòng vẫn ghi được. */
export function normalizeStt(raw: unknown): number | undefined {
  const value = typeof raw === "number" ? raw : Number(cleanText(raw, 8) ?? "");
  return Number.isInteger(value) && value > 0 && value < 1000 ? value : undefined;
}

/**
 * Lý do có nêu được khách vướng gì hay không. true = chung chung → tool từ chối ghi và bảo sale
 * gõ lại (quy trình §6: những trường hợp này phải đăng ký lại).
 */
export function isVagueReason(reason: string): boolean {
  const text = stripDiacritics(reason.toLowerCase()).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < MIN_REASON_CHARS) return true;
  // Chặn khi lý do CHỈ có cụm chung chung, không chặn khi nó là một phần của câu đã nêu rõ vấn đề
  // ("sợ hàng giả nên cần bác sĩ xác nhận" phải lọt).
  // So CẢ câu gốc lẫn lõi: "cần tư vấn" nằm sẵn trong danh sách, bóc "cần" ra lại thành lọt.
  const core = stripFillerPrefixes(text);
  return VAGUE_REASONS.some((vague) => text === vague || core === vague);
}

function stripFillerPrefixes(text: string): string {
  let rest = text;
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const prefix of FILLER_PREFIXES) {
      if (rest.startsWith(`${prefix} `)) {
        rest = rest.slice(prefix.length + 1);
        stripped = true;
        break;
      }
    }
  }
  return rest;
}

export function stripDiacritics(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
}
