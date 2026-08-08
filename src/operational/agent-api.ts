// agent-api.ts — client DUY NHẤT cho API vận hành `/agent/*` (tra đơn, camera).
//
// Cùng backend + service token với client.ts (agent-session: verify token, tra đại lý theo nhóm),
// khác ở chỗ MỌI request phải mang thêm định danh đại lý ở header. Một hàm dựng header
// (buildAgentHeaders) cho toàn bộ endpoint — không nơi gọi nào tự ghép header.
//
// KHÔNG import config.ts (fail-fast env): base URL + token nhận qua constructor, bootstrap cấp.
// Nhờ vậy test dựng client với fetch giả, không cần env thật.
//
// KHÔNG BAO GIỜ log/nhét `serviceToken` vào message lỗi — lỗi chỉ mang method + path + status + code.

/** Header xác thực service-to-service. Giá trị = SERVICE_TOKEN_AGENT_API. */
const SERVICE_TOKEN_HEADER = "x-service-token";
/** `dealers.id` (bigint dạng chuỗi). Backend ép mọi truy vấn theo đại lý này. */
const DEALER_HEADER = "x-dealer-id";
/** `accounts.id` (bigint dạng chuỗi) — audit ai tra, và là NGƯỜI GHI ở endpoint POST. */
const STAFF_HEADER = "x-staff-id";
const CONTENT_TYPE_HEADER = "content-type";
const JSON_CONTENT_TYPE = "application/json";

/** Trần thời gian 1 call. Backend chậm bất thường → abort, không treo agent loop. */
const TIMEOUT_MS = 10_000;
/** Chỉ retry 5xx/timeout. Backoff giữa các lần: 500ms → 1500ms (tối đa 2 lần retry). */
const RETRY_BACKOFF_MS: readonly number[] = [500, 1500];
/** Cắt body lỗi trước khi bọc vào Error — tránh nuốt nguyên payload khổng lồ vào log. */
const MAX_ERROR_BODY = 500;

/** Mã lỗi backend mà nơi gọi phải xử lý riêng. Mã khác → lỗi chung. */
export const AgentApiErrorCode = {
  /** Thiếu x-dealer-id — lỗi CẤU HÌNH phía agent, không phải input người dùng. */
  DealerRequired: "AUTH_AGENT_DEALER_REQUIRED",
  /** Đại lý/nhân viên không tồn tại hoặc đã khoá. */
  PrincipalInvalid: "AUTH_AGENT_PRINCIPAL_INVALID",
  /** Service token sai hoặc thiếu scope. */
  InsufficientPermissions: "AUTH_INSUFFICIENT_PERMISSIONS",
  /** Không có đơn đó THUỘC đại lý này (đơn của đại lý khác cũng ra mã này, không phải 403). */
  OrderNotFound: "ORDER_NOT_FOUND",
  /** Ngày sai định dạng hoặc không tồn tại (sổ ngày) — input người dùng sai, hỏi lại ngày. */
  InvalidDate: "AGENT_INVALID_DATE",
  /** Không phải mã của backend: response 2xx nhưng shape sai. */
  InvalidResponse: "AGENT_API_INVALID_RESPONSE",
  /** Không phải mã của backend: mạng hỏng / timeout / abort. */
  Transport: "AGENT_API_TRANSPORT",
} as const;
export type AgentApiErrorCode = (typeof AgentApiErrorCode)[keyof typeof AgentApiErrorCode];

/** Lỗi từ API vận hành. `status` = 0 khi chưa có response (mạng/timeout). */
export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "AgentApiError";
  }
}

/** Định danh đi kèm MỌI request. `staffId` tuỳ chọn (audit). */
export interface AgentApiPrincipal {
  readonly dealerId: string;
  readonly staffId?: string;
}

/**
 * Dựng header cho 1 request `/agent/*`. Dùng CHUNG cho mọi endpoint.
 * `staffId` rỗng/không phải chuỗi số → bỏ hẳn header: backend chờ `accounts.id` bigint, gửi rác
 * vào chỉ làm hỏng cả request vốn chỉ cần dealer.
 */
