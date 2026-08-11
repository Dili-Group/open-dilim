// use-skill.ts — tầng 2 progressive disclosure: model đọc catalog trong system prompt (tầng 1)
// rồi gọi tool này để nạp body đầy đủ. Đây là tool mà `renderSkillCatalog` đã HỨA với model.
//
// `skills` là registry app-scoped, đến từ closure y như identity ở whoami — model chỉ đưa TÊN
// skill, tức khoá tra vào registry server-side, không phải đường dẫn.

import type { SkillRegistry } from "../../skills/registry.ts";
import { useSkill, type UseSkillResult } from "../../skills/selector.ts";
import { readStringField } from "../input.ts";
import type { Tool, ToolResult } from "../types.ts";

export function buildUseSkillTool(skills: SkillRegistry, agentType?: string): Tool {
  return {
    name: "use_skill",
    description:
      "Nạp hướng dẫn đầy đủ của một skill trong danh sách skill có sẵn, KÈM LUÔN tài liệu chi " +
      "tiết của skill đó — không cần gọi use_reference sau đó.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Tên skill trong danh sách." } },
      required: ["name"],
    },
    async run(input: unknown): Promise<ToolResult> {
      const name = readStringField(input, "name");
      if (name === undefined) {
        return { content: 'Thiếu tham số "name" (chuỗi tên skill).', isError: true };
      }
      const result = await useSkill(skills, name, agentType);
      if (!result.ok) return { content: result.error, isError: true };
      return { content: render(result) };
    },
  };
}

/**
 * Body + NỘI DUNG các reference kèm sẵn. Trả hết trong một lượt để model không phải dừng lượt gọi
 * use_reference — mỗi hop như vậy tốn 2-13s (xem skills/selector.ts).
 *
 * Reference vượt ngân sách mới liệt kê theo tên; nói rõ là "chưa kèm" để model biết còn gì đào.
 */
function render(result: Extract<UseSkillResult, { ok: true }>): string {
  const lines = [`# Skill: ${result.name}`, "", result.body];
  for (const ref of result.loaded) {
    lines.push("", `## Tài liệu: ${ref.name}`, "", ref.content);
  }
  if (result.remaining.length > 0) {
    lines.push(
      "",
      `Tài liệu còn lại, quá dài nên CHƯA kèm — cần thì gọi use_reference với ` +
        `skill="${result.name}": ${result.remaining.join(", ")}`,
    );
  }
  return lines.join("\n");
}
