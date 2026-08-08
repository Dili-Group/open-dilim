// list.ts — tool CHUNG: liệt kê việc đang treo LIÊN QUAN TỚI NHÓM NÀY, theo hai chiều:
//   - nhóm này PHẢI trả lời (bên kia đang chờ mình)
//   - nhóm này ĐÃ hỏi và còn chờ (mình đang chờ bên kia)
//
// Có tool này thì người trong nhóm hỏi "còn cái nào chưa xong" là trả lời được bằng DỮ LIỆU, thay
// vì để model lục lại lịch sử chat — thứ đã trôi mất từ đời nào sau 1-2 ngày.

import type { WorkflowDef } from "../../../workflows/types.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import { NO_PORT, NO_ROOM, renderPendingLine, roomOf } from "./scope.ts";

export function buildWorkflowListTool(ctx: ToolContext): Tool {
  return {
    name: "viec_dang_cho",
    description:
      "Liệt kê việc đang chờ trả lời liên quan tới nhóm này: việc nhóm này phải trả lời, và việc " +
      "nhóm này đã hỏi bên khác mà chưa có kết quả. Dùng khi có người hỏi 'còn cái nào chưa xong', " +
      "'đã hỏi chưa', 'bao giờ có'. CHỈ ĐỌC.",
    inputSchema: { type: "object", properties: {}, required: [] },
    run: (): Promise<ToolResult> => runList(ctx),
  };
}

async function runList(ctx: ToolContext): Promise<ToolResult> {
  const port = ctx.workflow;
  if (port === undefined) return NO_PORT;

  const room = roomOf(ctx);
  if (room === undefined) return NO_ROOM;

  // Hai chiều độc lập nhau → hỏi song song, đừng bắt người dùng chờ hai lượt DB nối tiếp.
  const [toAnswer, waiting] = await Promise.all([
    port.openForTarget(room),
    port.openForOrigin(room),
  ]);
  if (toAnswer.length === 0 && waiting.length === 0) {
    return { content: "Nhóm này không có việc nào đang chờ." };
  }

  const defs = new Map<string, WorkflowDef>(port.catalog().map((def) => [def.name, def]));
  const sections: string[] = [];
  if (toAnswer.length > 0) {
    sections.push(
      ["NHÓM NÀY CẦN TRẢ LỜI:", ...toAnswer.map((item) => renderPendingLine(item, defs.get(item.workflow)))].join("\n"),
    );
  }
  if (waiting.length > 0) {
    sections.push(
      ["NHÓM NÀY ĐANG CHỜ BÊN KHÁC:", ...waiting.map((item) => renderPendingLine(item, defs.get(item.workflow)))].join("\n"),
    );
  }
  return { content: sections.join("\n\n") };
}
