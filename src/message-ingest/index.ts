// index.ts — điểm lắp message-ingest. Dựng ChannelFactory từ CONFIG + start HTTP gateway.
//
// Thêm kênh: viết adapter trong adapters/, register ở buildChannelFactory. deps (broker/
// history/dedupe) do nơi khởi động (bootstrap) cấp — ingest không tự mở kết nối.

import { CONFIG } from "../config.ts";
import type { IngestDeps } from "./deps.ts";
import { ChannelFactory } from "./factory.ts";
import { createGateway } from "./gateway.ts";
import { ZaloIngestor } from "./adapters/zalo.ts";

/**
 * Register adapter cho từng kênh ĐÃ cấu hình (bỏ kênh thiếu agentUid/secret → webhook 404).
 *
 * Mọi kênh hiện là Zalo nên duyệt phẳng được. Có platform khác (config shape khác) thì tách
 * nhánh theo key — KHÔNG nới `ZaloIngestor` để nuốt mọi config.
 */
export function buildChannelFactory(): ChannelFactory {
  const factory = new ChannelFactory();
  for (const [channel, config] of Object.entries(CONFIG.channels)) {
    if (config !== undefined) factory.register(new ZaloIngestor(channel, config));
  }
  return factory;
}

/** Khởi động HTTP gateway. deps inject từ bootstrap. Trả server để caller stop khi shutdown. */
export function startGateway(deps: IngestDeps, port: number) {
  const factory = buildChannelFactory();
  const gateway = createGateway(factory, deps);
  return Bun.serve({ port, fetch: gateway.handle });
}

export { ChannelFactory } from "./factory.ts";
export { createGateway } from "./gateway.ts";
export { isAddressed } from "./ingestor.ts";
export type { Ingestor, ParsedMessage } from "./ingestor.ts";
export type { Broker, HistoryStore, Dedupe, IngestDeps, ProactivePort } from "./deps.ts";
