// types.ts — hợp đồng tầng skills.
//
// Skill = 1 folder chứa SKILL.md (frontmatter + body) + references/** (chi tiết). Non-dev sửa,
// KHÔNG deploy: loader đọc từ filesystem lúc bootstrap. Progressive disclosure — context mặc
// định chỉ có `meta` (name+description); body/references load KHI CẦN (xem loader.ts).
//
// SKILL.md untrusted (non-dev gõ tay) → frontmatter validate runtime ở loader, không tin blind.

/** Frontmatter SKILL.md. 2 khoá bắt buộc; là phần luôn ở context (progressive disclosure). */
export interface SkillMeta {
  /** Khoá trong registry. Viết thường, không khoảng trắng. */
  readonly name: string;
  /** 1 dòng — dữ liệu DUY NHẤT đưa vào context mặc định để LLM/selector quyết có load không. */
  readonly description: string;
  /**
   * Root agent được thấy skill này (`agents: dealer, operations` trong frontmatter).
   * undefined = MỌI agent — mặc định mở, vì phần lớn skill là quy trình dùng chung.
   *
   * Khai khi skill nhắc tới tool mà chỉ một agent cầm: agent không có tool đó mà đọc được hướng
   * dẫn dùng nó thì hoặc bịa kết quả, hoặc kẹt giữa chừng.
   *
   * Tên agent là CHUỖI, không phải enum của tầng agents: skills/ là tầng lá, import AgentType từ
   * agents/ sẽ tạo cycle (agents → tools → skills). Sai tên bắt ở bootstrap (fail-fast).
   */
  readonly agents?: readonly string[];
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
