// /duyet-thongbao, /tuchoi-thongbao, /thongbao-cho — cửa DUYỆT phát tin toàn hệ đại lý.
//
// VÌ SAO LÀ FLASH COMMAND CHỨ KHÔNG PHẢI TOOL: quyết định "cho phát tin tới mọi đại lý" không
// được nằm trong tầm với của LLM. Flash command là text bắt đầu bằng `/`, parse bằng code, chạy
// thẳng handler — model không sinh ra nó, không đọc nó, không lái nó (nguyên tắc 6/10/11).
//
// Quyền KHÔNG gate ở đây bằng role: `allowedRoles` chỉ chặn lớp ngoài (phải là nhân viên). Người
// duyệt đích danh verify bên trong service theo `user_id` hệ vận hành — một chỗ duy nhất, không
// rải luật ra ba file lệnh.

import { ActorRole, fail, ok, type FlashCommand, type FlashContext, type FlashResult } from "../types.ts";

/** Không có port = chưa wiring tầng announcements. Fail-closed: không giả vờ duyệt được. */
const NO_PORT = fail("Hệ phát thông báo chưa sẵn sàng. Báo bên kỹ thuật.");

const FORBIDDEN = fail(
  "Chỉ người được chỉ định mới duyệt được thông báo phát cho đại lý. Lệnh này không dành cho bạn.",
);

const NOT_FOUND = fail(
  "Không có đợt thông báo nào đang chờ duyệt với mã đó (sai mã, hoặc đã duyệt/từ chối rồi). " +
    "Gõ /thongbao-cho để xem danh sách đang chờ.",
);

/** Narrow vai để lấy `userId` type-safe. Registry đã guard, đây là lớp phòng khi gọi trực tiếp. */
function staffUserId(ctx: FlashContext): string | undefined {
  return ctx.identity.role === ActorRole.NhanVien ? ctx.identity.userId : undefined;
}

const duyetThongbao: FlashCommand = {
  name: "duyet-thongbao",
  description: "Duyệt cho phát một thông báo tới toàn bộ nhóm đại lý: /duyet-thongbao <mã đợt>",
  allowedRoles: [ActorRole.NhanVien],

  async handler(ctx): Promise<FlashResult> {
    const userId = staffUserId(ctx);
    if (userId === undefined) return FORBIDDEN;
    if (ctx.announce === undefined) return NO_PORT;

    const announcementId = ctx.args[0];
    if (announcementId === undefined) {
      return fail("Thiếu mã đợt. Cú pháp: /duyet-thongbao <mã đợt>");
    }

    const outcome = await ctx.announce.approve({ announcementId, userId, nowMs: Date.now() });
    switch (outcome.kind) {
      case "approved":
        // 0 nhóm = đợt được duyệt nhưng mọi nhóm đang bị /block. Nói rõ, đừng để người duyệt
        // tưởng tin đã đi.
        return outcome.roomCount === 0
          ? ok("Đã duyệt, nhưng KHÔNG nhóm nào nhận được: mọi nhóm đại lý đang bị chặn (/block).")
          : ok(`Đã duyệt. Hệ thống đang gửi tới ${outcome.roomCount} nhóm đại lý.`);
      case "forbidden":
        return FORBIDDEN;
      case "not_found":
        return NOT_FOUND;
      case "rejected":
        // Không đến được: approve() không bao giờ trả nhánh này. Giữ để union luôn exhaustive.
        return fail("Trạng thái không mong đợi khi duyệt.");
    }
  },
};

const tuchoiThongbao: FlashCommand = {
  name: "tuchoi-thongbao",
  description: "Từ chối một thông báo chờ duyệt: /tuchoi-thongbao <mã đợt> <lý do>",
  allowedRoles: [ActorRole.NhanVien],

  async handler(ctx): Promise<FlashResult> {
    const userId = staffUserId(ctx);
    if (userId === undefined) return FORBIDDEN;
    if (ctx.announce === undefined) return NO_PORT;

    const announcementId = ctx.args[0];
    if (announcementId === undefined) {
      return fail("Thiếu mã đợt. Cú pháp: /tuchoi-thongbao <mã đợt> <lý do>");
    }
    // Lý do BẮT BUỘC: nó được gửi thẳng về phòng kho, và "không duyệt" mà không nói vì sao thì
    // thủ kho soạn lại y hệt rồi lại bị từ chối.
    const reason = ctx.args.slice(1).join(" ").trim();
    if (reason === "") {
      return fail("Thiếu lý do từ chối. Cú pháp: /tuchoi-thongbao <mã đợt> <lý do>");
    }

    const outcome = await ctx.announce.reject({ announcementId, userId, reason });
    switch (outcome.kind) {
      case "rejected":
        return ok("Đã từ chối. Không nhóm đại lý nào nhận tin này; bên kho đã được báo lý do.");
      case "forbidden":
        return FORBIDDEN;
      case "not_found":
        return NOT_FOUND;
      case "approved":
        return fail("Trạng thái không mong đợi khi từ chối.");
    }
  },
};

const thongbaoCho: FlashCommand = {
  name: "thongbao-cho",
  description: "Xem các thông báo đang chờ bạn duyệt: /thongbao-cho",
  allowedRoles: [ActorRole.NhanVien],

  async handler(ctx): Promise<FlashResult> {
    const userId = staffUserId(ctx);
    if (userId === undefined) return FORBIDDEN;
    if (ctx.announce === undefined) return NO_PORT;

    const items = await ctx.announce.awaiting(userId);
    if (items.length === 0) return ok("Không có thông báo nào đang chờ duyệt.");

    const lines: string[] = [`Có ${items.length} thông báo đang chờ duyệt:`];
    for (const item of items) {
      lines.push(
        "",
        `Mã ${item.announcementId} — ${item.roomCount} nhóm — ${item.createdAt.toLocaleString("vi-VN")}`,
        "---",
        item.text,
        "---",
        `Duyệt: /duyet-thongbao ${item.announcementId}`,
      );
    }
    return ok(lines.join("\n"));
  },
};

export { duyetThongbao, tuchoiThongbao, thongbaoCho };
