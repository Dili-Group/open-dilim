// /kiemduyet-kb, /duyet-kb, /tuchoi-kb, /kb-pending — cửa KIỂM DUYỆT knowledge base công ty.
//
// Cùng nguyên tắc /duyet-thongbao: quyết định "ghi tri thức cho mọi group đọc" không được nằm
// trong tầm với của LLM — flash command parse bằng code, chạy thẳng handler.
//
// /duyet-kb, /tuchoi-kb, /kb-pending CHỈ chạy trong group kiểm duyệt đã bind (/kiemduyet-kb): đề xuất
// KB đọc được là thấy nội dung chưa duyệt — không để lệnh liệt kê chạy trong nhóm đại lý.

import { formatRunTime, parseRunTime } from "../../kb-digest/time.ts";
import { KB_SHORT_ID_LENGTH } from "../../kb-digest/store.ts";
import { ActorRole, fail, ok, type FlashCommand, type FlashContext, type FlashResult } from "../types.ts";

/** Không có port = chưa wiring tầng kb-digest. Fail-closed. */
const NO_PORT = fail("Hệ kiểm duyệt knowledge base chưa sẵn sàng. Báo bên kỹ thuật.");

const FORBIDDEN = fail("Lệnh này chỉ dành cho nhân viên.");

const WRONG_GROUP = fail(
  "Lệnh này chỉ chạy trong group kiểm duyệt KB. Chưa có group nào bind thì gõ /kiemduyet-kb ở group đó.",
);

const NOT_FOUND = fail(
  "Không có đề xuất nào đang chờ với mã đó (sai mã, hoặc đã duyệt/từ chối rồi). Gõ /kb-pending để xem danh sách.",
);

const AMBIGUOUS = fail("Mã này trùng với hơn một đề xuất đang chờ. Gõ /kb-pending rồi dùng mã đầy đủ hơn.");

const NO_MEMORY = fail("Chưa nối được kho vector (thiếu embedder) — không ghi KB được. Báo bên kỹ thuật.");

/** Giờ chạy mặc định khi /kiemduyet-kb không kèm giờ: cuối giờ làm việc. */
const DEFAULT_RUN_TIME = "18:00";

/** Narrow vai để lấy `userId` type-safe. Registry đã guard, đây là lớp phòng khi gọi trực tiếp. */
function staffUserId(ctx: FlashContext): string | undefined {
  return ctx.identity.role === ActorRole.NhanVien ? ctx.identity.userId : undefined;
}

/** Guard chung cho nhóm lệnh duyệt: đúng vai, có port, gõ đúng group kiểm duyệt. */
async function reviewGate(
  ctx: FlashContext,
): Promise<{ userId: string } | { failed: FlashResult }> {
  const userId = staffUserId(ctx);
  if (userId === undefined) return { failed: FORBIDDEN };
  if (ctx.kb === undefined) return { failed: NO_PORT };
  const config = await ctx.kb.getConfig();
  if (
    config === undefined ||
    config.channel !== ctx.channel ||
    config.conversationId !== ctx.conversationId
  ) {
    return { failed: WRONG_GROUP };
  }
  return { userId };
}

const kiemduyetKb: FlashCommand = {
  name: "kiemduyet-kb",
  description: "Đặt group này làm nơi nhận digest + duyệt KB cuối ngày: /kiemduyet-kb [HH:MM]",
  allowedRoles: [ActorRole.NhanVien],

  async handler(ctx): Promise<FlashResult> {
    const userId = staffUserId(ctx);
    if (userId === undefined) return FORBIDDEN;
    if (ctx.kb === undefined) return NO_PORT;
    // Bind theo group đang đứng — không gõ id nhóm bằng tay (cùng kỷ luật /ketnoi-daily, /lich).
    if (ctx.groupId === undefined) {
      return fail("Lệnh này phải gõ trong group muốn nhận digest, không dùng ở chat riêng.");
    }

    const rawTime = ctx.args[0] ?? DEFAULT_RUN_TIME;
    const minutes = parseRunTime(rawTime);
    if (minutes === undefined) {
      return fail(`Giờ chạy không hợp lệ: "${rawTime}". Cú pháp: /kiemduyet-kb 18:00`);
    }
    const runTime = formatRunTime(minutes);

    await ctx.kb.bindReviewGroup({
      channel: ctx.channel,
      conversationId: ctx.conversationId,
      runTime,
      createdBy: userId,
    });
    return ok(
      `Đã đặt group này làm nơi kiểm duyệt KB. Mỗi ngày sau ${runTime} hệ thống tổng kết các nhóm ` +
        "đại lý có nhân viên trao đổi và gửi digest về đây. Duyệt đề xuất: /duyet-kb <mã>.",
    );
  },
};

