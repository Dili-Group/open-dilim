// index.ts — điểm lắp tầng skills. Bootstrap gọi buildSkillRegistry() 1 lần để NẠP TẤT CẢ skill
// từ defs/ vào registry, rồi share cho worker/selector.
//
// Thêm skill: tạo folder trong defs/ có SKILL.md — KHÔNG sửa file này (loader quét tự động).

import { loadAllSkills } from "./loader.ts";
import { SkillRegistry } from "./registry.ts";

/** Thư mục chứa skill def (1 folder/skill). Cạnh file này → resolve theo import.meta.dir. */
const DEFAULT_DEFS_DIR = `${import.meta.dir}/defs`;

/**
 * Nạp mọi skill trong defsDir vào 1 registry. Async vì đọc filesystem. Frontmatter hỏng /
 * trùng tên → throw (fail fast lúc bootstrap, không để lỗi trồi lúc chạy).
 */
export async function buildSkillRegistry(defsDir: string = DEFAULT_DEFS_DIR): Promise<SkillRegistry> {
  const registry = new SkillRegistry();
  for (const skill of await loadAllSkills(defsDir)) {
    registry.register(skill);
  }
  return registry;
}

export { SkillRegistry } from "./registry.ts";
export { loadAllSkills, loadSkill, readBody, listReferences, readReference } from "./loader.ts";
export { renderSkillCatalog, useSkill, useReference } from "./selector.ts";
export type { UseSkillResult, UseReferenceResult } from "./selector.ts";
export type { Skill, SkillMeta } from "./types.ts";
