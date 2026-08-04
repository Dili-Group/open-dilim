// index.ts — điểm lắp message-ingest. Dựng ChannelFactory từ CONFIG + start HTTP gateway.
//
// Thêm kênh: viết adapter trong adapters/, register ở buildChannelFactory. deps (broker/
// history/dedupe) do nơi khởi động (bootstrap) cấp — ingest không tự mở kết nối.

import { CONFIG } from "../config.ts";
import type { IngestDeps } from "./deps.ts";
import { ChannelFactory } from "./factory.ts";
import { createGateway } from "./gateway.ts";
import { ZaloIngestor } from "./adapters/zalo.ts";

/** Register adapter cho từng kênh ĐÃ cấu hình (bỏ kênh thiếu agentUid/secret). */
export function buildChannelFactory(): ChannelFactory {
  const factory = new ChannelFactory();
  const zalo = CONFIG.channels.zalo;
  if (zalo !== undefined) factory.register(new ZaloIngestor(zalo));
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
export type { Broker, HistoryStore, Dedupe, IngestDeps } from "./deps.ts";