const duyetKb: FlashCommand = {
  name: "duyet-kb",
  description: "Duyệt một đề xuất knowledge base: /duyet-kb <mã>",
  allowedRoles: [ActorRole.NhanVien],

  async handler(ctx): Promise<FlashResult> {
    const gate = await reviewGate(ctx);
    if ("failed" in gate) return gate.failed;

    const shortId = ctx.args[0];
    if (shortId === undefined) return fail("Thiếu mã. Cú pháp: /duyet-kb <mã>");

    // ctx.kb chắc chắn có sau reviewGate — TS không thấy được nên kiểm lại cho narrow.
    if (ctx.kb === undefined) return NO_PORT;
    const outcome = await ctx.kb.approve({ shortId, decidedBy: gate.userId });
    switch (outcome.kind) {
      case "approved":
        return outcome.written
          ? ok("Đã duyệt và ghi vào knowledge base.")
          : ok("Đã duyệt. KB đã có fact gần trùng nên không ghi thêm bản mới.");
      case "not_found":
        return NOT_FOUND;
      case "ambiguous":
        return AMBIGUOUS;
      case "no_memory":
        return NO_MEMORY;
      case "rejected":
        // approve() không bao giờ trả nhánh này. Giữ để union luôn exhaustive.
        return fail("Trạng thái không mong đợi khi duyệt.");
    }
  },
};

const tuchoiKb: FlashCommand = {
  name: "tuchoi-kb",
  description: "Từ chối một đề xuất knowledge base: /tuchoi-kb <mã>",
  allowedRoles: [ActorRole.NhanVien],

  async handler(ctx): Promise<FlashResult> {
    const gate = await reviewGate(ctx);
    if ("failed" in gate) return gate.failed;

    const shortId = ctx.args[0];
    if (shortId === undefined) return fail("Thiếu mã. Cú pháp: /tuchoi-kb <mã>");

    if (ctx.kb === undefined) return NO_PORT;
    const outcome = await ctx.kb.reject({ shortId, decidedBy: gate.userId });
    switch (outcome.kind) {
      case "rejected":
        return ok("Đã từ chối. Đề xuất này không vào knowledge base.");
      case "not_found":
        return NOT_FOUND;
      case "ambiguous":
        return AMBIGUOUS;
      case "approved":
      case "no_memory":
        return fail("Trạng thái không mong đợi khi từ chối.");
    }
  },
};

const kbPending: FlashCommand = {
  name: "kb-pending",
  description: "Xem các đề xuất knowledge base đang chờ duyệt: /kb-pending",
  allowedRoles: [ActorRole.NhanVien],

  async handler(ctx): Promise<FlashResult> {
    const gate = await reviewGate(ctx);
    if ("failed" in gate) return gate.failed;
    if (ctx.kb === undefined) return NO_PORT;

    const items = await ctx.kb.listPending();
    if (items.length === 0) return ok("Không có đề xuất KB nào đang chờ duyệt.");

    const lines: string[] = [`Có ${items.length} đề xuất KB đang chờ:`];
    for (const item of items) {
      lines.push("", `[${item.id.slice(0, KB_SHORT_ID_LENGTH)}] (${item.day}) ${item.factText}`);
    }
    lines.push("", "Duyệt: /duyet-kb <mã> · Từ chối: /tuchoi-kb <mã>");
    return ok(lines.join("\n"));
  },
};

export { kiemduyetKb, duyetKb, tuchoiKb, kbPending };
