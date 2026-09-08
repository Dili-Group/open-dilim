// zalo-oa-token.ts — nguồn `access_token` của Official Account, lấy từ API hệ vận hành.
//
// AGENT KHÔNG GIỮ refresh_token. Zalo XOAY refresh_token mỗi lần refresh (token cũ chết ngay),
// nên chỉ được có MỘT nơi ghi nó — ở đây là backend DILIM, nơi đã có endpoint cấp token. Agent tự
// refresh song song với backend là hai bên đạp nhau: bên chậm cầm token đã chết, OA câm.
//
// Cache trong RAM theo `expires_in` (trừ biên an toàn). Hết hạn → gọi lại endpoint; backend lo
// phần refresh. Process restart = mất cache = một call thừa, không sao.
//
// KHÔNG BAO GIỜ log giá trị token.

/** Header xác thực service-to-service với API vận hành — cùng token với AgentApiClient. */
const SERVICE_TOKEN_HEADER = "x-service-token";
/** Trần 1 call lấy token. Backend treo → abort, không giữ lượt agent vô hạn. */
const TIMEOUT_MS = 10_000;
/**
 * Trừ trước hạn để không dùng token đang chết dở giữa đường (đồng hồ lệch + độ trễ mạng).
 * Backend không trả `expires_in` → dùng TTL mặc định ngắn: thà gọi lại hơn là cầm token đã hết hạn.
 */
const EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_TTL_MS = 5 * 60_000;
const MIN_TTL_MS = 30_000;
/** Cắt body lỗi trước khi bọc vào Error — đừng nuốt nguyên payload vào log. */
const MAX_ERROR_BODY = 300;

export interface ZaloOaTokenConfig {
  /**
   * URL đầy đủ endpoint cấp access_token của hệ vận hành (env `ZALO_OA_TOKEN_URL`).
   *
   * HỢP ĐỒNG: endpoint TỰ REFRESH — token trả về luôn còn hạn. Agent không có đường tự cứu nếu
   * nhận token đã chết: nó chỉ biết hỏi lại đúng cái endpoint này.
   */
  readonly url: string;
  /** SERVICE_TOKEN_AGENT_API — cùng token với các endpoint `/agent/*` khác. */
  readonly serviceToken: string;
}

/**
 * Cấp `access_token` còn hạn. `force = true` = bỏ cache, hỏi lại backend — dùng khi Zalo vừa từ
 * chối vì token chết trước khi cache kịp hết hạn.
 */
export interface ZaloOaTokenPort {
  get(force?: boolean): Promise<string>;
}

export class ZaloOaTokenSource implements ZaloOaTokenPort {
  #cache: { token: string; expiresAt: number } | undefined;
  /** Gộp các lần hỏi trùng nhịp vào MỘT call — n lượt agent chạy song song không tạo n refresh. */
  #inflight: Promise<string> | undefined;

  constructor(private readonly config: ZaloOaTokenConfig) {}

  async get(force = false): Promise<string> {
    const cached = this.#cache;
    if (!force && cached !== undefined && Date.now() < cached.expiresAt) return cached.token;
    if (force) this.#cache = undefined;

    this.#inflight ??= this.#fetchToken().finally(() => {
      this.#inflight = undefined;
    });
    return this.#inflight;
  }

  async #fetchToken(): Promise<string> {
    const res = await fetch(this.config.url, {
      headers: { [SERVICE_TOKEN_HEADER]: this.config.serviceToken },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, MAX_ERROR_BODY);
      throw new Error(
        `[zalo-oa] lấy access_token hỏng: HTTP ${res.status}${detail === "" ? "" : ` — ${detail}`}`,
      );
    }

    const parsed = readAccessToken(await res.json().catch(() => undefined));
    if (parsed === null) {
      // KHÔNG in body: nó chứa chính token khi shape chỉ lệch tên field.
      throw new Error("[zalo-oa] response cấp token sai shape (không tìm thấy access_token)");
    }
    this.#cache = { token: parsed.token, expiresAt: Date.now() + parsed.ttlMs };
    return parsed.token;
  }
}

/**
 * Nhận cả `{ access_token, expires_in }` lẫn `{ data: { ... } }` — hai kiểu bọc thường gặp của
 * backend. Không đoán thêm kiểu nào khác: shape lạ → null để nơi gọi báo lỗi rõ, hơn là gửi tin
 * bằng một chuỗi rác rồi để Zalo từ chối.
 */
function readAccessToken(body: unknown): { token: string; ttlMs: number } | null {
  const root = asRecord(body);
  if (root === undefined) return null;
  const source = asRecord(root.data) ?? root;

  const token = source.access_token;
  if (typeof token !== "string" || token === "") return null;

  return { token, ttlMs: readTtlMs(source.expires_in) };
}

/** `expires_in` giây (Zalo trả dạng chuỗi). Thiếu/rác → TTL mặc định. */
function readTtlMs(raw: unknown): number {
  const seconds = typeof raw === "string" ? Number(raw) : raw;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_TTL_MS;
  }
  return Math.max(seconds * 1000 - EXPIRY_MARGIN_MS, MIN_TTL_MS);
}

function asRecord(x: unknown): Record<string, unknown> | undefined {
  return typeof x === "object" && x !== null && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : undefined;
}
