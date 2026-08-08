// sentry.ts — cổng DUY NHẤT tới Sentry. Thiếu SENTRY_DSN → mọi hàm no-op, app chạy như cũ
// (dev/local không cần tài khoản Sentry vẫn chạy được).
//
// KHÔNG gửi nội dung tin nhắn / PII lên Sentry (CLAUDE.md §Secrets & I/O). Chỉ đính kèm định
// danh (msgId, conversationId, kênh, tên tool, tên job) — đủ để tra ngược log, không lộ hội thoại.
//
// Module này KHÔNG import config.ts: init nhận config từ entrypoint, nhờ vậy các tầng khác
// import captureError mà không kéo theo validate env (test không cần dựng đủ env).

import * as Sentry from "@sentry/bun";

export interface SentryConfig {
  readonly dsn: string | undefined;
  readonly environment: string;
  readonly release: string | undefined;
  readonly tracesSampleRate: number;
}

/** Nhãn đính kèm lỗi. CHỈ định danh, không chứa nội dung tin nhắn. */
export type ErrorTags = Readonly<Record<string, string>>;

/** Trần thời gian đẩy nốt event lúc shutdown. Quá hạn → bỏ, không giữ process. */
const FLUSH_TIMEOUT_MS = 2000;

/**
 * Mức console được bốc lên Sentry Logs. Bỏ "debug"/"trace"/"assert": ồn, và debug là nơi
 * dễ lỡ in nội dung tin nhắn nhất (CLAUDE.md §Secrets & I/O).
 */
const CAPTURED_CONSOLE_LEVELS = ["log", "info", "warn", "error"] as const;

let enabled = false;

/** Bật báo lỗi từ xa. Gọi một lần, sớm nhất có thể trong entrypoint. */
export function initSentry(config: SentryConfig): void {
  if (config.dsn === undefined) {
    console.warn("[sentry] thiếu SENTRY_DSN → tắt báo lỗi từ xa.");
    return;
  }
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
    // IP/cookie/header người dùng là dữ liệu khách hàng → không đính kèm.
    sendDefaultPii: false,
    // Logs: mọi console.* của app chảy sang Sentry Logs, không phải sửa 50+ call site.
    enableLogs: true,
    integrations: [Sentry.consoleLoggingIntegration({ levels: [...CAPTURED_CONSOLE_LEVELS] })],
  });
  enabled = true;
}

/**
 * Báo lỗi lên Sentry. Không throw, không await — đường xử lý lỗi không được đẻ thêm lỗi.
 * `where` = tên điểm bắt (vd "worker.turn") → group issue theo BIÊN, không theo message.
 */
export function captureError(err: unknown, where: string, tags: ErrorTags = {}): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTag("where", where);
    for (const [key, value] of Object.entries(tags)) scope.setTag(key, value);
    Sentry.captureException(err);
  });
}

/** Đẩy nốt event còn trong hàng đợi trước khi process thoát. */
export async function flushSentry(timeoutMs: number = FLUSH_TIMEOUT_MS): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch (err) {
    console.error("[sentry] flush lỗi:", err);
  }
}
