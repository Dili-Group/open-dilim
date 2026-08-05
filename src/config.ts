// config.ts — SINGLE SOURCE OF TRUTH cho env/secret.
// Không đọc process.env ở nơi khác. Resolve + validate 1 lần lúc khởi động.

const PROVIDERS = ["anthropic", "gemini"] as const;
export type Provider = (typeof PROVIDERS)[number];

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Lấy env bắt buộc. Thiếu → throw ngay (fail fast, không chạy nửa vời). */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

/** Lấy env optional, không throw. */
function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/** Ép env vào tập giá trị cho phép. Sai → throw kèm giá trị hợp lệ. */
function oneOf<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(
    `Invalid env ${name}=${value}. Allowed: ${allowed.join(", ")}`,
  );
}

// Config kênh chat. `agentUid` (id agent trên kênh — gate mention + phân biệt group/direct)
// là field CHUNG mọi kênh. Phần verify khác nhau mỗi platform → mỗi kênh 1 type riêng, adapter
// tự sở hữu. Gateway KHÔNG đọc config kênh; wiring (buildChannelFactory) cấp cho từng adapter.
export interface BaseChannelConfig {
  readonly agentUid: string;
}

/** Zalo chat cá nhân: verify HMAC-SHA256 rawBody với `webhookSecret`. */
export interface ZaloChannelConfig extends BaseChannelConfig {
  readonly webhookSecret: string;
}

// Thêm kênh: khai type extends BaseChannelConfig + helper đọc env + thêm key vào `channels`.
// vd sau này: ZaloOaChannelConfig { appId, oaSecret }, TelegramChannelConfig { secretToken }.
function zaloChannel(): ZaloChannelConfig | undefined {
  const agentUid = optional("ZALO_AGENT_UID");
  const webhookSecret = optional("ZALO_WEBHOOK_SECRET");
  if (agentUid === undefined || webhookSecret === undefined) return undefined;
  return { agentUid, webhookSecret };
}

// Mỗi key = 1 kênh, type riêng (không Record đồng nhất). undefined = kênh chưa cấu hình.
const channels = {
  zalo: zaloChannel(),
} as const;

// Egress Zalo qua bridge HTTP nội bộ (send text + typing). Tách khỏi ingest channel config:
// ingest = verify webhook đến; bridge = gọi ra. undefined = chưa cấu hình → egress Zalo tắt
// (dev fallback console). Cả 2 env phải có cùng nhau (URL vô nghĩa nếu thiếu secret auth).
export interface ZaloBridgeConfig {
  readonly baseUrl: string;
  readonly secret: string;
}
function zaloBridge(): ZaloBridgeConfig | undefined {
  const baseUrl = optional("ZALO_BRIDGE_URL");
  const secret = optional("ZALO_BRIDGE_SECRET");
  if (baseUrl === undefined || secret === undefined) return undefined;
  return { baseUrl, secret };
}

// Cổng HTTP gateway. Optional — mặc định 3000. Ép integer hợp lệ (fail fast nếu sai).
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
function portFromEnv(): number {
  const raw = optional("PORT");
  if (raw === undefined) return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_PORT) {
    throw new Error(`Invalid env PORT=${raw}. Expected integer 1-${MAX_PORT}.`);
  }
  return parsed;
}

/** Env integer dương optional với fallback. Sai kiểu → throw (fail fast). */
function positiveIntEnv(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid env ${name}=${raw}. Expected positive integer.`);
  }
  return parsed;
}

// Trần output token/lần gọi LLM. Non-streaming → giữ ~16k tránh timeout HTTP (xem claude-api).
const DEFAULT_MAX_TOKENS = 16000;
// Số worker chạy song song trong pool.
const DEFAULT_WORKER_COUNT = 4;
// Trần vòng lặp agent (LLM⇄tools) — chặn loop vô hạn nếu model cứ gọi tool.
const DEFAULT_AGENT_MAX_ITERATIONS = 8;

const provider = oneOf("PROVIDER", PROVIDERS, "anthropic");

// Credential khớp provider đang chọn. Provider khác không cần key → optional.
const anthropicApiKey =
  provider === "anthropic" ? required("ANTHROPIC_API_KEY") : optional("ANTHROPIC_API_KEY");
const geminiApiKey =
  provider === "gemini" ? required("GEMINI_API_KEY") : optional("GEMINI_API_KEY");

// Endpoint Anthropic-compatible thay api.anthropic.com (gateway/proxy nội bộ, model non-Claude).
// undefined = dùng endpoint mặc định của SDK.
const anthropicBaseUrl = optional("ANTHROPIC_BASE_URL");

export const CONFIG = {
  // Sandbox root — mọi file/shell op giới hạn trong đây.
  workdir: process.cwd(),

  // Infra
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),

  // HTTP gateway (ingress webhook) nghe cổng này.
  port: portFromEnv(),

  // Kênh chat — message-ingest verify webhook + gate mention theo agentUid per kênh.
  channels,

  // Egress Zalo qua bridge nội bộ. undefined = chưa cấu hình (dev fallback console).
  zaloBridge: zaloBridge(),

  // Hệ thống vận hành — mọi request kèm header service-token (xem operational/client.ts).
  operational: {
    baseUrl: required("OPERATIONAL_BASE_URL"),
    serviceToken: required("OPERATIONAL_SERVICE_TOKEN"),
  },

  // LLM
  provider,
  model: required("MODEL"),
  // Con nhẹ cho việc tóm-rút ghi nhớ (distill + rolling summary) — chạy ngầm, tần suất cao.
  // Cùng provider với agent; mặc định = model chính nếu không set MEMORY_MODEL.
  memoryModel: optional("MEMORY_MODEL") ?? required("MODEL"),
  effort: oneOf("EFFORT", EFFORTS, "medium"),
  maxTokens: positiveIntEnv("MAX_TOKENS", DEFAULT_MAX_TOKENS),
  anthropicApiKey,
  anthropicBaseUrl,
  geminiApiKey,

  // Worker pool + agent loop
  workerCount: positiveIntEnv("WORKER_COUNT", DEFAULT_WORKER_COUNT),
  agentMaxIterations: DEFAULT_AGENT_MAX_ITERATIONS,
} as const;

export type Config = typeof CONFIG;