export function buildAgentHeaders(
  serviceToken: string,
  principal: AgentApiPrincipal,
): Record<string, string> {
  const headers: Record<string, string> = {
    [SERVICE_TOKEN_HEADER]: serviceToken,
    [DEALER_HEADER]: principal.dealerId,
  };
  if (principal.staffId !== undefined && /^\d+$/.test(principal.staffId)) {
    headers[STAFF_HEADER] = principal.staffId;
  }
  return headers;
}

/** Một lời gọi HTTP: động từ + thân (POST mới có thân). Nội bộ client, không lộ ra ngoài. */
interface SendCall {
  readonly method: "GET" | "POST";
  readonly body?: unknown;
}

type QueryValue = string | number | undefined;

export interface AgentApiRequest {
  readonly principal: AgentApiPrincipal;
  readonly query?: Readonly<Record<string, QueryValue>>;
  /** Cancel từ agent loop. Gộp với timeout nội bộ: bên nào abort trước thắng. */
  readonly signal?: AbortSignal;
}

/**
 * Chữ ký fetch tối giản — cho phép test cắm bản giả mà không đụng mạng. Khai cấu trúc riêng thay
 * vì `typeof fetch`: TS trong repo thấy CẢ Response của Bun lẫn của undici (@types/node), gõ theo
 * type toàn cục là dính lỗi "hai Response không tương thích" ở nơi gọi.
 */
export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}
export interface FetchInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal;
  /** JSON đã stringify. Chỉ có ở POST — GET không mang body. */
  readonly body?: string;
}
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface AgentApiOptions {
  /** Vd `https://api.dilisupplement.com/api` — có hay không dấu `/` cuối đều được. */
  readonly baseUrl: string;
  readonly serviceToken: string;
  readonly fetchImpl?: FetchLike;
}

export class AgentApiClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: AgentApiOptions) {
    this.baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
    this.serviceToken = options.serviceToken;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  /** GET một endpoint `/agent/*`. Trả body JSON đã parse (`unknown`) — nơi gọi validate shape. */
  async get(path: string, request: AgentApiRequest): Promise<unknown> {
    return this.send(path, buildAgentHeaders(this.serviceToken, request.principal), request, {
      method: "GET",
    });
  }

  /**
   * POST một endpoint `/agent/*` — endpoint GHI (nâng bậc chiết khấu...).
   *
   * KHÔNG RETRY, kể cả 5xx/timeout: request đã tới backend hay chưa thì phía này không phân biệt
   * được, mà bắn lại một lệnh ghi là ghi hai lần. Nơi gọi báo lỗi cho người, người quyết thử lại.
   */
  async post(path: string, request: AgentApiRequest & { readonly body: unknown }): Promise<unknown> {
    return this.send(path, buildAgentHeaders(this.serviceToken, request.principal), request, {
      method: "POST",
      body: request.body,
    });
  }

  /**
   * GET một endpoint KHÔNG gắn phạm vi đại lý (không có `x-dealer-id`).
   *
   * CHỈ dùng cho endpoint mà việc của nó chính là TRA RA đại lý từ một mã (vd chủ sở hữu đơn
   * hoàn) — ở đó chưa biết đại lý nào để mà gắn header. Endpoint đọc dữ liệu đơn/công nợ PHẢI đi
   * qua `get`: bỏ header đại lý ở đó là mở toang dữ liệu của mọi đại lý cho một lượt chat.
   */
  async getUnscoped(
    path: string,
    request: Omit<AgentApiRequest, "principal"> = {},
  ): Promise<unknown> {
    return this.send(path, { [SERVICE_TOKEN_HEADER]: this.serviceToken }, request, {
      method: "GET",
    });
  }

