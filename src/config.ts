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
/**
 * Kênh của nhân viên vận hành. Đặt tên vì có nơi phải TRA ĐÍCH DANH kênh này chứ không phải
 * "kênh nào cũng được": người duyệt phát tin chỉ được hỏi qua đây (xem `announcements/`).
 */
export const OPERATIONS_CHANNEL = "van-hanh";

const channels = {
  zalo: zaloChannel("ZALO"), // đại lý — kênh đang chạy thật
  [OPERATIONS_CHANNEL]: zaloChannel("ZALO_VANHANH"), // nhân viên vận hành
  "zalo-sep": zaloChannel("ZALO_SEP"), // ban lãnh đạo
  "zalo-canhan": zaloChannel("ZALO_CANHAN"), // trợ lý riêng 1-1
  "zalo-kho": zaloChannel("ZALO_KHO"), // kho — nhóm nhận mã vận đơn hoàn
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

/** Env danh sách ngăn bằng dấu phẩy → mảng đã trim, bỏ phần rỗng. Thiếu env → mảng rỗng. */
function csvEnv(name: string): readonly string[] {
  const raw = optional(name);
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
}

/** Env cờ bật/tắt optional. Chỉ "true"/"1" là bật — mọi giá trị khác coi như tắt (fail-closed). */
function boolEnv(name: string, fallback: boolean): boolean {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

// Server MCP (Model Context Protocol) — nguồn tool NGOÀI hệ thống.
//
// Khai bằng MỘT env JSON vì số server là động (khác kênh chat: kênh có tập cố định, khai theo tiền
// tố được; server MCP thì không):
//
//   MCP_SERVERS=[{"name":"github","url":"https://...","token":"...","tools":["search_issues"]}]
//
// `tools` là ALLOWLIST BẮT BUỘC: server khai 40 tool không có nghĩa agent được dùng cả 40 — mỗi
// tool là tiền token cố định mỗi lượt và một cửa nữa cho câu lái trong nhóm đi qua. Rỗng = từ chối
// ngay ở boot (khai server rồi không bật tool nào là gõ nhầm, không phải chủ đích).
const MCP_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
// Tên tool phía provider LLM chỉ nhận [A-Za-z0-9_-] và trần 128 ký tự. Tên cuối cùng model thấy
// là `mcp__<server>__<tool>` → chặn độ dài ở đây để không bao giờ chạm trần đó.
const MCP_TOOL_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface McpServerEnv {
  readonly name: string;
  readonly url: string;
  readonly token?: string;
  readonly tools: readonly string[];
}

function mcpServersFromEnv(): readonly McpServerEnv[] {
  const raw = optional("MCP_SERVERS");
  if (raw === undefined) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid env MCP_SERVERS: không phải JSON hợp lệ (${describeError(err)}).`, {
      cause: err,
    });
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid env MCP_SERVERS: phải là mảng JSON các server.");
  }

  const servers: McpServerEnv[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    const server = readMcpServer(entry);
    if (seen.has(server.name)) {
      throw new Error(`Invalid env MCP_SERVERS: trùng tên server "${server.name}".`);
    }
    seen.add(server.name);
    servers.push(server);
  }
  return servers;
}

function readMcpServer(entry: unknown): McpServerEnv {
  if (typeof entry !== "object" || entry === null) {
    throw new Error("Invalid env MCP_SERVERS: mỗi phần tử phải là object.");
  }
  const record = entry as Record<string, unknown>;

  const name = record.name;
  if (typeof name !== "string" || !MCP_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid env MCP_SERVERS: "name" phải khớp ${MCP_NAME_PATTERN.source} (nhận: ${String(name)}).`,
    );
  }

  const url = record.url;
  if (typeof url !== "string" || !isHttpUrl(url)) {
    throw new Error(`Invalid env MCP_SERVERS[${name}]: "url" phải là http(s) URL hợp lệ.`);
  }

  const tools = record.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error(
      `Invalid env MCP_SERVERS[${name}]: "tools" phải là mảng KHÔNG RỖNG tên tool được bật.`,
    );
  }
  for (const tool of tools) {
    if (typeof tool !== "string" || !MCP_TOOL_PATTERN.test(tool)) {
      throw new Error(
        `Invalid env MCP_SERVERS[${name}]: tên tool "${String(tool)}" không hợp lệ ` +
          `(cần khớp ${MCP_TOOL_PATTERN.source}).`,
      );
    }
  }

  const token = record.token;
  if (token !== undefined && typeof token !== "string") {
    throw new Error(`Invalid env MCP_SERVERS[${name}]: "token" phải là chuỗi.`);
  }

  return {
    name,
    url,
    tools: tools as readonly string[],
    ...(token === undefined || token === "" ? {} : { token }),
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Env tỉ lệ 0..1 optional với fallback. Sai kiểu/ngoài khoảng → throw (fail fast). */
function rateEnv(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid env ${name}=${raw}. Expected number 0..1.`);
  }
  return parsed;
}

// Trần output token/lần gọi LLM. Non-streaming → giữ ~16k tránh timeout HTTP (xem claude-api).
const DEFAULT_MAX_TOKENS = 16000;
// Số worker chạy song song trong pool.
const DEFAULT_WORKER_COUNT = 4;
// Trần vòng lặp agent (LLM⇄tools) — chặn loop vô hạn nếu model cứ gọi tool.
const DEFAULT_AGENT_MAX_ITERATIONS = 8;
// Trần thời gian MỘT lượt (auth → agent → broadcast). Số vòng lặp có trần rồi, nhưng mỗi vòng
// vẫn treo được (SDK LLM tự retry, mạng lặng) mà lock phòng thì đang giữ → phải có deadline.
const DEFAULT_TURN_TIMEOUT_MS = 20_000;
// Nhịp quét job cron. Lịch nhỏ nhất là phút → 30s đủ để không trễ quá một phút.
const DEFAULT_SCHEDULER_TICK_MS = 30_000;
// Model đọc ảnh đính kèm — con rẻ nhất còn hiểu được ảnh, gọi mỗi lần đại lý gửi ảnh.
const DEFAULT_VISION_MODEL = "gemini-3.1-flash-lite";
// Trần thời gian bắt tay + `tools/list` với một server MCP lúc boot. Server chết không được làm
// chậm cả app — quá hạn thì bỏ server đó, boot tiếp.
const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 5_000;
// Trần MỘT lần gọi tool MCP. Phải NHỎ HƠN TURN_TIMEOUT_MS: server ngoài treo mà lượt hết giờ thì
// khách không nhận được câu nào, còn tool hết giờ thì model vẫn kịp nói "chưa tra được".
const DEFAULT_MCP_CALL_TIMEOUT_MS = 10_000;
// Tỉ giá quy trần VND → USD (giá gateway tính bằng USD). Xấp xỉ là đủ: nó chỉ dịch trần vài %,
// không phải con số kế toán. Chỉnh khi tỉ giá lệch nhiều.
const DEFAULT_USD_VND_RATE = 26_000;

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

  // API hệ vận hành — CHUNG cho cả agent-session (verify token, tra đại lý) lẫn nghiệp vụ
  // `/agent/*` (tra đơn, camera): cùng một backend, cùng một service token.
  // Vd DILIM_API_URL=https://api.dilisupplement.com/api (kèm cả tiền tố /api).
  agentApi: {
    baseUrl: required("DILIM_API_URL"),
    serviceToken: required("SERVICE_TOKEN_AGENT_API"),
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

  // ĐỌC ẢNH đính kèm (tool `xem_anh`). Luôn Gemini, độc lập PROVIDER của agent — giống embedder:
  // đọc ảnh là việc lặt vặt tần suất cao, chạy con rẻ.
  //
  // `allowedHosts` = danh sách host CDN được phép TẢI. Fail-closed: rỗng = không tải ảnh nào (link
  // ảnh đến từ webhook, tải bừa là mở đường gọi thẳng vào mạng nội bộ). Khớp đúng host hoặc
  // subdomain của nó — vd "cdn.dili.vn" khớp cả "img.cdn.dili.vn".
  vision: {
    model: optional("VISION_MODEL") ?? DEFAULT_VISION_MODEL,
    allowedHosts: csvEnv("CDN_ALLOWED_HOSTS"),
  },

  // Tool NGOÀI qua giao thức MCP (mcp/). Nối lúc boot, danh sách tool chốt một lần rồi cache.
  //
  // `servers` rỗng = không nối server nào (mặc định) → không agent nào thấy tool MCP. Bật một
  // server mới chỉ là thêm một phần tử ở MCP_SERVERS + khai tên server đó vào profile agent cần
  // (agents/roots/*.ts) — hai cửa, phải mở cả hai.
  mcp: {
    servers: mcpServersFromEnv(),
    connectTimeoutMs: positiveIntEnv("MCP_CONNECT_TIMEOUT_MS", DEFAULT_MCP_CONNECT_TIMEOUT_MS),
    callTimeoutMs: positiveIntEnv("MCP_CALL_TIMEOUT_MS", DEFAULT_MCP_CALL_TIMEOUT_MS),
  },

  // Hạn mức chi phí LLM theo phòng/ngày (usage/). Trần khai bằng VND theo agent ở
  // usage/budget.ts (policy, không phải env); ở đây chỉ hai thứ thật sự thay đổi theo môi trường:
  //
  //  - `usdVndRate`: giá gateway tính bằng USD, trần khai bằng VND → cần tỉ giá để quy đổi. Chỉ
  //    dùng ĐÚNG MỘT LẦN lúc so trần, không quy đổi lại mỗi request.
  //  - `enforceBudget`: false = chỉ ĐO và ghi sổ, KHÔNG chặn (shadow mode). Mặc định tắt có chủ
  //    đích — bật chặn bằng số đoán rồi khoá nhầm nhóm đại lý đang đặt hàng thì đắt hơn nhiều so
  //    với tiền LLM tiết kiệm được. Chạy đo vài ngày, lấy số thật rồi mới bật.
  usdVndRate: positiveIntEnv("USD_VND_RATE", DEFAULT_USD_VND_RATE),
  enforceBudget: boolEnv("ENFORCE_BUDGET", false),

  // Worker pool + agent loop
  workerCount: positiveIntEnv("WORKER_COUNT", DEFAULT_WORKER_COUNT),
  agentMaxIterations: DEFAULT_AGENT_MAX_ITERATIONS,
  turnTimeoutMs: positiveIntEnv("TURN_TIMEOUT_MS", DEFAULT_TURN_TIMEOUT_MS),

  // Scheduler (§8) — job def nằm ở bảng scheduler_jobs, đây chỉ là nhịp quét.
  schedulerTickMs: positiveIntEnv("SCHEDULER_TICK_MS", DEFAULT_SCHEDULER_TICK_MS),

  // Phát tin chung tới MỌI nhóm đại lý (kho báo hết hàng — announcements/).
  //
  // `approverUserId` = user_id hệ vận hành của người DUY NHẤT được duyệt phát tin (SWE Nguyễn
  // Công Giới). Là user_id chứ không phải senderId: senderId đổi khi đổi thiết bị/kênh, user_id
  // thì không. Không phải role_slug: quy tắc chỉ đích danh MỘT người, không phải một chức danh.
  //
  // optional() chứ không required() để deployment cũ vẫn boot — nhưng KHÔNG có nghĩa mở cửa:
  // thiếu env này thì service từ chối mọi lượt chốt phát tin (fail-closed, xem announcements/).
  announce: {
    approverUserId: optional("ANNOUNCE_APPROVER_USER_ID"),
  },

  // Sentry (báo lỗi từ xa). Optional: thiếu SENTRY_DSN → tắt hẳn, app chạy như cũ.
  // tracesSampleRate mặc định 0 = chỉ gửi lỗi, không gửi trace (trace tốn quota, chưa cần).
  sentry: {
    dsn: optional("SENTRY_DSN"),
    environment: optional("SENTRY_ENVIRONMENT") ?? optional("NODE_ENV") ?? "development",
    release: optional("SENTRY_RELEASE"),
    tracesSampleRate: rateEnv("SENTRY_TRACES_SAMPLE_RATE", 0),
  },
} as const;

export type Config = typeof CONFIG;
