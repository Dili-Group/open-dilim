// skills.test.ts — nạp registry từ defs thật + kiểm loader (frontmatter, progressive disclosure,
// chặn traversal) trên fixture tạm.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSkillRegistry } from "./index.ts";
import { SkillRegistry } from "./registry.ts";
import { loadAllSkills, readBody, listReferences, readReference } from "./loader.ts";
import { renderSkillCatalog, useSkill, useReference } from "./selector.ts";

describe("registry (defs thật)", () => {
  test("buildSkillRegistry nạp mọi skill trong defs/", async () => {
    const registry = await buildSkillRegistry();
    const names = registry.catalog().map((m) => m.name).sort();
    expect(names).toEqual(["refund", "tone"]);
  });

  test("catalog chỉ trả meta (name/description)", async () => {
    const registry = await buildSkillRegistry();
    const tone = registry.catalog().find((m) => m.name === "tone");
    expect(tone).toEqual({
      name: "tone",
      description: expect.stringContaining("Giọng trả lời"),
    });
  });

  test("get trả skill, body/references load lazy", async () => {
    const registry = await buildSkillRegistry();
    const refund = registry.get("REFUND"); // case-insensitive
    expect(refund).toBeDefined();
    expect(await readBody(refund!)).toContain("chờ duyệt");
    expect(await listReferences(refund!)).toEqual(["policy.md"]);
    expect(await readReference(refund!, "policy.md")).toContain("7 ngày");
  });

  test("register trùng tên → throw", () => {
    const registry = new SkillRegistry();
    const skill = { meta: { name: "x", description: "d" }, dir: "/tmp" };
    registry.register(skill);
    expect(() => registry.register(skill)).toThrow(/trùng tên/);
  });
});

describe("selector — model tự chọn skill", () => {
  test("renderSkillCatalog liệt kê CHỈ name+description, kèm câu dẫn use_skill", async () => {
    const registry = await buildSkillRegistry();
    const catalog = renderSkillCatalog(registry);
    expect(catalog).toContain("use_skill");
    expect(catalog).toContain("- tone:");
    expect(catalog).toContain("- refund:");
    // Tầng 1 KHÔNG rò body ra prompt.
    expect(catalog).not.toContain("chờ duyệt");
  });

  test("renderSkillCatalog registry rỗng → chuỗi rỗng", () => {
    expect(renderSkillCatalog(new SkillRegistry())).toBe("");
  });

  test("useSkill nạp body + references khi model chọn đúng tên", async () => {
    const registry = await buildSkillRegistry();
    const result = await useSkill(registry, "refund");
    expect(result).toMatchObject({ ok: true, name: "refund" });
    if (result.ok) {
      expect(result.body).toContain("chờ duyệt");
      expect(result.references).toEqual(["policy.md"]);
    }
  });

  test("useSkill tên lạ → ok:false structured (không throw)", async () => {
    const registry = await buildSkillRegistry();
    const result = await useSkill(registry, "khong-co");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("không tồn tại") });
  });

  test("useReference đào sâu tầng 3; ref lạ → ok:false", async () => {
    const registry = await buildSkillRegistry();
    const ok = await useReference(registry, "refund", "policy.md");
    expect(ok).toMatchObject({ ok: true, skill: "refund", reference: "policy.md" });
    if (ok.ok) expect(ok.content).toContain("7 ngày");

    const bad = await useReference(registry, "refund", "khong-co.md");
    expect(bad).toEqual({ ok: false, error: expect.stringContaining("không tồn tại") });
  });
});

describe("loader (fixture tạm)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "skills-test-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeSkill(name: string, content: string) {
    const skillDir = join(dir, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), content);
    return skillDir;
  }

  test("frontmatter thiếu khoá bắt buộc → throw lúc load", async () => {
    await writeSkill("bad-missing", "---\nname: x\n---\nbody");
    await expect(loadAllSkills(dir)).rejects.toThrow(/thiếu khoá bắt buộc/);
  });

  test("frontmatter không đóng → throw", async () => {
    const solo = await mkdtemp(join(tmpdir(), "skills-solo-"));
    await mkdir(join(solo, "s"), { recursive: true });
    await writeFile(join(solo, "s", "SKILL.md"), "---\nname: x\ndescription: d");
    await expect(loadAllSkills(solo)).rejects.toThrow(/không đóng/);
    await rm(solo, { recursive: true, force: true });
  });

  test("folder không có SKILL.md bị bỏ qua (không sập)", async () => {
    const solo = await mkdtemp(join(tmpdir(), "skills-empty-"));
    await mkdir(join(solo, "junk"), { recursive: true });
    expect(await loadAllSkills(solo)).toEqual([]);
    await rm(solo, { recursive: true, force: true });
  });

  test("readReference chặn path traversal", async () => {
    const skillDir = await writeSkill("ok", "---\nname: ok\ndescription: d\n---\nbody");
    const skill = { meta: { name: "ok", description: "d" }, dir: skillDir };
    await expect(readReference(skill, "../SKILL.md")).rejects.toThrow(/không hợp lệ/);
    await expect(readReference(skill, "/etc/passwd")).rejects.toThrow(/không hợp lệ/);
  });
});
