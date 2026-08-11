// use-reference.ts — đường phụ cho tài liệu VƯỢT ngân sách kèm sẵn của use_skill (phần lớn skill
// không cần tới tool này nữa — xem skills/selector.ts). Giữ lại vì trần kèm sẵn là cái phanh chống
// context nổ, không phải lời hứa "luôn kèm đủ".
// Tên reference do model sinh → traversal (`../`) bị chặn ở selector (không nằm trong danh sách
// available) → trả isError structured, KHÔNG throw ra loop.

import type { SkillRegistry } from "../../skills/registry.ts";
import { useReference } from "../../skills/selector.ts";
import { readStringField } from "../input.ts";
import type { Tool, ToolResult } from "../types.ts";

export function buildUseReferenceTool(skills: SkillRegistry, agentType?: string): Tool {
  return {
    name: "use_reference",
    description:
      "Đọc một tài liệu của skill mà use_skill báo là CHƯA kèm (quá dài). use_skill đã trả sẵn " +
      "phần lớn tài liệu — chỉ gọi tool này khi tài liệu cần đọc nằm trong danh sách chưa kèm đó.",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", description: "Tên skill sở hữu reference." },
        reference: { type: "string", description: "Tên file reference như use_skill liệt kê." },
      },
      required: ["skill", "reference"],
    },
    async run(input: unknown): Promise<ToolResult> {
      const skill = readStringField(input, "skill");
      const reference = readStringField(input, "reference");
      if (skill === undefined || reference === undefined) {
        return { content: 'Cần cả "skill" và "reference" (chuỗi).', isError: true };
      }
      const result = await useReference(skills, skill, reference, agentType);
      if (!result.ok) return { content: result.error, isError: true };
      return { content: `# ${result.skill} / ${result.reference}\n\n${result.content}` };
    },
  };
}
