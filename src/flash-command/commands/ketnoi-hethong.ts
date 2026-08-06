// /ketnoi-hethong <token> — nhân viên tự bind tài khoản hệ vận hành.
//
// Tầng 1 (nhân viên): guest gõ token 1 lần → đổi ra user_id → lưu user_binding. Sau đó nhận
// diện bằng senderId, không gõ token lại. KHÔNG guard vai: đây là cửa để THÀNH nhân viên.

import { fail, ok, type FlashCommand } from "../types.ts";

const ketnoiHethong: FlashCommand = {
  name: "ketnoi-hethong",
  description: "Kết nối tài khoản hệ vận hành: /ketnoi-hethong <token>",

  async handler(ctx) {
    const token = ctx.args[0];
    if (token === undefined) {
      return fail("Cú pháp: /ketnoi-hethong <token>");
    }

    // Token = untrusted → verify với hệ vận hành, không tin blind.
    const resolved = await ctx.ops.resolveUserByToken(token);
    if (resolved === null) {
      return fail("Token không hợp lệ hoặc đã hết hạn.");
    }

    // Token gõ tay chính là bearer hệ vận hành → lưu lại để ketnoi-daily gọi act-as sau này.
    // roleSlug/fullName verify trả kèm → lưu luôn (agent xưng hô đúng người, biết vai nhân viên).
    await ctx.repo.bindUser({
      channel: ctx.channel,
      senderId: ctx.identity.senderId,
      userId: resolved.userId,
      opToken: token,
      roleSlug: resolved.roleSlug,
      fullName: resolved.fullName,
    });

    return ok(`Đã kết nối tài khoản ${resolved?.fullName} với vai trò ${resolved?.role}.`);
  },
};

export default ketnoiHethong;
