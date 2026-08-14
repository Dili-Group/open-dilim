// answer.ts — tool CHUNG: ghi câu trả lời cho một việc đang treo, rồi hệ thống tự báo về nhóm
// đã hỏi (§6).
//
// KHỚP VIỆC BẰNG KHOÁ + ĐÚNG NHÓM, không bằng đọc hiểu câu chữ. Nhóm B không đóng được việc của
// nhóm A kể cả khi model bị dụ truyền khoá của A — engine kiểm nhóm trước khi ghi.
//
// Khoá sai → tool trả về DANH SÁCH khoá đang chờ CỦA CHÍNH NHÓM NÀY, để model tự sửa ở lượt sau
// thay vì bịa ra một mã gần đúng.

import { readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import { NO_PORT, NO_ROOM, renderCatalog, roomOf, unknownWorkflow } from "./scope.ts";

export function buildWorkflowAnswerTool(ctx: ToolContext): Tool {
  const defs = ctx.workflow?.catalog() ?? [];
  return {
    name: "tra_loi_viec",
    description:
      "Ghi câu trả lời cho một việc mà hệ thống đang chờ nhóm NÀY trả lời. Gọi ngay khi người " +
      "trong nhóm cung cấp đúng thông tin được hỏi. Hệ thống tự báo kết quả về nơi đã hỏi. " +
      `Loại việc — ${renderCatalog(defs)}.`,
    inputSchema: {
      type: "object",
      properties: {
        ma_viec: {
          type: "string",
          description: `Loại việc. Chỉ nhận đúng một trong: ${defs.map((def) => def.name).join(", ")}.`,
        },
        khoa: {
          type: "string",
          description:
            "Khoá của việc, chép NGUYÊN VĂN từ câu hỏi hệ thống đã nêu trong nhóm (ví dụ mã đơn " +
            "hoàn). Không tự sửa, không rút gọn.",
        },
        tra_loi: {
          type: "string",
          description:
            "Thông tin người trong nhóm vừa cung cấp (ví dụ mã đơn gốc). Chép đúng như họ đọc.",
        },
      },
      required: ["ma_viec", "khoa", "tra_loi"],
    },
    run: (input: unknown): Promise<ToolResult> => runAnswer(ctx, input),
  };
}

async function runAnswer(ctx: ToolContext, input: unknown): Promise<ToolResult> {
  const port = ctx.workflow;
  if (port === undefined) return NO_PORT;

  const room = roomOf(ctx);
  if (room === undefined) return NO_ROOM;

  const workflow = readStringField(input, "ma_viec");
  const subject = readStringField(input, "khoa");
  const answer = readStringField(input, "tra_loi");
  if (workflow === undefined || subject === undefined || answer === undefined) {
    return { content: "Thiếu `ma_viec`, `khoa` hoặc `tra_loi`.", isError: true };
  }

  const def = port.catalog().find((item) => item.name === workflow);
  if (def === undefined) return unknownWorkflow(port.catalog());

  const outcome = await port.answer({
    workflow,
    subject,
    answer,
    targetRoom: room,
    answeredBy: ctx.identity.senderId,
    nowMs: Date.now(),
  });
  if (outcome === undefined) return unknownWorkflow(port.catalog());

  switch (outcome.kind) {
    case "recorded":
      return {
        content:
          `Đã ghi ${def.answerLabel} ${outcome.request.answer} cho ${def.subjectLabel} ` +
          `${outcome.request.subject} và báo về bên hỏi. Cảm ơn người vừa trả lời, ngắn gọn.`,
      };
    case "invalid_answer":
      return {
        content:
          `"${answer}" không phải ${def.answerLabel} hợp lệ. Hỏi lại người trong nhóm cho đúng ` +
          `${def.answerLabel} — KHÔNG tự suy ra một mã.` +
          (def.answerHelp === undefined ? "" : `\n${def.answerHelp}`),
        isError: true,
      };
    case "not_found":
      return {
        content:
          outcome.openSubjects.length === 0
            ? `Nhóm này không có việc nào đang chờ trả lời. Đừng ghi gì thêm.`
            : `Không có việc nào mang ${def.subjectLabel} "${subject}" ở nhóm này. Đang chờ: ` +
              `${outcome.openSubjects.join(", ")}. Hỏi lại cho đúng khoá.`,
        isError: true,
      };
    case "closed":
      return {
        content:
          `Việc này vừa được đóng (đã có trả lời hoặc đã quá hạn) — KHÔNG ghi lại, không báo thêm.`,
      };
  }
}
