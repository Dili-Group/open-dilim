// registry.ts — map slug → WorkflowDef. CHỈ lo việc tra cứu; cách một việc chạy nằm ở engine.ts,
// còn nghiệp vụ nào tồn tại nằm ở defs/.
//
// Cùng khuôn với agents/registry.ts: thêm nghiệp vụ = thêm 1 file DATA ở defs/ + 1 dòng register.

import type { WorkflowDef } from "./types.ts";

export class WorkflowRegistry {
  private readonly byName = new Map<string, WorkflowDef>();

  register(def: WorkflowDef): this {
    this.byName.set(def.name, def);
    return this;
  }

  /**
   * undefined = slug lạ. KHÔNG rơi về một def mặc định: chạy nhầm nghiệp vụ thì hỏi nhầm người
   * bằng câu chữ của việc khác — tệ hơn hẳn việc báo lỗi.
   */
  resolve(name: string): WorkflowDef | undefined {
    return this.byName.get(name);
  }

  /** Mọi def đã đăng ký — poller cần để tra def của từng việc đang treo. */
  all(): readonly WorkflowDef[] {
    return [...this.byName.values()];
  }
}
