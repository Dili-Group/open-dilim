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
import type { Skill, SkillMeta } from "./types.ts";

/** Câu dẫn đứng trên catalog trong system prompt — bảo model cách kích hoạt skill. */
const CATALOG_HEADER =
  "Skill có sẵn (gọi tool use_skill với `name` khi task hợp mô tả để nạp hướng dẫn đầy đủ):";

/**
 * Skill có hiện với agent này không. `meta.agents` vắng = mọi agent. `agentType` undefined = KHÔNG
 * lọc — chỉ xảy ra ở test/dev; wiring thật luôn truyền agent đang chạy (build-agent.ts).
 */
export function visibleTo(meta: SkillMeta, agentType: string | undefined): boolean {
  if (meta.agents === undefined || agentType === undefined) return true;
  return meta.agents.includes(agentType.toLowerCase());
}

/**
 * Khối markdown liệt kê skill cho system prompt (tầng 1). CHỈ name+description — không body →
 * rẻ token. Rỗng skill → chuỗi rỗng (không nhồi header thừa).
 *
 * Lọc theo `agentType`: agent chỉ thấy skill khai cho nó. Cùng luật với useSkill/useReference —
 * lọc mỗi catalog là hở, vì model đoán tên skill ngoài menu vẫn nạp được.
 */
export function renderSkillCatalog(registry: SkillRegistry, agentType?: string): string {
  const items = registry.catalog().filter((meta) => visibleTo(meta, agentType));
  if (items.length === 0) return "";
  const lines = items.map((m) => `- ${m.name}: ${m.description}`);
  return `${CATALOG_HEADER}\n${lines.join("\n")}`;
}

/** Kết quả model gọi useSkill — structured, ok:false cho tên lạ (input model, model tự sửa). */
export type UseSkillResult =
  | { ok: true; name: string; body: string; references: readonly string[] }
  | { ok: false; error: string };

/**
 * Model chọn skill theo `name` → nạp body + danh sách reference (tầng 2). Tên không có trong
 * registry → ok:false (không throw). Lỗi đọc file thật → propagate cho tool-runner cô lập.
 */
export async function useSkill(
  registry: SkillRegistry,
  name: string,
  agentType?: string,
): Promise<UseSkillResult> {
  const skill = resolveVisible(registry, name, agentType);
  if (skill === undefined) {
    return { ok: false, error: `Skill không tồn tại: ${name}` };
  }
  const [body, references] = await Promise.all([readBody(skill), listReferences(skill)]);
  return { ok: true, name: skill.meta.name, body, references };
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
  agentType?: string,
): Promise<UseReferenceResult> {
  const skill = resolveVisible(registry, skillName, agentType);
  if (skill === undefined) {
    return { ok: false, error: `Skill không tồn tại: ${skillName}` };
  }
  const available = await listReferences(skill);
  if (!available.includes(reference)) {
    return { ok: false, error: `Reference không tồn tại trong ${skillName}: ${reference}` };
  }
  return { ok: true, skill: skill.meta.name, reference, content: await readReference(skill, reference) };
}

/**
 * Tra skill NHƯNG chỉ trả khi agent này được thấy. Skill bị chặn trả về y như skill không có: model
 * không cần biết có một skill nó không được dùng, và câu trả lời khác nhau chỉ tổ để nó gạ lại.
 */
function resolveVisible(
  registry: SkillRegistry,
  name: string,
  agentType: string | undefined,
): Skill | undefined {
  const skill = registry.get(name);
  if (skill === undefined || !visibleTo(skill.meta, agentType)) return undefined;
  return skill;
}
