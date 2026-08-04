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

  // LLM
  provider,
  model: required("MODEL"),
  effort: oneOf("EFFORT", EFFORTS, "medium"),
  anthropicApiKey,
  geminiApiKey,
} as const;

export type Config = typeof CONFIG;
