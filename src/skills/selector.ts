// selector.ts — cơ chế MODEL TỰ CHỌN skill (như Claude Code), không selector cứng theo keyword.
//
// 2 nửa của progressive disclosure phía model:
//   1. renderSkillCatalog: đưa CHỈ name+description mọi skill vào system prompt (tầng 1). Model
//      đọc menu này, tự quyết skill nào hợp task.
//   2. useSkill / useReference: model gọi (qua tool) với tên nó chọn → load body/reference (tầng
//      2,3). Tên = model sinh = untrusted → không tồn tại thì trả STRUCTURED (ok:false) để model
//      tự sửa, KHÔNG throw ra loop (lỗi I/O thật mới propagate cho tool-runner cô lập).

import { readBody, listReferences, readReference } from "./loader.ts";
import type { SkillRegistry } from "./registry.ts";

/** Câu dẫn đứng trên catalog trong system prompt — bảo model cách kích hoạt skill. */
const CATALOG_HEADER =
  "Skill có sẵn (gọi tool use_skill với `name` khi task hợp mô tả để nạp hướng dẫn đầy đủ):";

/**
 * Khối markdown liệt kê skill cho system prompt (tầng 1). CHỈ name+description — không body →
 * rẻ token. Rỗng skill → chuỗi rỗng (không nhồi header thừa).
 */
export function renderSkillCatalog(registry: SkillRegistry): string {
  const items = registry.catalog();
  if (items.length === 0) return "";
  const lines = items.map((m) => `- ${m.name}: ${m.description}`);
  return `${CATALOG_HEADER}\n${lines.join("\n")}`;
}

/** Kết quả model gọi useSkill — structured, ok:false cho tên lạ (input model, model tự sửa). */
export type UseSkillResult =
  | { ok: true; name: string; version: string; body: string; references: readonly string[] }
  | { ok: false; error: string };

/**
 * Model chọn skill theo `name` → nạp body + danh sách reference (tầng 2). Tên không có trong
 * registry → ok:false (không throw). Lỗi đọc file thật → propagate cho tool-runner cô lập.
 */
export async function useSkill(registry: SkillRegistry, name: string): Promise<UseSkillResult> {
  const skill = registry.get(name);
  if (skill === undefined) {
    return { ok: false, error: `Skill không tồn tại: ${name}` };
  }
  const [body, references] = await Promise.all([readBody(skill), listReferences(skill)]);
  return { ok: true, name: skill.meta.name, version: skill.meta.version, body, references };
}

/** Kết quả model gọi useReference — structured như useSkill. */
export type UseReferenceResult =
  | { ok: true; skill: string; reference: string; content: string }
  | { ok: false; error: string };

/**
 * Model đào sâu 1 reference của skill (tầng 3). Tên skill/reference lạ → ok:false. Traversal
 * bị readReference chặn (throw) → propagate (đó là input độc, không phải "không tìm thấy").
 */
export async function useReference(
  registry: SkillRegistry,
  skillName: string,
  reference: string,
): Promise<UseReferenceResult> {
  const skill = registry.get(skillName);
  if (skill === undefined) {
    return { ok: false, error: `Skill không tồn tại: ${skillName}` };
  }
  const available = await listReferences(skill);
  if (!available.includes(reference)) {
    return { ok: false, error: `Reference không tồn tại trong ${skillName}: ${reference}` };
  }
  return { ok: true, skill: skill.meta.name, reference, content: await readReference(skill, reference) };
}
