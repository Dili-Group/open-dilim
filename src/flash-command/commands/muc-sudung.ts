// /muc-sudung — phòng này hôm nay đã dùng bao nhiêu phần trăm hạn mức chi phí LLM.
//
// Đọc THẲNG sổ chi phí (usage/), không ước lượng: cùng một con số mà gate dùng để chặn lượt, nên
// người gõ thấy đúng thứ sắp chặn mình.
//
// Mốc ngày theo giờ VN (usage/budget.ts) — reset 00:00, không phải 07:00 như mốc UTC.

import { dailyBudgetVnd } from "../../usage/budget.ts";
import { picoUsdToVnd } from "../../usage/pricing.ts";
import { ActorRole, fail, ok, type FlashCommand, type FlashContext } from "../types.ts";

/** Thanh 10 ô — nhìn phát biết ngay đang ở đâu, không phải đọc số. */
const BAR_SLOTS = 10;

function bar(percent: number): string {
  const filled = Math.min(BAR_SLOTS, Math.round((percent / 100) * BAR_SLOTS));
  return "█".repeat(filled) + "░".repeat(BAR_SLOTS - filled);
}

/**
 * 3700 → "3.700" (dấu chấm phân nhóm, kiểu VN).
 *
 * Tự chèn dấu thay vì `toLocaleString("vi-VN")`: máy CI thiếu locale data thì Intl lặng lẽ rơi
 * về locale khác và trả "3,700" — không lỗi, chỉ sai dấu. Đây là chữ hiển thị cho người dùng
 * Việt nên phải cố định, không phụ thuộc môi trường chạy.
 */
function formatVnd(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const mucSudung: FlashCommand = {
  name: "muc-sudung",
  description: "Xem mức dùng hạn mức hôm nay của phòng: /muc-sudung",
  // Mọi vai gõ được: đây là số liệu của CHÍNH phòng đang gõ, và người bị chặn cần biết vì sao.
  // Chỉ trả PHẦN TRĂM: đại lý cần biết còn dùng được bao nhiêu, không cần biết chi phí vận hành.

  async handler(ctx: FlashContext) {
    if (ctx.usage === undefined) {
      return fail("Chưa bật đo chi phí nên không có số để báo.");
    }

    const limitVnd = dailyBudgetVnd(ctx.agentType);
    const spentPico = await ctx.usage.port.spentTodayPicoUsd(ctx.conversationId);
    const spentVnd = picoUsdToVnd(spentPico, ctx.usage.usdVndRate);

    if (limitVnd === null) {
      // Phòng nội bộ không đặt trần → không có mẫu số để chia phần trăm. Nói thẳng thay vì bịa 0%.
      const detail = ctx.identity.role === ActorRole.NhanVien ? ` (đã dùng ${formatVnd(spentVnd)}đ)` : "";
      return ok(`Phòng này không giới hạn hạn mức${detail}.`);
    }

    // Không kẹp trần 100%: vượt thì phải THẤY là vượt bao nhiêu, đó là lúc cần biết nhất.
    const percent = Math.round((spentVnd / limitVnd) * 100);
    const lines = [`Hạn mức hôm nay: ${bar(percent)} ${percent}%`];

    if (percent >= 100) {
      lines.push(
        ctx.usage.enforce
          ? "Đã hết hạn mức — agent tạm dừng trả lời tới 00:00. Vui lòng liên hệ người quản trị để nâng cấp"
          : "Đã vượt hạn mức (đang ở chế độ chỉ đo, chưa chặn).",
      );
    }

    return ok(lines.join("\n"));
  },
};

export default mucSudung;
