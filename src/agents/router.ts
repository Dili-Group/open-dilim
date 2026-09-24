// router.ts — chọn ROOT agent theo channel (design §4, tầng thô). Mỗi channel = một cửa vào
// riêng (OA/webhook riêng) nên phục vụ một nhóm người dùng riêng → một agent riêng.
//
// Bảng này là POLICY định tuyến, không phải secret → để hằng ở đây (đọc được, test được), không
// nhét env. Đổi ai phục vụ channel nào = sửa đúng một bảng.
//
// Channel KHÔNG cấp quyền: đến từ path webhook `/webhook/:channel`, chỉ chọn LUỒNG. Quyền vẫn do
// identity (bước AUTH) quyết, và tool nhạy cảm vẫn gate theo identity bên trong agent.

import { dedicatedRoomOf, type DedicatedRoom } from "./dedicated-rooms.ts";
import { AgentType } from "./types.ts";

// Khoá PHẢI khớp key trong CONFIG.channels (config.ts) — kênh có ở đó mà thiếu ở đây thì rơi
// về default agent, đúng nhưng không phải ý bạn.
const CHANNEL_AGENT: Readonly<Record<string, AgentType>> = {
  zalo: AgentType.Dealer,
  "van-hanh": AgentType.Operations,
  "zalo-sep": AgentType.Boss,
  "zalo-canhan": AgentType.Personal,
  "zalo-kho": AgentType.Warehouse,
  "zalo-oa": AgentType.Customer,
  meta: AgentType.SaleFacebook,
};

/**
 * Thứ tự tra: PHÒNG CHUYÊN DỤNG trước, bảng channel sau. Một nhóm cụ thể có thể được phục vụ bởi
 * agent khác với agent mặc định của kênh (nhóm xác nhận đơn nằm trên tài khoản đại lý) — xem
 * dedicated-rooms.ts. `rooms` rỗng (mặc định) = hành vi y như cũ, chỉ tra theo channel.
 *
 * Vẫn giữ đủ ba tính chất của tầng thô: code quyết, deterministic, 0 token. Và vẫn KHÔNG cấp
 * quyền — quyền do identity (bước AUTH) quyết.
 *
 * undefined = channel chưa map → caller (registry.resolve) rơi về default agent. Trả undefined
 * chứ KHÔNG đoán agent gần đúng: đoán sai là trả lời sai persona cho sai nhóm người.
 */
export function resolveAgentType(
  channel: string,
  groupId?: string,
  rooms: readonly DedicatedRoom[] = [],
): AgentType | undefined {
  const room = dedicatedRoomOf(rooms, channel, groupId);
  if (room !== undefined) return room.agentType;
  return CHANNEL_AGENT[channel.toLowerCase()];
}
