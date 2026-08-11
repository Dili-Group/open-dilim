// gate.ts — quyết định lượt này có được chạy LLM không. Tách khỏi worker để test được bằng số,
// không phải dựng cả một lượt thật.
//
// Mô hình TRẢ SAU: chi phí chỉ biết được SAU khi model trả lời, nên không đặt chỗ trước được.
// Gate so phần ĐÃ tiêu với trần; lượt làm vượt trần vẫn chạy trọn, lượt kế mới bị chặn. Vượt tối
// đa một lượt (~400đ) — đổi lấy việc không phải đoán trước chi phí, xứng đáng.

import { dailyBudgetVnd } from "./budget.ts";
import { picoUsdToVnd, vndToPicoUsd } from "./pricing.ts";
import type { UsagePort } from "./types.ts";

export interface BudgetDecision {
  readonly allowed: boolean;
  /** VND đã tiêu hôm nay — vào log để biết phòng nào đang tiến sát trần. */
  readonly spentVnd: number;
  readonly limitVnd: number | null;
}

export interface BudgetCheckInput {
  readonly usage: UsagePort;
  readonly conversationId: string;
  readonly agentType: string;
  readonly usdVndRate: number;
  /** false = chỉ ĐO, không chặn (shadow mode). Luôn trả allowed=true nhưng vẫn báo số đã tiêu. */
  readonly enforce: boolean;
}

export async function checkDailyBudget(input: BudgetCheckInput): Promise<BudgetDecision> {
  const limitVnd = dailyBudgetVnd(input.agentType);
  if (limitVnd === null) return { allowed: true, spentVnd: 0, limitVnd: null };

  const spentPico = await input.usage.spentTodayPicoUsd(input.conversationId);
  const spentVnd = picoUsdToVnd(spentPico, input.usdVndRate);
  const limitPico = vndToPicoUsd(limitVnd, input.usdVndRate);
  const overBudget = spentPico >= limitPico;

  return { allowed: !(overBudget && input.enforce), spentVnd, limitVnd };
}
