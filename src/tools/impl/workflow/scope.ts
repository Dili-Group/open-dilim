// scope.ts — thứ dùng chung của ba tool việc-treo: nhóm nào đang gõ, và cách in danh mục nghiệp
// vụ cho model đọc.
//
// Đặt riêng vì "việc treo neo vào NHÓM" là hàng rào an toàn: nhóm B không được đóng việc của
// nhóm A. Sửa một chỗ, cả ba tool cùng theo.

import type { PendingRequest, RoomRef, WorkflowDef } from "../../../workflows/types.ts";
import type { ToolContext, ToolResult } from "../../types.ts";

/** Chưa nối cổng workflow (bootstrap thiếu) — lỗi cấu hình, nhưng vẫn trả structured cho model. */
export const NO_PORT: ToolResult = {
  content: "Hệ thống việc-chờ-trả-lời chưa sẵn sàng — báo lại là em kiểm tra sau.",
  isError: true,
};

/** Chat 1-1: không có nhóm để neo việc. */
export const NO_ROOM: ToolResult = {
  content:
    "Việc chờ trả lời chỉ mở/đóng được trong nhóm làm việc, không mở được ở cuộc trò chuyện riêng.",
  isError: true,
};

/** Model gõ sai slug nghiệp vụ. Kèm danh mục để nó tự sửa ngay lượt sau. */
export function unknownWorkflow(defs: readonly WorkflowDef[]): ToolResult {
  return {
    content: `Không có loại việc nào tên đó. Loại đang dùng được: ${defs
      .map((def) => def.name)
      .join(", ")}.`,
    isError: true,
  };
}

/** Nhóm của lượt hiện tại. undefined = chat 1-1 (worker không cấp room). */
export function roomOf(ctx: ToolContext): RoomRef | undefined {
  return ctx.room;
}

/** Danh mục nghiệp vụ nhét vào description tool — model đọc để chọn đúng `ma_viec`. */
export function renderCatalog(defs: readonly WorkflowDef[]): string {
  if (defs.length === 0) return "(chưa khai loại việc nào)";
  return defs
    .map((def) => `"${def.name}": hỏi ${def.targetLabel} ${def.answerLabel} theo ${def.subjectLabel}`)
    .join("; ");
}

/** Một dòng liệt kê việc treo. Ngắn — model chỉ cần khoá + đang chờ gì + hạn. */
export function renderPendingLine(request: PendingRequest, def: WorkflowDef | undefined): string {
  const label = def === undefined ? request.workflow : `${def.subjectLabel} ${request.subject ?? "?"}`;
  const waiting = def === undefined ? "trả lời" : `${def.targetLabel} cho ${def.answerLabel}`;
  return `- ${label}: đang chờ ${waiting}, đã hỏi ${request.askCount} lần, hạn ${formatDate(request.expiresAt)}`;
}

const TIME_ZONE = "Asia/Ho_Chi_Minh";
// Cùng định dạng với tool đơn hàng ("HH:mm dd/mm/YYYY") để model không phải đối chiếu hai kiểu ngày.
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDate(value: Date): string {
  const parts = dateTimeFormat.formatToParts(value);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("day")}/${get("month")}/${get("year")}`;
}
