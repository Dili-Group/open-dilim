// types.ts — hợp đồng tầng agents. File LÁ: registry.ts và roots/* cùng import từ đây nên không
// tạo cycle (contract ← root agent ← registry).

import type { Effort } from "../config.ts";
import type { LLMProvider } from "../llm/types.ts";
import type { Identity } from "../flash-command/types.ts";
import type { AgentResult, HistoryEntry } from "../types/index.ts";
import type { DistillSpec, MemoryRecall, MemoryScope } from "../state/types.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import type { ToolFactory } from "../tools/types.ts";

/**
 * Whitelist root agent. Router (router.ts) chỉ được trả giá trị trong đây — chuỗi tự do lọt vào
 * registry là route mù. Thêm nghiệp vụ = thêm 1 hằng ở đây + 1 profile ở roots/ + 1 dòng register.
 */
export const AgentType = {
  Operations: "operations",
  Dealer: "dealer",
  Personal: "personal",
  Boss: "boss",
} as const;
export type AgentType = (typeof AgentType)[keyof typeof AgentType];

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
  /**
   * Agent CHỈ xử lý 1-1 (không phục vụ group). Worker dựa cờ này để bỏ qua group MemoryScope:
   * không có phòng thì không có chỗ gắn fact, không đọc/ghi trí nhớ theo phòng.
   */
  readonly directOnly: boolean;
  /** Policy chưng cất trí nhớ CỦA agent này — bộ chưng cất tuỳ agent, không chung một kiểu. */
  readonly memorySpec: DistillSpec;
  /**
   * KHÔNG reject: lỗi trong lượt trả `{status:"failed"}`, chạm approval gate (§6) trả
   * `{status:"suspended"}`. Worker dựa hợp đồng này để không phải bọc catch mọi thứ.
   */
  run(input: AgentRunInput): Promise<AgentResult>;
}

/**
 * Nhánh chuyên môn BÊN TRONG một root agent (§4: root chọn theo domain/vai, sub chọn theo TASK).
 * Sub thay prompt + bộ tool của root cho trọn lượt, KHÔNG chạy loop lồng loop: chọn xong thì sub
 * là người trả lời. Không có sub nào khớp → root tự trả lời.
 *
 * Sub KHÔNG khai memorySpec/directOnly: trí nhớ và phạm vi phòng thuộc về ROOT (cùng một hội
 * thoại), sub chỉ đổi cách xử lý lượt.
 */
export interface SubAgent {
  /** Định danh sub trong root — orchestrator trả đúng chuỗi này. */
  readonly name: string;
  /** Mô tả CHO ORCHESTRATOR ĐỌC: khi nào chọn sub này. Viết như mô tả tool. */
  readonly description: string;
  /** System prompt thay cho prompt root khi sub cầm lượt. */
  readonly prompt: string;
  readonly tools: readonly ToolFactory[];
}

/**
 * Khai báo một root agent — DATA, không phải code. Bộ máy chạy lượt nằm ở `buildRootAgent`
 * (runtime/build-agent.ts) và dùng chung cho mọi agent: thêm agent = thêm 1 file data ở roots/, không
 * copy-paste vòng assemble-context → orchestrate → loop.
 */
export interface RootAgentProfile {
  readonly agentType: string;
  /** Xem `RootAgent.directOnly`. */
  readonly directOnly: boolean;
  /** Persona + nhiệm vụ, làm prompt nền cho context assembler. */
  readonly prompt: string;
  readonly memorySpec: DistillSpec;
  readonly tools: readonly ToolFactory[];
  /** Rỗng/thiếu = root tự xử lý mọi lượt, KHÔNG tốn lượt LLM định tuyến nào. */
  readonly subAgents?: readonly SubAgent[];
}
