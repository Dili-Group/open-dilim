// index.ts — COMPOSITION ROOT. Nơi DUY NHẤT wiring toàn hệ thống (ARCHITECTURE.md §bootstrap).
// Đổi broker/adapter/provider chỉ sửa ở đây; tầng khác nhận qua port, không tự dựng kết nối.
//
// bootstrap() = dựng service (DI). start() = bootstrap + khởi động gateway + worker pool.
// src/index.ts (entrypoint) chỉ gọi start() rồi wire signal shutdown.

import { startGateway, type IngestDeps } from "../message-ingest/index.ts";
import { buildSkillRegistry, type SkillRegistry } from "../skills/index.ts";
import { flashRegistry } from "../flash-command/index.ts";
import { closeDb } from "../db/client.ts";
import { closeRedis, commandOf, redis } from "../redis/client.ts";
import { buildBroker } from "../broker/index.ts";
import { buildLlmProvider } from "../llm/index.ts";
import { buildAgentRegistry, type AgentRegistry } from "../agents/index.ts";
import {
  BroadcastRouter,
  ConsoleBroadcaster,
  ConsoleTypingSender,
  TypingFactory,
  ZaloBroadcaster,
  ZaloTypingSender,
} from "../broadcast/index.ts";
import {
  CachedIdentityResolver,
  SqlGroupCustomerLookup,
  SqlIdentityRepo,
  SqlIdentityResolver,
} from "../auth/index.ts";
import { OperationalOpsPort } from "../operational/ops-port.ts";
import { AgentApiClient } from "../operational/agent-api.ts";
import { AgentApiOrderPort } from "../operational/order-api.ts";
import { AgentApiDealerPort } from "../operational/profile-api.ts";
import { AgentApiDailyPort } from "../operational/daily-api.ts";
import {
  buildDedupe,
  buildHistoryStore,
  buildMemoryStore,
  buildMemoryWriters,
  buildCompactor,
  type MemoryStore,
} from "../state/index.ts";
import { startWorkers } from "../worker/index.ts";
import { SqlJobRepo, startScheduler } from "../scheduler/index.ts";
import { checkInfra, loadConfig } from "./env.ts";
import { type RunningSystem, type Services } from "./container.ts";

/**
 * Dựng mọi service (DI). Fail-fast: env thiếu (loadConfig) / DB+Redis chưa lên (checkInfra) /
 * consumer group không tạo được (buildBroker) / skill def hỏng đều throw TRƯỚC khi mở port.
 */
export async function bootstrap(): Promise<Services> {
  const config = loadConfig();
  await checkInfra();
  const skills = await buildSkillRegistry();

  // Port ingress trên Redis — 1 instance broker, 2 góc nhìn: publish (ingest) + take/ack (worker).
  // History cũng 1 instance: ingest append, worker recent. State nằm ngoài process → restart app
  // không mất queue lẫn ngữ cảnh ngắn hạn.
  const broker = await buildBroker();
  const history = buildHistoryStore();
  const dedupe = buildDedupe();
  const ingestDeps: IngestDeps = { broker, history, dedupe };

  const llm = buildLlmProvider(config);
  // Memory dài hạn cần embedder Gemini (buildEmbedder throw nếu thiếu key). Không có key → chạy
  // KHÔNG có trí nhớ dài hạn thay vì chặn boot: agent vẫn trả lời được bằng history ngắn hạn.
  let memory: MemoryStore | undefined;
  if (config.geminiApiKey === undefined) {
    console.warn("[bootstrap] thiếu GEMINI_API_KEY → tắt trí nhớ dài hạn (recall bỏ qua).");
  } else {
    memory = buildMemoryStore();
  }

  // skills đi thẳng vào agent: catalog vào system prompt + backing cho tool use_skill.
  // memory = cổng CHỈ-ĐỌC; scope (phòng nào) do worker cấp từng lượt qua groupCustomer.
  // orders = API vận hành `/agent/*`; đại lý của từng lượt đi lên header, client không giữ state.
  // Một client cho mọi endpoint `/agent/*` (orders + profile): cùng base URL, cùng service token,
  // không giữ state theo đại lý — đại lý của từng lượt đi lên header.
  const agentApi = new AgentApiClient(config.agentApi);
  const orders = new AgentApiOrderPort(agentApi);
  const dealer = new AgentApiDealerPort(agentApi);
  const daily = new AgentApiDailyPort(agentApi);
  const agents = buildAgentRegistry({
    provider: llm,
    config,
    skills,
    memory,
    orders,
    dealer,
    daily,
  });
  assertSkillAgentScopes(skills, agents);

  // Đường GHI dựng SAU agents vì nó theo `memorySpec` của từng agent: agent vận hành nhớ việc,
  // agent đại lý nhớ khách — cùng một writer là chưng cất sai prompt cho một nửa số agent.
  const memoryWriters =
    memory === undefined
      ? undefined
      : buildMemoryWriters(memory, new Map(agents.all().map((a) => [a.agentType, a.memorySpec])));
  // Egress: fallback console cho channel chưa có adapter. Zalo có bridge config → gửi thật (cả
  // reply lẫn typing), thiếu config → console cho cả hai (dev thấy được luồng, không chặn boot).
  const broadcaster = new BroadcastRouter(new ConsoleBroadcaster());
  const typing = new TypingFactory(new ConsoleTypingSender());
  for (const [channel, channelConfig] of Object.entries(config.channels)) {
    if (channelConfig === undefined) continue;
    if (channelConfig.bridge === undefined) {
      console.warn(`[bootstrap] kênh ${channel} thiếu *_BRIDGE_URL/SECRET → egress dùng console.`);
      continue;
    }
    // Bridge của CHÍNH tài khoản kênh đó — đăng ký theo tên kênh để không gửi nhầm tài khoản.
    broadcaster.register(channel, new ZaloBroadcaster(channelConfig.bridge));
    typing.register(channel, new ZaloTypingSender(channelConfig.bridge));
  }
  // Nén hội thoại ngắn hạn: theo phòng (conversationId), KHÔNG theo MemoryScope → chạy cho cả
  // phòng chưa `/ketnoi-daily`. Không cần embedder nên bật kể cả khi tắt trí nhớ dài hạn.
  const { compactor, summaries } = buildCompactor();
  const groupCustomer = new SqlGroupCustomerLookup();
  // Cache-aside Redis (session 8h) chặn trước Postgres; chỉ cache nhân_viên/đại_lý.
  const identity = new CachedIdentityResolver(new SqlIdentityResolver(groupCustomer), commandOf(redis));
  // Port flash command: ghi định danh (Postgres) + gọi hệ vận hành (verify token, tra đại lý).
  const identityRepo = new SqlIdentityRepo(commandOf(redis));
  const ops = new OperationalOpsPort();
  // MỘT instance cho cả hai đầu: poller đọc/claim, flash command `/lich` thêm-sửa-xoá. Cùng bảng
  // scheduler_jobs → việc nhân viên vừa đặt là việc tick sau lên lịch.
  const jobs = new SqlJobRepo();

  return {
    config,
    ingestDeps,
    skills,
    flash: flashRegistry,
    identityRepo,
    ops,
    jobs,
    llm,
    agents,
    broadcaster,
    typing,
    identity,
    groupCustomer,
    broker,
    historyReader: history,
    historyWriter: history,
    memoryWriters,
    compactor,
    summaries,
  };
}

