// dedicated-rooms.ts — PHÒNG CHUYÊN DỤNG: một nhóm cụ thể trên một kênh đã có, được phục vụ bởi
// agent khác với agent mặc định của kênh đó.
//
// Vì sao cần bậc này: router và phễu proactive tra agent theo CHANNEL. Một nhóm nội bộ nằm trên
// chính tài khoản Zalo đại lý sẽ rơi vào agent đại lý — sai persona, và agent đó cầm bộ tool gắn
// theo đại lý chủ phòng, thứ nhóm nội bộ không có.
//
// Hai thứ tách nhau rõ ràng:
//   - POLICY (agent nào phục vụ, tin nào tính là một lượt) = hằng trong file này, review được,
//     test được.
//   - ID NHÓM = dữ kiện hạ tầng của một lần triển khai (tạo lại nhóm là đổi id) → env, giống
//     `agentUid`/`webhookSecret`. Thiếu env = KHÔNG có phòng chuyên dụng nào (fail-closed).
//
// CHƯA phòng nào được khai: `message-ingest/index.ts#dedicatedRooms()` trả rỗng nên mọi nhóm vẫn
// tra theo kênh y như trước. Seam dựng sẵn ở đây để agent đầu tiên cắm vào chỉ là thêm DỮ LIỆU,
// không phải sửa lại router/ingest/phễu.
//
// File LÁ: không import config.ts, không I/O. Bootstrap ghép id từ env vào policy rồi chuyền
// xuống router / ingest / phễu proactive — ba nơi PHẢI đọc CÙNG một danh sách, lệch nhau là tin
// vào tới worker rồi bị agent khác trả lời.

import type { AgentType } from "./types.ts";

export interface DedicatedRoom {
  readonly channel: string;
  readonly groupId: string;
  readonly agentType: AgentType;
  /**
   * Tin trong phòng này khớp MỘT trong các mẫu → tính là một lượt, dù không @agent (tin theo mẫu
   * sổ thường không mention ai). Tin khác vẫn nuốt vào history làm ngữ cảnh như cũ.
   */
  readonly triggers: readonly RegExp[];
}

/** Phòng chuyên dụng khớp (kênh, nhóm). `groupId` undefined = chat 1-1 → không bao giờ khớp. */
export function dedicatedRoomOf(
  rooms: readonly DedicatedRoom[],
  channel: string,
  groupId: string | undefined,
): DedicatedRoom | undefined {
  if (groupId === undefined) return undefined;
  const key = channel.toLowerCase();
  return rooms.find((room) => room.channel === key && room.groupId === groupId);
}

/**
 * Tin này có phải "một lượt" trong phòng chuyên dụng hay không — CỔNG MẪU, 0 token.
 *
 * Đây là đường vào DUY NHẤT ngoài `@agent`/`/lệnh` (xem message-ingest/ingestor.ts): nới rộng nó
 * là agent nói leo vào mọi câu tán gẫu của nhóm đông người; siết quá là mất dòng sổ mà mất im lặng.
 */
export function matchesDedicatedTrigger(
  rooms: readonly DedicatedRoom[],
  channel: string,
  groupId: string | undefined,
  text: string,
): boolean {
  const room = dedicatedRoomOf(rooms, channel, groupId);
  if (room === undefined) return false;
  return room.triggers.some((pattern) => pattern.test(text));
}
