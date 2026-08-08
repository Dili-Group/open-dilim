// skills.test.ts — nạp registry từ defs thật + kiểm loader (frontmatter, progressive disclosure,
// chặn traversal) trên fixture tạm.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSkillRegistry } from "./index.ts";
import { SkillRegistry } from "./registry.ts";
import { loadAllSkills, readBody, listReferences, readReference } from "./loader.ts";
import { renderSkillCatalog, useSkill, useReference, visibleTo } from "./selector.ts";

describe("registry (defs thật)", () => {
  test("buildSkillRegistry nạp mọi skill trong defs/", async () => {
    const registry = await buildSkillRegistry();
    const names = registry.catalog().map((m) => m.name).sort();
    expect(names).toEqual([
      "bao-cao-cuoi-ngay",
      "chiet-khau",
      "don-hang",
      "don-hoan",
      "giuc-don",
      "het-hang",
      "lap-lich",
    ]);
  });

  test("het-hang nêu đủ ba hướng và không hứa tồn kho", async () => {
    const registry = await buildSkillRegistry();
    const skill = registry.get("het-hang");
    expect(skill).toBeDefined();
    expect(await readBody(skill!)).toContain("KHÔNG có dữ liệu tồn kho");
    expect([...(await listReferences(skill!))].sort()).toEqual(["mau-cau.md", "phuong-an.md"]);
    expect(await readReference(skill!, "phuong-an.md")).toContain("kho hoàn");
  });

  test("lap-lich: nhân viên gõ được ở nhóm đại lý lẫn nhóm vận hành, agent không tự đặt", async () => {
    const registry = await buildSkillRegistry();
    const skill = registry.get("lap-lich");
    expect(skill).toBeDefined();
    expect(skill?.meta.agents).toEqual(["dealer", "operations"]);
    expect(await readBody(skill!)).toContain("Agent KHÔNG đặt được lịch");
  });

  test("catalog chỉ trả meta (name/description)", async () => {
    const registry = await buildSkillRegistry();
    const skill = registry.catalog().find((m) => m.name === "chiet-khau");
    expect(skill).toEqual({
      name: "chiet-khau",
      description: expect.any(String),
      // Skill nhắc tool `tra_ho_so_dai_ly` → chỉ agent đại lý được thấy.
      agents: ["dealer"],
    });
  });

  test("get trả skill, body/references load lazy", async () => {
    const registry = await buildSkillRegistry();
    const skill = registry.get("CHIET-KHAU"); // case-insensitive
    expect(skill).toBeDefined();
    expect(await readBody(skill!)).toContain("NHÂN VIÊN gõ xác nhận");
    // Thứ tự do readdir quyết (khác nhau giữa máy) → so sánh sau khi sort.
    expect([...(await listReferences(skill!))].sort()).toEqual(["bang-muc.md", "nang-muc.md", "xac-nhan-nang.md"]);
    expect(await readReference(skill!, "bang-muc.md")).toContain("500 triệu");
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
    expect(catalog).toContain("- chiet-khau:");
    // Tầng 1 KHÔNG rò body ra prompt.
    expect(catalog).not.toContain("NHÂN VIÊN gõ xác nhận");
  });

  test("renderSkillCatalog registry rỗng → chuỗi rỗng", () => {
    expect(renderSkillCatalog(new SkillRegistry())).toBe("");
  });

  test("useSkill nạp body + references khi model chọn đúng tên", async () => {
    const registry = await buildSkillRegistry();
    const result = await useSkill(registry, "chiet-khau");
    expect(result).toMatchObject({ ok: true, name: "chiet-khau" });
    if (result.ok) {
      expect(result.body).toContain("NHÂN VIÊN gõ xác nhận");
      expect([...result.references].sort()).toEqual(["bang-muc.md", "nang-muc.md", "xac-nhan-nang.md"]);
    }
  });

  test("useSkill tên lạ → ok:false structured (không throw)", async () => {
    const registry = await buildSkillRegistry();
    const result = await useSkill(registry, "khong-co");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("không tồn tại") });
  });

  test("useReference đào sâu tầng 3; ref lạ → ok:false", async () => {
    const registry = await buildSkillRegistry();
    const ok = await useReference(registry, "chiet-khau", "bang-muc.md");
    expect(ok).toMatchObject({ ok: true, skill: "chiet-khau", reference: "bang-muc.md" });
    if (ok.ok) expect(ok.content).toContain("500 triệu");

    const bad = await useReference(registry, "chiet-khau", "khong-co.md");
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

describe("scope skill theo root agent", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "skills-scope-"));
    await mkdir(join(dir, "rieng"), { recursive: true });
    await writeFile(
      join(dir, "rieng", "SKILL.md"),
      "---\nname: rieng\ndescription: chỉ đại lý\nagents: dealer, operations\n---\nnội dung riêng",
    );
    await mkdir(join(dir, "chung", "references"), { recursive: true });
    await writeFile(join(dir, "chung", "SKILL.md"), "---\nname: chung\ndescription: ai cũng thấy\n---\nbody");
    await writeFile(join(dir, "chung", "references", "r.md"), "chi tiết chung");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function registryOf(): Promise<SkillRegistry> {
    const registry = new SkillRegistry();
    for (const skill of await loadAllSkills(dir)) registry.register(skill);
    return registry;
  }

  test("frontmatter agents: parse thành danh sách thường hoá", async () => {
    const skills = await loadAllSkills(dir);
    expect(skills.find((s) => s.meta.name === "rieng")?.meta.agents).toEqual(["dealer", "operations"]);
    // Vắng khoá = mọi agent, KHÔNG phải danh sách rỗng.
    expect(skills.find((s) => s.meta.name === "chung")?.meta.agents).toBeUndefined();
  });

  test('khai "agents:" rỗng → throw (lỗi soạn, không đoán thành mọi agent)', async () => {
    const solo = await mkdtemp(join(tmpdir(), "skills-scope-empty-"));
    await mkdir(join(solo, "x"), { recursive: true });
    await writeFile(join(solo, "x", "SKILL.md"), "---\nname: x\ndescription: d\nagents:\n---\nbody");
    await expect(loadAllSkills(solo)).rejects.toThrow(/khai rỗng/);
    await rm(solo, { recursive: true, force: true });
  });

  test("catalog chỉ liệt kê skill khai cho agent đang chạy", async () => {
    const registry = await registryOf();
    expect(renderSkillCatalog(registry, "dealer")).toContain("- rieng:");
    expect(renderSkillCatalog(registry, "personal")).not.toContain("- rieng:");
    expect(renderSkillCatalog(registry, "personal")).toContain("- chung:");
    // Không truyền agent = không lọc (test/dev).
    expect(renderSkillCatalog(registry)).toContain("- rieng:");
  });

  test("useSkill/useReference chặn agent ngoài scope, KHÔNG chỉ lọc catalog", async () => {
    const registry = await registryOf();
    expect(await useSkill(registry, "rieng", "operations")).toMatchObject({ ok: true });
    // Model đoán tên ngoài menu vẫn phải trượt — và trượt y như skill không tồn tại.
    expect(await useSkill(registry, "rieng", "personal")).toEqual({
      ok: false,
      error: "Skill không tồn tại: rieng",
    });
    expect(await useReference(registry, "chung", "r.md", "personal")).toMatchObject({ ok: true });
  });

  test("visibleTo: vắng agents = mọi agent", () => {
    expect(visibleTo({ name: "a", description: "d" }, "personal")).toBe(true);
    expect(visibleTo({ name: "a", description: "d", agents: ["dealer"] }, "DEALER")).toBe(true);
    expect(visibleTo({ name: "a", description: "d", agents: ["dealer"] }, "boss")).toBe(false);
  });
});
