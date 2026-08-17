// selector.ts — cơ chế MODEL TỰ CHỌN skill (như Claude Code), không selector cứng theo keyword.
//
// 2 nửa của progressive disclosure phía model:
//   1. renderSkillCatalog: đưa CHỈ name+description mọi skill vào system prompt (tầng 1). Model
//      đọc menu này, tự quyết skill nào hợp task.
//   2. useSkill: model gọi (qua tool) với tên nó chọn → load body + reference (tầng 2 VÀ 3 gộp).
//      Tên = model sinh = untrusted → không tồn tại thì trả STRUCTURED (ok:false) để model tự sửa,
//      KHÔNG throw ra loop (lỗi I/O thật mới propagate cho tool-runner cô lập).
//
// TẠI SAO tầng 3 gộp vào tầng 2: tách ra thì mỗi tài liệu tốn một HOP LLM (model phải dừng lượt để
// gọi tool rồi soạn lại). Đo trên prod: một lượt 6 vòng có 4 vòng chỉ để lấy doc = 23.5s/38.7s, và
// vòng nặng nhất viết 2022 token nháp rồi bỏ vì phát hiện thiếu doc. Tiết kiệm token bằng cách bắt
// model đi thêm hop là lỗ: token input gần như không tính vào latency, hop thì tính đủ.
// `useReference` giữ lại cho tài liệu vượt ngân sách (xem REFERENCE_BUDGET_CHARS).

import { readBody, listReferences, readReference } from "./loader.ts";
import type { SkillRegistry } from "./registry.ts";
import type { Skill, SkillMeta } from "./types.ts";

/** Câu dẫn đứng trên catalog trong system prompt — bảo model cách kích hoạt skill. */
const CATALOG_HEADER =
  "Skill có sẵn (gọi tool use_skill với `name` khi task hợp mô tả để nạp hướng dẫn đầy đủ, " +
  "kèm luôn tài liệu chi tiết của skill đó):";

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

/** 1 reference đã kèm sẵn nội dung (tầng 3 gộp vào tầng 2). */
export interface LoadedReference {
  readonly name: string;
  readonly content: string;
}

/** Kết quả model gọi useSkill — structured, ok:false cho tên lạ (input model, model tự sửa). */
export type UseSkillResult =
  | {
      ok: true;
      name: string;
      body: string;
      /** Reference kèm luôn nội dung — model KHÔNG cần gọi use_reference cho mấy cái này. */
      loaded: readonly LoadedReference[];
      /** Reference vượt ngân sách, vẫn phải gọi use_reference. Thường rỗng. */
      remaining: readonly string[];
    }
  | { ok: false; error: string };

/**
 * Trần ký tự cho phần reference kèm sẵn trong MỘT lượt use_skill.
 *
 * Vì sao có trần chứ không kèm hết: skill do non-dev soạn, một hôm ai thêm reference 200KB là nổ
 * cửa sổ context. Trần này là cái phanh, không phải cái van tiết kiệm.
 *
 * Vì sao trần RỘNG (40k ký tự ≈ 13k token): đo trên prod thì `llm_ms ≈ 800 + out_tokens × 6.3` —
 * token INPUT gần như không tính vào latency, còn mỗi lượt use_reference tiết kiệm được là bớt một
 * hop 2-13s (model phải dừng lượt, gọi tool, rồi soạn lại từ đầu). Đổi token vào lấy hop ra.
 *
 * Mốc chọn theo skill dày nhất hiện có (`chinh-sach-hoa-hong`: 7 tài liệu ≈ 32k ký tự) — cộng chỗ
 * thở. Vượt trần thì suy giảm mềm: tài liệu TO nhất rụng xuống use_reference, phần còn lại vẫn kèm đủ.
 */
const REFERENCE_BUDGET_CHARS = 40_000;

/**
 * Model chọn skill theo `name` → nạp body + KÈM LUÔN nội dung reference (tầng 2 + 3 trong một lượt).
 * Tên không có trong registry → ok:false (không throw). Lỗi đọc file thật → propagate cho
 * tool-runner cô lập.
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
  const [body, names] = await Promise.all([readBody(skill), listReferences(skill)]);
  const { loaded, remaining } = await bundleReferences(skill, names);
  return { ok: true, name: skill.meta.name, body, loaded, remaining };
}

/**
 * Đọc reference kèm vào ngay lượt use_skill: NHỎ TRƯỚC cho tới khi cạn `REFERENCE_BUDGET_CHARS`,
 * phần còn lại chỉ trả tên. Nhỏ trước vì với một trần cố định thì thứ tự đó nhồi được nhiều tài
 * liệu nhất — cơ hội model đã có sẵn thứ nó cần là cao nhất.
 *
 * Đọc HẾT rồi mới bỏ phần quá khổ: file reference cỡ vài KB, cả lượt đọc đĩa mất 1-4ms (đo trong
 * log prod: `tool xong=1-4ms`) — không đáng dựng thêm một đường stat riêng để né.
 */
async function bundleReferences(
  skill: Skill,
  names: readonly string[],
): Promise<{ loaded: LoadedReference[]; remaining: string[] }> {
  const docs = await Promise.all(
    names.map(async (name) => ({ name, content: await readReference(skill, name) })),
  );
  docs.sort((a, b) => a.content.length - b.content.length);

  const loaded: LoadedReference[] = [];
  const remaining: string[] = [];
  let used = 0;
  for (const doc of docs) {
    if (used + doc.content.length <= REFERENCE_BUDGET_CHARS) {
      loaded.push(doc);
      used += doc.content.length;
    } else {
      remaining.push(doc.name);
    }
  }
  return { loaded, remaining };
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
