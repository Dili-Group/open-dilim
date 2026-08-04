// container.ts — "DI đơn giản": bó service đã dựng thành 1 struct type-safe (không any, không
// map<string,unknown> mất kiểu). Đây là service map mà worker/gateway nhận từ composition root.
//
// Thêm service (llm, broker thật, worker pool...) → thêm field vào Services + dựng ở index.ts.

import { type Server } from "bun";
import type { Config } from "../config.ts";
import type { IngestDeps } from "../message-ingest/index.ts";
import type { SkillRegistry } from "../skills/index.ts";
import type { FlashRegistry } from "../flash-command/index.ts";
import type { LLMProvider } from "../llm/index.ts";
import type { AgentRegistry } from "../agents/index.ts";
import type { Broadcaster } from "../broadcast/index.ts";
import type { IdentityResolver } from "../auth/index.ts";
import type { BrokerConsumer, HistoryReader } from "../worker/index.ts";

/** Mọi service dựng lúc boot, share cho các tầng downstream (worker/gateway). */
export interface Services {
  readonly config: Config;
  /** Port ingress (broker/history/dedupe). In-mem lúc dev, Redis lúc prod. */
  readonly ingestDeps: IngestDeps;
  /** Skill nạp từ defs/, dùng cho selector/worker. */
  readonly skills: SkillRegistry;
  /** Flash-command registry (stateless, share toàn app). */
  readonly flash: FlashRegistry;
  /** LLM provider (chọn theo config). */
  readonly llm: LLMProvider;
  /** Root agent registry (worker resolve+run). */
  readonly agents: AgentRegistry;
  /** Egress (dev: console). */
  readonly broadcaster: Broadcaster;
  /** Resolve senderId → vai (auth). */
  readonly identity: IdentityResolver;
  /** Đầu consume của broker — CÙNG instance với ingestDeps.broker. */
  readonly broker: BrokerConsumer;
  /** Đọc history — CÙNG instance với ingestDeps.history. */
  readonly historyReader: HistoryReader;
}

/** Hệ thống ĐANG CHẠY: service + HTTP server + hook shutdown sạch. */
export interface RunningSystem {
  readonly services: Services;
  readonly server: Server<undefined>;
  /** Dừng gateway + đóng pool DB. Idempotent-safe do caller gọi 1 lần khi nhận signal. */
  stop(): Promise<void>;
}
