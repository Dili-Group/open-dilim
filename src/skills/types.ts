// types.ts — hợp đồng tầng skills.
//
// Skill = 1 folder chứa SKILL.md (frontmatter + body) + references/** (chi tiết). Non-dev sửa,
// KHÔNG deploy: loader đọc từ filesystem lúc bootstrap. Progressive disclosure — context mặc
// định chỉ có `meta` (name+description+version); body/references load KHI CẦN (xem loader.ts).
//
// SKILL.md untrusted (non-dev gõ tay) → frontmatter validate runtime ở loader, không tin blind.

/** Frontmatter SKILL.md. 3 khoá bắt buộc; là phần luôn ở context (progressive disclosure). */
export interface SkillMeta {
  /** Khoá trong registry. Viết thường, không khoảng trắng. */
  readonly name: string;
  /** 1 dòng — dữ liệu DUY NHẤT đưa vào context mặc định để LLM/selector quyết có load không. */
  readonly description: string;
  /** SemVer-ish, do người soạn skill khai. Dùng cho audit / cache-bust. */
  readonly version: string;
}

/**
 * 1 skill đã nạp. CHỈ metadata + đường dẫn folder — body/references KHÔNG giữ trong bộ nhớ
 * (đọc lazy qua loader). Giữ Skill là data thuần (không đóng fs vào closure) → dễ catalog/test.
 */
export interface Skill {
  readonly meta: SkillMeta;
  /** Đường dẫn tuyệt đối folder chứa SKILL.md + references/. */
  readonly dir: string;
}
