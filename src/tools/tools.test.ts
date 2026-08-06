// Test tool use_skill / use_reference: chạy trên skill def THẬT (đọc filesystem), input model
// sinh là untrusted nên mọi shape rác phải ra isError chứ không throw. Kèm chốt chặn
// confused-deputy: KHÔNG schema tool nào được chứa trường danh tính.

import { describe, expect, test } from "bun:test";
import type { Identity } from "../flash-command/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import { COMMON_TOOLS, buildToolRegistry, readStringField } from "./index.ts";
import { buildUseSkillTool } from "./impl/use-skill.ts";
import { buildUseReferenceTool } from "./impl/use-reference.ts";

const GUEST: Identity = { role: "guest", senderId: "u1" };

// Registry thật từ src/skills/defs (có "refund" kèm references/policy.md).
const skills: SkillRegistry = await buildSkillRegistry();

describe("readStringField", () => {
  test("lấy chuỗi đã trim", () => {
    expect(readStringField({ name: "  refund " }, "name")).toBe("refund");
  });

  test("không phải object / thiếu key / sai kiểu / rỗng → undefined", () => {
    expect(readStringField(42, "name")).toBeUndefined();
    expect(readStringField(null, "name")).toBeUndefined();
    expect(readStringField({}, "name")).toBeUndefined();
    expect(readStringField({ name: 7 }, "name")).toBeUndefined();
    expect(readStringField({ name: "   " }, "name")).toBeUndefined();
  });
});

describe("use_skill", () => {
  const tool = buildUseSkillTool(skills);

  test("skill có thật → trả body + liệt kê reference", async () => {
    const result = await tool.run({ name: "refund" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("# Skill: refund");
    expect(result.content).toContain("use_reference");
  });

  test("tên lạ → isError structured, KHÔNG throw", async () => {
    const result = await tool.run({ name: "khong_co_skill_nay" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("không tồn tại");
  });

  test("input rác → isError", async () => {
    expect((await tool.run({})).isError).toBe(true);
    expect((await tool.run(42)).isError).toBe(true);
    expect((await tool.run({ name: 7 })).isError).toBe(true);
  });
});

describe("use_reference", () => {
  const tool = buildUseReferenceTool(skills);

  test("reference có thật → trả nội dung", async () => {
    const result = await tool.run({ skill: "refund", reference: "policy.md" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("refund / policy.md");
  });

  test("path traversal → isError, KHÔNG throw ra loop", async () => {
    const result = await tool.run({ skill: "refund", reference: "../SKILL.md" });
    expect(result.isError).toBe(true);
  });

  test("thiếu tham số → isError", async () => {
    expect((await tool.run({ skill: "refund" })).isError).toBe(true);
  });
});

describe("buildToolRegistry", () => {
  test("có đủ whoami + use_skill + use_reference", () => {
    const names = buildToolRegistry(COMMON_TOOLS, { skills, identity: GUEST })
      .schemas()
      .map((s) => s.name)
      .sort();
    expect(names).toEqual(["use_reference", "use_skill", "whoami"]);
  });

  test("KHÔNG schema nào chứa trường danh tính (chống confused-deputy)", () => {
    const forbidden = ["identity", "role", "user_id", "userId", "customer_id", "customerId", "sender_id", "senderId"];
    for (const schema of buildToolRegistry(COMMON_TOOLS, { skills, identity: GUEST }).schemas()) {
      const serialized = JSON.stringify(schema.inputSchema);
      for (const field of forbidden) {
        expect(serialized).not.toContain(field);
      }
    }
  });
});
