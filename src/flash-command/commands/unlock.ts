// /unlock — nhân viên bật lại agent trong nhóm đã /block. Đối xứng /block: xoá row group_block.
//
// Chạy được NGAY TRONG nhóm đang bị chặn: worker dispatch flash TRƯỚC khi kiểm chặn.

import { ActorRole, fail, ok, type FlashCommand } from "../types.ts";

const unlock: FlashCommand = {
  name: "unlock",
  description: "Bật lại agent trong nhóm này: /unlock",
  allowedRoles: [ActorRole.NhanVien],

  async handler(ctx) {
    if (ctx.groupId === undefined) {
      return fail("Lệnh này chỉ dùng trong nhóm.");
    }

    await ctx.repo.unblockGroup({ channel: ctx.channel, groupId: ctx.groupId });

    return ok("Đã bật lại agent trong nhóm này.");
  },
};

export default unlock;
