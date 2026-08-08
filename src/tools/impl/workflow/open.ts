// open.ts — tool CHUNG: mở một việc chờ bên liên quan trả lời (§6).
//
// Một tool cho MỌI nghiệp vụ: `ma_viec` chọn WorkflowDef, `khoa` là thứ cần hỏi. Thêm nghiệp vụ
// không thêm tool — danh mục tự nở ra trong description.
//
// Tool KHÔNG nhận "hỏi nhóm nào": nhóm đích do def tra ra từ khoá (server-side). Model không có
// đường chỉ định hỏi nhầm người.

import { readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import { NO_PORT, NO_ROOM, renderCatalog, roomOf, unknownWorkflow } from "./scope.ts";

export function buildWorkflowOpenTool(ctx: ToolContext): Tool {
  const defs = ctx.workflow?.catalog() ?? [];
  return {
    name: "mo_viec_cho",
    description:
      "Mở một việc cần HỎI BÊN LIÊN QUAN rồi chờ họ trả lời (có thể mất 1-2 ngày). Dùng khi nhóm " +
      "này nhận được một dữ kiện mà chỉ bên kia mới biết câu trả lời. Hệ thống tự tìm đúng nhóm " +
      "cần hỏi, tự nhắc lại nếu họ chưa trả lời, và tự báo kết quả về nhóm này khi có. " +
      `Loại việc đang dùng được — ${renderCatalog(defs)}.`,
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
            "Khoá cần hỏi, chép NGUYÊN VĂN từ tin nhắn người dùng (ví dụ mã đơn hoàn). Không tự " +
            "sửa, không rút gọn, không bỏ đuôi.",
        },
      },
      required: ["ma_viec", "khoa"],
    },
    // Tra hệ vận hành + gửi câu hỏi sang nhóm khác mất vài giây → trấn an trước.
    announce: "Dạ để em kiểm tra rồi hỏi lại bên liên quan giúp anh/chị ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> => runOpen(ctx, input, signal),
  };
}

async function runOpen(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const port = ctx.workflow;
  if (port === undefined) return NO_PORT;

  const room = roomOf(ctx);
  if (room === undefined) return NO_ROOM;

  const workflow = readStringField(input, "ma_viec");
  const subject = readStringField(input, "khoa");
  if (workflow === undefined || subject === undefined) {
    return { content: "Thiếu `ma_viec` hoặc `khoa`.", isError: true };
  }

  const def = port.catalog().find((item) => item.name === workflow);
  if (def === undefined) return unknownWorkflow(port.catalog());

  const outcome = await port.open({
    workflow,
    subject,
    origin: room,
    requesterId: ctx.identity.senderId,
    nowMs: Date.now(),
    signal,
  });
  // undefined = slug lạ. Đã chặn ở trên bằng catalog, nhưng registry có thể đổi giữa chừng.
  if (outcome === undefined) return unknownWorkflow(port.catalog());

  switch (outcome.kind) {
    case "asked":
      // Nhóm cần hỏi chính là nhóm này → không có ai để chuyển tiếp: hỏi thẳng ngay trong câu trả
      // lời của lượt này, đừng hứa "sẽ báo lại".
      if (outcome.selfRoom) {
        return {
          content:
            `${def.targetLabel} cần hỏi CHÍNH LÀ nhóm này. Đã ghi nhận việc chờ cho ` +
            `${def.subjectLabel} ${outcome.request.subject} — giờ hỏi thẳng người trong nhóm này ` +
            `${def.answerLabel}, nhắc lại ${def.subjectLabel} NGUYÊN VĂN. Khi họ trả lời, gọi ` +
            `tra_loi_viec để đóng việc.`,
        };
      }
      return {
        content:
          `Đã hỏi ${def.targetLabel} về ${def.subjectLabel} ${outcome.request.subject}. ` +
          `Có ${def.answerLabel} là hệ thống báo ngay vào nhóm này — nói với người dùng là em đã ` +
          `hỏi và sẽ báo lại, KHÔNG hứa thời điểm cụ thể.`,
      };
    case "already_open":
      return {
        content:
          `${def.subjectLabel} ${outcome.request.subject} đã hỏi ${def.targetLabel} rồi ` +
          `(${outcome.request.askCount} lần) và đang chờ trả lời — KHÔNG hỏi lại. Báo người dùng ` +
          `là việc đang chờ, có kết quả sẽ báo vào nhóm.`,
      };
    case "already_answered":
      return {
        content:
          `${def.subjectLabel} ${outcome.request.subject} đã có ${def.answerLabel}: ` +
          `${outcome.request.answer ?? "(không rõ)"}. Trả lời người dùng ngay, không hỏi lại ${def.targetLabel}.`,
      };
    case "invalid_subject":
      return {
        content:
          `"${subject}" không phải ${def.subjectLabel} hợp lệ cho việc này. Kiểm tra lại mã người ` +
          `dùng gõ; nếu mã đúng dạng khác thì việc này không cần hỏi ${def.targetLabel}.`,
        isError: true,
      };
    case "unknown_subject":
      return {
        content:
          `Hệ thống không tìm thấy ${def.subjectLabel} ${subject}. Hỏi lại người dùng xem mã có ` +
          `gõ đúng không — KHÔNG đoán ra một mã khác.`,
        isError: true,
      };
    case "no_room":
      return {
        content:
          `Không hỏi được: ${outcome.detail}. Báo người dùng là cần bên vận hành nối nhóm cho ` +
          `${def.targetLabel} trước, việc này em chưa hỏi được.`,
        isError: true,
      };
    case "failed":
      return {
        content:
          `Chưa mở được việc cho ${def.subjectLabel} ${subject} (${outcome.reason}). ` +
          `KHÔNG có việc nào được ghi nhận — hệ thống sẽ KHÔNG tự hỏi lại. Gọi lại tool này một ` +
          `lần nữa ngay trong lượt này; vẫn hỏng thì báo người dùng là em chưa hỏi được và sẽ thử lại.`,
        isError: true,
      };
  }
}
