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

/**
 * Zalo chat cá nhân: verify HMAC-SHA256 rawBody với `webhookSecret`.
 *
 * `bridge` = egress CỦA CHÍNH tài khoản này (mỗi tài khoản Zalo chạy bridge riêng). Để trong
 * config kênh chứ không tách global: một bridge dùng chung cho nhiều kênh = gửi nhầm tài khoản.
 * undefined = chưa cấu hình egress → kênh đó fallback console (dev), ingest vẫn chạy.
 */
export interface ZaloChannelConfig extends BaseChannelConfig {
  readonly webhookSecret: string;
  readonly bridge?: ZaloBridgeConfig;
}

/**
 * Đọc config 1 kênh Zalo theo tiền tố env: `<PREFIX>_AGENT_UID`, `<PREFIX>_WEBHOOK_SECRET`,
 * `<PREFIX>_BRIDGE_URL`, `<PREFIX>_BRIDGE_SECRET`.
 *
 * Thiếu uid/secret → undefined = kênh KHÔNG đăng ký: webhook trả 404, không có agent nào phục vụ.
 * Đó là mặc định đóng, không phải lỗi boot — 4 kênh khai sẵn nhưng chỉ kênh đã mở tài khoản chạy.
 */
function zaloChannel(prefix: string): ZaloChannelConfig | undefined {
  const agentUid = optional(`${prefix}_AGENT_UID`);
  const webhookSecret = optional(`${prefix}_WEBHOOK_SECRET`);
  if (agentUid === undefined || webhookSecret === undefined) return undefined;
  return { agentUid, webhookSecret, bridge: zaloBridge(prefix) };
}

// Mỗi key = 1 kênh = 1 tài khoản Zalo riêng, và là KHOÁ ĐỊNH TUYẾN root agent (agents/router.ts).
// Tên key đi vào: path webhook `/webhook/:channel`, cột `channel` của user_binding/group_map/
// group_member, và key egress. ĐỔI TÊN KÊNH ĐANG CHẠY = mồ côi toàn bộ định danh đã bind.
//
// Thêm kênh: thêm 1 key ở đây + 1 dòng bảng ở agents/router.ts. Platform khác (Telegram) khai
// type config riêng, không dùng lại ZaloChannelConfig.
const channels = {
  zalo: zaloChannel("ZALO"), // đại lý — kênh đang chạy thật
  "zalo-vanhanh": zaloChannel("ZALO_VANHANH"), // nhân viên vận hành
  "zalo-sep": zaloChannel("ZALO_SEP"), // ban lãnh đạo
  "zalo-canhan": zaloChannel("ZALO_CANHAN"), // trợ lý riêng 1-1
} as const;

// Egress Zalo qua bridge HTTP nội bộ (send text + typing). Ingest = verify webhook đến; bridge =
// gọi ra — hai chiều tách nhau, nhưng CÙNG một tài khoản nên bridge nằm trong config kênh.
// Cả 2 env phải có cùng nhau (URL vô nghĩa nếu thiếu secret auth).
export interface ZaloBridgeConfig {
  readonly baseUrl: string;
  readonly secret: string;
}
function zaloBridge(prefix: string): ZaloBridgeConfig | undefined {
  const baseUrl = optional(`${prefix}_BRIDGE_URL`);
  const secret = optional(`${prefix}_BRIDGE_SECRET`);
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

  // Kênh chat — message-ingest verify webhook + gate mention theo agentUid per kênh; egress
  // (bridge) và root agent phục vụ kênh đều tra theo cùng tên kênh này.
  channels,

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
