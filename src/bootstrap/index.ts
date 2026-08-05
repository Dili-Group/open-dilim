// index.ts — COMPOSITION ROOT. Nơi DUY NHẤT wiring toàn hệ thống (ARCHITECTURE.md §bootstrap).
// Đổi broker/adapter/provider chỉ sửa ở đây; tầng khác nhận qua port, không tự dựng kết nối.
//
// bootstrap() = dựng service (DI). start() = bootstrap + khởi động gateway + worker pool.
// src/index.ts (entrypoint) chỉ gọi start() rồi wire signal shutdown.

import { startGateway, type IngestDeps } from "../message-ingest/index.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import { flashRegistry } from "../flash-command/index.ts";
import { closeDb } from "../db/client.ts";
import { closeRedis } from "../redis/client.ts";
import { buildBroker } from "../broker/index.ts";
import { buildLlmProvider } from "../llm/index.ts";
import { buildAgentRegistry } from "../agents/index.ts";
import {
  ConsoleBroadcaster,
  ConsoleTypingSender,
  TypingFactory,
  ZaloTypingSender,
} from "../broadcast/index.ts";
import { SqlGroupCustomerLookup, SqlIdentityResolver } from "../auth/index.ts";
import { buildDedupe, buildHistoryStore, buildMemoryStore } from "../state/index.ts";
import { startWorkers } from "../worker/index.ts";
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
  let memory: ReturnType<typeof buildMemoryStore> | undefined;
  if (config.geminiApiKey === undefined) {
    console.warn("[bootstrap] thiếu GEMINI_API_KEY → tắt trí nhớ dài hạn (recall bỏ qua).");
  } else {
    memory = buildMemoryStore();
  }

  // skills đi thẳng vào agent: catalog vào system prompt + backing cho tool use_skill.
  // memory = cổng CHỈ-ĐỌC; scope (phòng nào) do worker cấp từng lượt qua groupCustomer.
  const agents = buildAgentRegistry({ provider: llm, config, skills, memory });
  const broadcaster = new ConsoleBroadcaster();
  // Fallback console cho channel chưa có adapter egress. Zalo: có bridge config → sender thật,
  // thiếu → vẫn console (typing best-effort, không chặn boot).
  const typing = new TypingFactory(new ConsoleTypingSender());
  if (config.zaloBridge !== undefined) {
    typing.register("zalo", new ZaloTypingSender(config.zaloBridge));
  } else {
    console.warn("[bootstrap] thiếu ZALO_BRIDGE_URL/SECRET → typing Zalo dùng console (dev).");
  }
  const groupCustomer = new SqlGroupCustomerLookup();
  const identity = new SqlIdentityResolver(groupCustomer);

  return {
    config,
    ingestDeps,
    skills,
    flash: flashRegistry,
    llm,
    agents,
    broadcaster,
    typing,
    identity,
    groupCustomer,
    broker,
    historyReader: history,
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
    identity: services.identity,
    groupCustomer: services.groupCustomer,
    agents: services.agents,
    broadcaster: services.broadcaster,
    typing: services.typing,
    workerCount: services.config.workerCount,
  });

  async function stop(): Promise<void> {
    await workers.stop(); // ngừng nhận việc mới, chờ worker đang chạy xong
    await server.stop(true); // đóng cả connection đang mở
    await closeDb();
    closeRedis(); // sau workers.stop(): lệnh XACK cuối cùng đã đi xong
  }

  return { services, server, stop };
}

export { bootstrap as default };
export type { RunningSystem, Services } from "./container.ts";