  private async send(
    path: string,
    headers: Record<string, string>,
    request: Omit<AgentApiRequest, "principal">,
    call: SendCall,
  ): Promise<unknown> {
    const url = this.buildUrl(path, request.query);
    // Chỉ GET mới lặp: GET idempotent, POST thì bắn lại là ghi lại (xem `post`).
    const maxAttempts = call.method === "GET" ? RETRY_BACKOFF_MS.length : 0;

    let lastError: AgentApiError | undefined;
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      if (attempt > 0) await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 0);
      try {
        return await this.attempt(url, path, headers, request.signal, call);
      } catch (err) {
        if (!(err instanceof AgentApiError)) throw err;
        // 4xx = input/cấu hình sai, retry cũng ra y hệt. Chỉ 5xx và lỗi transport mới đáng thử lại.
        if (err.status !== 0 && err.status < 500) throw err;
        // Caller chủ động huỷ (agent loop cancel) → dừng luôn, không tiêu thêm thời gian.
        if (request.signal?.aborted === true) throw err;
        lastError = err;
      }
    }
    throw lastError ?? new AgentApiError("Gọi API vận hành thất bại", 0, AgentApiErrorCode.Transport, path);
  }

  private buildUrl(path: string, query: AgentApiRequest["query"]): string {
    const url = new URL(path.replace(/^\//, ""), this.baseUrl);
    if (query !== undefined) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async attempt(
    url: string,
    path: string,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
    call: SendCall,
  ): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
    const combined = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
    const init: FetchInit =
      call.method === "POST"
        ? {
            method: "POST",
            headers: { ...headers, [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE },
            signal: combined,
            body: JSON.stringify(call.body ?? {}),
          }
        : { method: "GET", headers, signal: combined };

    let response: FetchResponse;
    try {
      response = await this.fetchImpl(url, init);
    } catch (err) {
      const reason = timeoutSignal.aborted ? `timeout sau ${TIMEOUT_MS}ms` : describeError(err);
      throw new AgentApiError(
        `${call.method} ${path} thất bại (${reason})`,
        0,
        AgentApiErrorCode.Transport,
        path,
      );
    }

    const text = await response.text();
    if (!response.ok) throw toApiError(response.status, text, path, call.method);

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AgentApiError(
        `${call.method} ${path} trả response không phải JSON`,
        response.status,
        AgentApiErrorCode.InvalidResponse,
        path,
      );
    }
  }
}

/**
 * Bóc `data` khỏi envelope `{ success, data, meta }`. Shape sai → AgentApiError (không trả bừa
 * `undefined` xuống tầng parse, vì ở đó nó lẫn với "field optional vắng mặt").
 */
export function readEnvelopeData(body: unknown, path: string): unknown {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    throw new AgentApiError(
      `GET ${path} trả response thiếu "data"`,
      200,
      AgentApiErrorCode.InvalidResponse,
      path,
    );
  }
  return body.data;
}

/**
 * Đọc khối meta của envelope danh sách. Thiếu/sai kiểu → {} (meta không phải dữ liệu bắt buộc).
 * `key` vì backend không thống nhất: `/agent/orders` trả `meta`, `/agent/daily/*` trả `meta_data`.
 */
export function readEnvelopeMeta(body: unknown, key = "meta"): Record<string, unknown> {
  if (typeof body !== "object" || body === null) return {};
  const meta = (body as Record<string, unknown>)[key];
  return typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>) : {};
}

/** Body lỗi backend: `{ code, message }`. Thiếu → dùng status làm mã (vẫn phân loại được). */
function toApiError(status: number, text: string, path: string, method = "GET"): AgentApiError {
  let code = `HTTP_${status}`;
  let message = text.slice(0, MAX_ERROR_BODY);
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record["code"] === "string" && record["code"] !== "") code = record["code"];
      if (typeof record["message"] === "string") message = record["message"].slice(0, MAX_ERROR_BODY);
    }
  } catch {
    // Body lỗi không phải JSON (gateway/proxy chen vào) — giữ text đã cắt làm message.
  }
  return new AgentApiError(`${method} ${path} trả ${status} (${code}): ${message}`, status, code, path);
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
