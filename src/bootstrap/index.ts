// index.ts — COMPOSITION ROOT. Nơi DUY NHẤT wiring toàn hệ thống (ARCHITECTURE.md §bootstrap).
// Đổi broker/adapter/provider chỉ sửa ở đây; tầng khác nhận qua port, không tự dựng kết nối.
//
// bootstrap() = dựng service (DI). start() = bootstrap + khởi động gateway + worker pool.
// src/index.ts (entrypoint) chỉ gọi start() rồi wire signal shutdown.

import { startGateway, type IngestDeps } from "../message-ingest/index.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import { flashRegistry } from "../flash-command/index.ts";
import { closeDb } from "../db/client.ts";
import { buildLlmProvider } from "../llm/index.ts";
import { buildAgentRegistry } from "../agents/index.ts";
import { ConsoleBroadcaster } from "../broadcast/index.ts";
import { SqlIdentityResolver } from "../auth/index.ts";
import { startWorkers } from "../worker/index.ts";
import { checkInfra, loadConfig } from "./env.ts";
import { MemoryBroker, MemoryDedupe, MemoryHistoryStore } from "./deps-memory.ts";
import { type RunningSystem, type Services } from "./container.ts";

/**
 * Dựng mọi service (DI). Fail-fast: env thiếu (loadConfig) / DB chưa lên (checkInfra) /
 * skill def hỏng (buildSkillRegistry) đều throw TRƯỚC khi mở port.
 */
export async function bootstrap(): Promise<Services> {
  const config = loadConfig();
  await checkInfra();
  const skills = await buildSkillRegistry();

  // Port ingress in-mem — 1 instance, 2 góc nhìn: publish (ingest) + take/recent (worker).
  // Thay bằng impl Redis khi broker/ xong; phần còn lại không đụng vì cùng port.
  const broker = new MemoryBroker();
  const history = new MemoryHistoryStore();
  const dedupe = new MemoryDedupe();
  const ingestDeps: IngestDeps = { broker, history, dedupe };

  const llm = buildLlmProvider(config);
  const agents = buildAgentRegistry(llm, config);
  const broadcaster = new ConsoleBroadcaster();
  const identity = new SqlIdentityResolver();

  return {
    config,
    ingestDeps,
    skills,
    flash: flashRegistry,
    llm,
    agents,
    broadcaster,
    identity,
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
    agents: services.agents,
    broadcaster: services.broadcaster,
    workerCount: services.config.workerCount,
  });

  async function stop(): Promise<void> {
    await workers.stop(); // ngừng nhận việc mới, chờ worker đang chạy xong
    await server.stop(true); // đóng cả connection đang mở
    await closeDb();
  }

  return { services, server, stop };
}

export { bootstrap as default };
export type { RunningSystem, Services } from "./container.ts";
