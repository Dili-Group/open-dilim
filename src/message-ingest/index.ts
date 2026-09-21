// index.ts — điểm lắp message-ingest. Dựng ChannelFactory từ CONFIG + start HTTP gateway.
//
// Thêm kênh: viết adapter trong adapters/, register ở buildChannelFactory. deps (broker/
// history/dedupe) do nơi khởi động (bootstrap) cấp — ingest không tự mở kết nối.

import type { DedicatedRoom } from "../agents/dedicated-rooms.ts";
import { CONFIG } from "../config.ts";
import type { IngestDeps } from "./deps.ts";
import { ChannelFactory } from "./factory.ts";
import { createGateway } from "./gateway.ts";
import { ZaloIngestor } from "./adapters/zalo.ts";
import { ZaloOaIngestor } from "./adapters/zalo-oa.ts";

/**
 * Register adapter cho từng kênh ĐÃ cấu hình (bỏ kênh thiếu agentUid/secret → webhook 404).
 *
 * Mỗi platform một adapter riêng, chọn theo `config.platform` — KHÔNG nới `ZaloIngestor` để nuốt
 * mọi config. Thêm platform mới mà quên nhánh ở đây thì `switch` không exhaustive → typecheck đỏ.
 */
export function buildChannelFactory(): ChannelFactory {
  const factory = new ChannelFactory();
  const rooms = dedicatedRooms();
  for (const [channel, config] of Object.entries(CONFIG.channels)) {
    if (config === undefined) continue;
    switch (config.platform) {
      case "zalo":
        factory.register(new ZaloIngestor(channel, config, rooms));
        break;
      case "zalo-oa":
        factory.register(new ZaloOaIngestor(channel, config));
        break;
    }
  }
  return factory;
}

/**
 * Phòng chuyên dụng đang gác. Dùng chung MỘT hàm cho ingest và bootstrap (router + phễu proactive)
 * — hai đầu đọc lệch danh sách là tin lọt vào rồi bị agent khác trả lời.
 *
 * Rỗng: chưa agent nào khai phòng riêng, nên mọi nhóm vẫn tra theo kênh như trước. Agent đầu tiên
 * cần phòng riêng chỉ việc ghép id từ env vào đây.
 */
export function dedicatedRooms(): readonly DedicatedRoom[] {
  return [];
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
