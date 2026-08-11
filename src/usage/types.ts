// types.ts — hợp đồng tầng đo chi phí LLM. Worker chỉ biết hai câu hỏi: "phòng này hôm nay
// tiêu bao nhiêu rồi?" và "ghi lượt vừa rồi vào sổ".

import type { LlmUsage } from "../llm/types.ts";

/** Một lượt agent đã chạy xong — đơn vị ghi sổ. */
export interface UsageEntry {
  readonly conversationId: string;
  readonly agentType: string;
  /** Khoá chống ghi trùng khi broker giao lại lượt. Lấy msgId của envelope thật sự chạy LLM. */
  readonly msgId: string;
  readonly usage: LlmUsage;
}

export interface UsagePort {
  /**
   * Tổng chi phí (pico-USD) phòng đã tiêu trong NGÀY VN hiện tại. Đọc bộ đếm nóng; bộ đếm mất
   * thì tự dựng lại từ sổ cái — mất Redis không được reset hạn mức của mọi phòng về 0.
   */
  spentTodayPicoUsd(conversationId: string): Promise<number>;
  /** Ghi sổ cái rồi cộng bộ đếm. Idempotent theo `msgId`. */
  record(entry: UsageEntry): Promise<void>;
}

/**
 * Bó đo + chặn chi phí, dựng ở bootstrap rồi chuyền xuống worker và flash command. Gói ba thứ
 * lại vì chúng luôn đi cùng nhau, và vì tầng dưới KHÔNG được import CONFIG (import config là
 * chạy validate env, làm test phải dựng đủ biến môi trường).
 */
export interface UsageTracking {
  readonly port: UsagePort;
  /** Tỉ giá quy trần VND (usage/budget.ts) sang USD của bảng giá. */
  readonly usdVndRate: number;
  /** false = chỉ đo và ghi sổ, không chặn lượt (shadow mode). */
  readonly enforce: boolean;
}
