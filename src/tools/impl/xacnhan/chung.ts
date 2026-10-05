// chung.ts — hàng rào phạm vi, đọc ngày, dịch lỗi ghi của tool sổ xác nhận (`ghi_dang_ky`).
//
// Hai hàng rào:
//   1. Phải đang ở trong NHÓM (ctx.room) — sổ thuộc về nhóm xác nhận, không phải chat riêng.
//   2. Chưa nối cổng lưu trữ → nói thẳng là chưa ghi được, KHÔNG để model tự trấn an sale là xong.

import { AgentApiError } from "../../../operational/agent-api.ts";
import type { ToolResult } from "../../types.ts";
import { isOffDay, vnDay } from "./khung-gio.ts";

export const NO_PORT: ToolResult = {
  content:
    "Chưa ghi được vào sổ xác nhận vì hệ thống chưa nối. Nói thẳng với sale là chưa ghi được, " +
    "nhờ giữ lại tin đăng ký để ghi sau — KHÔNG nói là đã ghi, KHÔNG báo thứ tự nào.",
  isError: true,
};

export const NO_ROOM: ToolResult = {
  content:
    "Sổ xác nhận chỉ dùng trong nhóm đăng ký xác nhận, không dùng ở chat riêng. Không ghi gì cả.",
  isError: true,
};

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ngày sổ của thao tác: model truyền `YYYY-MM-DD` khi sale nói rõ ngày ("khung 11-12h ngày 18/9"),
 * còn lại lấy hôm nay theo GIỜ VN. Định dạng sai → undefined để tool hỏi lại, KHÔNG đoán.
 */
export function readDay(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return vnDay();
  if (typeof raw !== "string") return undefined;
  const day = raw.trim();
  return DAY_PATTERN.test(day) ? day : undefined;
}

export const BAD_DAY: ToolResult = {
  content: "Ngày không đọc được. Ngày phải dạng 2026-09-18. Hỏi lại sale ngày nào rồi gọi lại.",
  isError: true,
};

/** Câu nhắc khi sale xin khung vào Chủ nhật — quy trình §3: CN bác sĩ OFF. */
export function sundayNote(day: string): string {
  return isOffDay(day) ? " Ngày này Chủ nhật, không có khung xác nhận — dòng vẫn ghi nhưng phải hẹn ngày khác." : "";
}

/**
 * Model hay chép nguyên văn kết quả tool ra nhóm, nên câu cấm phải đi kèm ngay trong kết quả,
 * không chỉ nằm ở prompt. Nhóm có bác sĩ cùng đọc: "chờ bác sĩ duyệt" là đẩy việc lên đầu bác sĩ
 * trước mặt cả nhóm — trạng thái là của SỔ ("đang chờ duyệt"), không phải của người.
 */
export const NO_DOCTOR_MENTION =
  "Câu trả lời KHÔNG được nhắc tới bác sĩ — trạng thái chỉ nói 'đang chờ duyệt'.";

/**
 * Lỗi HTTP từ hệ vận hành → LỜI cho model, không throw ra loop (luật chung của tầng tool).
 *
 * Hai nhánh ghi phải khác nhau: 4xx là backend TỪ CHỐI (chưa ghi gì, nói thẳng được), còn
 * 5xx/timeout là KHÔNG BIẾT đã ghi hay chưa — đường ghi không retry (xem AgentApiClient.post),
 * nên tuyệt đối không được khẳng định đã ghi, và cũng không tự ghi lại (ghi hai dòng).
 *
 * KHÔNG in `err.message`: message mang body backend trả, trong đó có tên khách và số điện thoại.
 */
export function writeFailure(err: unknown, action: string): ToolResult {
  const api = asApiError(err);
  console.error(`[xac-nhan] ${action} lỗi: ${api.status} ${api.code} ${api.path}`);
  if (api.status >= 400 && api.status < 500) {
    return {
      content:
        "Hệ thống sổ không nhận dòng này nên CHƯA ghi được. Báo sale đúng một câu là chưa ghi " +
        "được, nhờ giữ lại tin. KHÔNG nói đã ghi, KHÔNG báo số thứ tự.",
      isError: true,
    };
  }
  return {
    content:
      "Hệ thống sổ đang trục trặc nên chưa chắc đã ghi được. Báo sale là chưa xác nhận được, sẽ " +
      "kiểm lại. KHÔNG nói đã ghi xong, KHÔNG gọi lại tool để ghi lần nữa — dễ thành hai dòng.",
    isError: true,
  };
}

/**
 * Lỗi khi TRA trước lúc ghi (đối chiếu mã đại lý, kiểm đơn khách đang dùng): chưa ghi gì nên nói
 * thẳng được, nhưng phải tách khỏi "sale gửi sai" — ở đây sale không có gì để sửa, bảo họ kiểm
 * tra lại là đổ lỗi oan. `what` = việc đang làm, viết như nói với sale ("đối chiếu mã đại lý").
 */
export function lookupFailure(err: unknown, what: string): ToolResult {
  const api = asApiError(err);
  console.error(`[xac-nhan] ${what} lỗi: ${api.status} ${api.code} ${api.path}`);
  return {
    content:
      `Chưa ghi: hệ thống chưa ${what} được lúc này (lỗi hệ thống, KHÔNG phải sale gửi sai). ` +
      "Báo sale đúng một dòng là chưa ghi được, nhờ giữ lại tin. KHÔNG nói sale gửi sai.",
    isError: true,
  };
}

/** Lỗi không phải HTTP (bug, abort) → ném tiếp: loop xử lý, không nuốt thành câu trả lời êm tai. */
function asApiError(err: unknown): AgentApiError {
  if (err instanceof AgentApiError) return err;
  throw err;
}
