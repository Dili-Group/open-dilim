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

    await ctx.repo.bindUser({
      channel: ctx.channel,
      senderId: ctx.identity.senderId,
      userId: resolved.userId,
    });

    return ok(`Đã kết nối tài khoản ${resolved.userId}.`);
  },
};

export default ketnoiHethong;
