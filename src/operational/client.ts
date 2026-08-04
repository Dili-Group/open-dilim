// client.ts — kết nối hệ thống vận hành qua HTTP.
// MỌI request tự kèm header `service-token` (không nơi gọi nào phải nhớ set).
// Response trả `unknown` — nơi gọi validate shape theo endpoint (đừng tin blind).

import { CONFIG } from "../config.ts";

// Header xác thực service-to-service. Backend vận hành check giá trị này.
const SERVICE_TOKEN_HEADER = "x-service-token";

// Timeout mặc định cho 1 call. Backend chậm bất thường → abort, không treo agent loop.
const DEFAULT_TIMEOUT_MS = 10_000;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RequestOptions = {
  /** Query params — undefined bị bỏ qua. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Body JSON — serialize + set Content-Type. */
  body?: unknown;
  /** Header phụ. Không override được `service-token`. */
  headers?: Record<string, string>;
  /** Override timeout (ms). */
  timeoutMs?: number;
  /** Cancel từ bên ngoài (agent loop cancel/timeout). Gộp với timeout nội bộ. */
  signal?: AbortSignal;
};

/**
 * Lỗi từ hệ thống vận hành. Mang đủ context để nơi gọi phân loại/log.
 * Giữ nguyên kiểu Error để bubble qua agent loop → trả structured cho LLM.
 */
export class OperationalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly method: Method,
    readonly path: string,
    /** Body raw của response lỗi (đã cắt bớt) — để debug, KHÔNG log ở mức thường. */
    readonly responseBody: string,
  ) {
    super(message);
    this.name = "OperationalError";
  }
}

/** Cắt body lỗi để tránh log/throw payload khổng lồ. */
const MAX_ERROR_BODY = 2_000;

function buildUrl(path: string, query: RequestOptions["query"]): string {
  // baseUrl kết thúc `/` hay không đều ghép đúng nhờ URL().
  const url = new URL(path.replace(/^\//, ""), ensureTrailingSlash(CONFIG.operational.baseUrl));
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function ensureTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

/**
 * Gọi hệ thống vận hành. Trả body JSON đã parse dạng `unknown`.
 * 2xx không body → null. Non-2xx → throw OperationalError.
 */
export async function opRequest(
  method: Method,
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  const { query, body, headers, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;

  const url = buildUrl(path, query);

  // Gộp timeout nội bộ với signal của caller: bên nào abort trước thắng.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const requestHeaders: Record<string, string> = {
    ...headers,
    [SERVICE_TOKEN_HEADER]: CONFIG.operational.serviceToken,
  };

  const hasBody = body !== undefined;
  if (hasBody) requestHeaders["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: combinedSignal,
    });
  } catch (err) {
    // Network fail / abort / timeout. Bọc lại kèm context, không nuốt.
    const reason = timeoutSignal.aborted ? `timeout sau ${timeoutMs}ms` : describeError(err);
    throw new OperationalError(`Gọi vận hành thất bại (${reason})`, 0, method, path, "");
  }

  const text = await response.text();

  if (!response.ok) {
    throw new OperationalError(
      `Vận hành trả ${response.status} cho ${method} ${path}`,
      response.status,
      method,
      path,
      text.slice(0, MAX_ERROR_BODY),
    );
  }

  if (text === "") return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OperationalError(
      `Response vận hành không phải JSON hợp lệ (${method} ${path})`,
      response.status,
      method,
      path,
      text.slice(0, MAX_ERROR_BODY),
    );
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Helper GET. */
export function opGet(path: string, options?: Omit<RequestOptions, "body">): Promise<unknown> {
  return opRequest("GET", path, options);
}

/** Helper POST. */
export function opPost(path: string, options?: RequestOptions): Promise<unknown> {
  return opRequest("POST", path, options);
}
