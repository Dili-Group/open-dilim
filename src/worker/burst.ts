// burst.ts — gom tin gửi liên tiếp cùng một phòng thành MỘT lượt agent.
//
// Người ta hay gõ rời: "@agent" → "tồn kho mã X" → "gấp nhé" trong vài giây. Mỗi tin một lượt LLM =
// trả lời rời rạc + tốn token, mà lượt cũ KHÔNG cần chạy: ingest ghi MỌI tin vào history TRƯỚC khi
// publish (message-ingest/gateway.ts), nên lượt của tin CUỐI đọc history là thấy đủ mấy tin trước.
// Không cần nhắc model "vừa bỏ tin trước" — ngữ cảnh vốn đã đủ.
//
// TẠI SAO bỏ lượt chứ không huỷ lượt đang chạy: giữa lượt, agent đã có thể gửi tin cho phòng, ghi
// pending_action/workflow, gọi API vận hành. Abort ở đó để lại side-effect nửa vời không rollback
// được. Ở đây bỏ TRƯỚC khi lượt chạy bước nào — chưa có gì để dọn.
//
// Vạch là EVENT TIME chứ không phải msgId: mọi kiểu hỏng (Redis chớp, vạch tới trễ, ts kênh lệch)
// đều rơi về "không ai bị bỏ" = hành vi cũ, chứ không rơi về "bỏ tin của khách".

import { isSupersedable } from "../message-ingest/ingestor.ts";
import type { Envelope } from "../types/index.ts";
import type { LatestTurnReader } from "./types.ts";

/** Cửa sổ chờ tin kế trước khi vào lượt: đủ để gõ xong câu sau, chưa đủ để phòng thấy chậm. */
export const BURST_WINDOW_MS = 1_200;

/**
 * Chờ hết cửa sổ burst rồi soi vạch. true = phòng đã có tin mới hơn → BỎ lượt này; tin mới sẽ trả
 * lời thay, và history của nó đã gồm cả tin này.
 *
 * Trả false ở mọi trường hợp không chắc (chưa nối cổng vạch, tin không được phép gom, vạch bằng
 * tuổi, đọc vạch lỗi, đang shutdown): thà trả lời hai lần còn hơn im lặng.
 */
export async function isSuperseded(
  turns: LatestTurnReader | undefined,
  envelope: Envelope,
  signal?: AbortSignal,
  windowMs: number = BURST_WINDOW_MS,
): Promise<boolean> {
  if (turns === undefined || !isSupersedable(envelope)) return false;
  await sleep(windowMs, signal);
  // Abort giữa cửa sổ = shutdown/hết deadline: để handleEnvelope hỏng đúng chỗ của nó (→ retry),
  // đừng nhân đây mà ack mất tin.
  if (signal?.aborted === true) return false;
  try {
    const latestTs = await turns.latestTs(envelope.channel, envelope.conversationId);
    // So sánh NGẶT: vạch bằng tuổi tin này (thường là chính nó) thì lượt này phải chạy.
    return latestTs !== undefined && latestTs > envelope.ts;
  } catch (err) {
    console.error("[burst] đọc vạch tin mới nhất lỗi, chạy tiếp lượt:", err);
    return false;
  }
}

/** setTimeout huỷ được: shutdown không phải đứng chờ hết cửa sổ mới thoát. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}
