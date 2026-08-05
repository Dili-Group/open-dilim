// types.ts — hợp đồng tầng agents. File LÁ: registry.ts và roots/* cùng import từ đây nên không
// tạo cycle (contract ← root agent ← registry).

import type { Effort } from "../config.ts";
import type { LLMProvider } from "../llm/types.ts";
import type { Identity } from "../flash-command/types.ts";
import type { AgentResult, HistoryEntry } from "../types/index.ts";
import type { DistillSpec, MemoryRecall, MemoryScope } from "../state/types.ts";
import type { SkillRegistry } from "../skills/registry.ts";

/** Config con agent cần (subset của CONFIG) — narrow để test khỏi dựng full Config. */
export interface AgentConfig {
  readonly maxTokens: number;
  readonly effort: Effort;
  readonly agentMaxIterations: number;
}

/** Mọi thứ root agent cần, dựng 1 lần ở bootstrap. */
export interface AgentDeps {
  readonly provider: LLMProvider;
  readonly config: AgentConfig;
  /** Catalog skill vào system prompt + backing cho tool use_skill. */
  readonly skills: SkillRegistry;
  /** Cổng CHỈ-ĐỌC (đường ghi memory là distiller chạy ngầm sau lượt, không phải việc của agent). */
  readonly memory?: MemoryRecall;
}

export interface AgentRunInput {
  readonly identity: Identity;
  readonly history: readonly HistoryEntry[];
  /** Do worker cấp — agent KHÔNG tự derive (derive sai = rò memory sang khách khác). */
  readonly memoryScope?: MemoryScope;
  /** Nhịp báo "đang xử lý" về kênh mỗi bước loop. Worker bind sẵn target; agent chỉ gọi. */
  readonly onStep?: () => Promise<void>;
  readonly signal?: AbortSignal;
}

export interface RootAgent {
  readonly agentType: string;
  /** Policy chưng cất trí nhớ CỦA agent này — bộ chưng cất tuỳ agent, không chung một kiểu. */
  readonly memorySpec: DistillSpec;
  /**
   * KHÔNG reject: lỗi trong lượt trả `{status:"failed"}`, chạm approval gate (§6) trả
   * `{status:"suspended"}`. Worker dựa hợp đồng này để không phải bọc catch mọi thứ.
   */
  run(input: AgentRunInput): Promise<AgentResult>;
}
