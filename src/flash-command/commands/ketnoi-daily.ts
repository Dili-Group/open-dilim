// /ketnoi-daily @mention — nhân viên gán 1 người trong nhóm làm đại lý (kế toán đại lý).
//
// Tầng 2 (đại lý): chỉ nhân viên gán. Người được gán lấy từ mention ENTITY (uid), không parse
// tên. customer_id KHÔNG nhập tay — derive từ group_map lúc runtime. Chặn phong nhầm nhân viên.

import { ActorRole, fail, ok, type FlashCommand } from "../types.ts";
import { resolveDealerScope } from "./guards.ts";

const ketnoiDaily: FlashCommand = {
  name: "ketnoi-daily",
  description: "Gán đại lý trong nhóm: /ketnoi-daily @người",
  allowedRoles: [ActorRole.NhanVien],

  async handler(ctx) {
    const scoped = resolveDealerScope(ctx);
    if ("error" in scoped) return scoped.error;
    const { actorUserId, groupId, targetUid } = scoped.scope;

    // Người được mention đang là nhân viên → không hạ thành đại lý (nhầm vai → lộ/mất quyền).
    const alreadyStaff = await ctx.repo.isBoundUser({ channel: ctx.channel, senderId: targetUid });
    if (alreadyStaff) {
      return fail("Người này là nhân viên, không gán làm đại lý.");
    }

    await ctx.repo.assignDealer({
      channel: ctx.channel,
      groupId,
      senderId: targetUid,
      assignedBy: actorUserId,
    });

    return ok("Đã gán đại lý trong nhóm.");
  },
};

export default ketnoiDaily;
