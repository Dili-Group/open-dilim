// /block — nhân viên tắt agent trong nhóm (khách đang bực, đang xử lý tay, nhóm test...).
//
// Chặn KHÔNG đụng quyền đại lý lẫn trí nhớ nhóm: chỉ ghi group_block, worker thấy row thì bỏ qua
// tin thường. Flash command vẫn chạy trong nhóm bị chặn — nếu không thì /unlock cũng chết theo.

import { ActorRole, fail, ok, type FlashCommand } from "../types.ts";

const block: FlashCommand = {
  name: "block",
  description: "Tắt agent trong nhóm này: /block",
  allowedRoles: [ActorRole.NhanVien],

  async handler(ctx) {
    // Registry đã guard vai — narrow lại để lấy userId type-safe (và phòng gọi trực tiếp ở test).
    if (ctx.identity.role !== ActorRole.NhanVien) {
      return fail("Chỉ nhân viên được chặn nhóm.");
    }
    if (ctx.groupId === undefined) {
      return fail("Lệnh này chỉ dùng trong nhóm.");
    }

    await ctx.repo.blockGroup({
      channel: ctx.channel,
      groupId: ctx.groupId,
      blockedBy: ctx.identity.userId,
    });

    return ok("Đã tắt agent trong nhóm này. Gõ /unlock để bật lại.");
  },
};

export default block;
