// use-reference.ts — tầng 3 progressive disclosure: model đào sâu 1 reference của skill đã nạp.
// Tên reference do model sinh → traversal (`../`) bị chặn ở selector (không nằm trong danh sách
// available) → trả isError structured, KHÔNG throw ra loop.

import type { SkillRegistry } from "../../skills/registry.ts";
import { useReference } from "../../skills/selector.ts";
import { readStringField } from "../input.ts";
import type { Tool, ToolResult } from "../types.ts";

export function buildUseReferenceTool(skills: SkillRegistry, agentType?: string): Tool {
  return {
    name: "use_reference",
    description: "Đọc một tài liệu reference của skill đã nạp (chi tiết sâu hơn body skill).",
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
