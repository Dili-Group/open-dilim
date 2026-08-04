// registry.ts — giữ skill đã nạp, tra theo tên. Open/closed: thêm skill = thêm folder defs/,
// KHÔNG sửa file này (loader quét, registry chỉ chứa).
//
// Registry chỉ giữ metadata + đường dẫn (Skill là data thuần) → nhẹ, share toàn app an toàn.
// catalog() = mặt tiền progressive disclosure: đưa CHỈ meta vào prompt, LLM/selector chọn xong
// mới readBody/readReference (loader) để load chi tiết.

import type { Skill, SkillMeta } from "./types.ts";

export class SkillRegistry {
  readonly #skills = new Map<string, Skill>();

  /** Đăng ký 1 skill. Trùng name → throw (lỗi soạn skill, phát hiện lúc bootstrap). */
  register(skill: Skill): this {
    const key = skill.meta.name.toLowerCase();
    if (this.#skills.has(key)) {
      throw new Error(`Skill trùng tên: ${key}`);
    }
    this.#skills.set(key, skill);
    return this;
  }

  get(name: string): Skill | undefined {
    return this.#skills.get(name.toLowerCase());
  }

  /** Mọi skill đã nạp (introspection / debug). */
  list(): readonly Skill[] {
    return [...this.#skills.values()];
  }

  /**
   * Meta mọi skill — phần DUY NHẤT đưa vào context mặc định. Selector/LLM đọc name+description ở
   * đây để quyết load skill nào, tránh nhồi toàn bộ body vào prompt.
   */
  catalog(): readonly SkillMeta[] {
    return this.list().map((s) => s.meta);
  }
}
