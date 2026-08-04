// /huy-ketnoi @mention — nhân viên gỡ vai đại lý (kế toán nghỉ / đổi người).
//
// Đối xứng /ketnoi-daily: set group_member.revoked_at, KHÔNG xoá row (giữ vết audit). Chỉ nhân
// viên gỡ. Không đụng user_binding — gỡ nhân viên là quy trình khác (đổi token / thu hồi).

import { ActorRole, ok, type FlashCommand } from "../types.ts";
import { resolveDealerScope } from "./guards.ts";

const huyKetnoi: FlashCommand = {
  name: "huy-ketnoi",
  description: "Gỡ vai đại lý trong nhóm: /huy-ketnoi @người",
  allowedRoles: [ActorRole.NhanVien],

  async handler(ctx) {
    const scoped = resolveDealerScope(ctx);
    if ("error" in scoped) return scoped.error;
    const { groupId, targetUid } = scoped.scope;

    await ctx.repo.revokeDealer({
      channel: ctx.channel,
      groupId,
      senderId: targetUid,
    });

    return ok("Đã gỡ vai đại lý.");
  },
};

export default huyKetnoi;
