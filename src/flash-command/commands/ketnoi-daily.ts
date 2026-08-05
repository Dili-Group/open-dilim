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

    // Cần bearer của nhân viên gõ lệnh để gọi hệ vận hành act-as (lấy customer_id đại lý).
    const opToken = await ctx.repo.getOpToken({
      channel: ctx.channel,
      senderId: ctx.identity.senderId,
    });
    if (opToken === null) {
      return fail("Bạn chưa kết nối tài khoản hệ vận hành. Gõ /ketnoi-hethong <token> trước.");
    }

    // customer_id KHÔNG nhập tay → hệ vận hành trả về, gọi act-as bằng token nhân viên.
    const dealer = await ctx.ops.fetchDealerInfo({
      token: opToken,
      channel: ctx.channel,
      senderId: targetUid,
    });
    if (dealer === null) {
      return fail("Hệ vận hành không nhận diện người này là đại lý.");
    }

    // Ghi group_map TRƯỚC assignDealer: resolve vai đại lý cần cả group_member lẫn group_map.
    await ctx.repo.upsertGroupMap({
      channel: ctx.channel,
      groupId,
      customerId: dealer.customerId,
    });

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
