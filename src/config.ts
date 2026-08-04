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

const provider = oneOf("PROVIDER", PROVIDERS, "anthropic");

// Credential khớp provider đang chọn. Provider khác không cần key → optional.
const anthropicApiKey =
  provider === "anthropic" ? required("ANTHROPIC_API_KEY") : optional("ANTHROPIC_API_KEY");
const geminiApiKey =
  provider === "gemini" ? required("GEMINI_API_KEY") : optional("GEMINI_API_KEY");

export const CONFIG = {
  // Sandbox root — mọi file/shell op giới hạn trong đây.
  workdir: process.cwd(),

  // Infra
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),

  // Kênh chat — message-ingest verify webhook + gate mention theo agentUid per kênh.
  channels,

  // Hệ thống vận hành — mọi request kèm header service-token (xem operational/client.ts).
  operational: {
    baseUrl: required("OPERATIONAL_BASE_URL"),
    serviceToken: required("OPERATIONAL_SERVICE_TOKEN"),
  },

  // LLM
  provider,
  model: required("MODEL"),
  effort: oneOf("EFFORT", EFFORTS, "medium"),
  anthropicApiKey,
  geminiApiKey,
} as const;

export type Config = typeof CONFIG;