/**
 * Bootstrap + khởi động HTTP gateway (ingress) + worker pool (processing). Trả RunningSystem
 * có stop() cho graceful shutdown (drain worker → đóng server → đóng pool DB).
 */
export async function start(): Promise<RunningSystem> {
  const services = await bootstrap();
  const server = startGateway(services.ingestDeps, services.config.port);
  const workers = startWorkers({
    broker: services.broker,
    history: services.historyReader,
    historyWriter: services.historyWriter,
    identity: services.identity,
    flash: services.flash,
    identityRepo: services.identityRepo,
    ops: services.ops,
    jobs: services.jobs,
    groupCustomer: services.groupCustomer,
    memoryWriters: services.memoryWriters,
    compactor: services.compactor,
    summaries: services.summaries,
    agents: services.agents,
    broadcaster: services.broadcaster,
    typing: services.typing,
    workerCount: services.config.workerCount,
    turnTimeoutMs: services.config.turnTimeoutMs,
  });

  // Nguồn trigger theo THỜI GIAN (§8). Dùng lại đúng broker/history/dedupe của ingest → lượt cron
  // đi chung queue, chung history phòng, chung cửa sổ dedupe với tin người dùng.
  const scheduler = startScheduler(
    {
      repo: services.jobs,
      broker: services.ingestDeps.broker,
      history: services.historyWriter,
      dedupe: services.ingestDeps.dedupe,
      // Báo trước "sắp chạy job" cho phòng — dùng chung egress với worker.
      typing: services.typing,
      broadcaster: services.broadcaster,
    },
    services.config.schedulerTickMs,
  );

  async function stop(): Promise<void> {
    await scheduler.stop(); // ngừng bắn job mới TRƯỚC khi drain worker
    await workers.stop(); // ngừng nhận việc mới, chờ worker đang chạy xong
    await server.stop(true); // đóng cả connection đang mở
    await closeDb();
    closeRedis(); // sau workers.stop(): lệnh XACK cuối cùng đã đi xong
  }

  return { services, server, stop };
}

export { bootstrap as default };
export type { RunningSystem, Services } from "./container.ts";

/**
 * Skill khai `agents:` một tên không có root agent nào → skill đó VÔ HÌNH với mọi agent, và không
 * ai biết cho tới khi khách hỏi trúng nghiệp vụ đó. Gõ sai tên là lỗi soạn skill → chặn ngay ở boot.
 */
function assertSkillAgentScopes(skills: SkillRegistry, agents: AgentRegistry): void {
  const known = new Set(agents.all().map((agent) => agent.agentType));
  for (const meta of skills.catalog()) {
    for (const name of meta.agents ?? []) {
      if (!known.has(name)) {
        throw new Error(
          `Skill "${meta.name}" khai agents: "${name}" — không có root agent nào tên vậy ` +
            `(có: ${[...known].sort().join(", ")}).`,
        );
      }
    }
  }
}
