// verify.ts — bước XÁC MINH trước khi đưa câu hỏi vào hàng chờ: gate tầng 0 chỉ nhìn TEXT,
// bước này nhìn TRẠNG THÁI (phòng đã xác thực chưa, ngân sách phòng còn không). Chặn ở đây thay
// vì để tới worker vì worker xử lý lượt vượt trần bằng cách BÁO về phòng — đúng khi có người
// gọi agent, thành spam khi agent tự nhảy vào.
//
// Chỉ chạy cho tin ĐÃ qua gate (~20% chatter nhóm) nên thêm 1-2 query mỗi tin là chấp nhận
// được — cùng mức với message_log vốn ghi Postgres mọi tin.

import { checkDailyBudget } from "../usage/gate.ts";
import { resolveAgentType } from "../agents/router.ts";
import type { GroupCustomerLookup } from "../auth/types.ts";
import type { UsagePort } from "../usage/types.ts";
import type { ProactiveSpec } from "../agents/types.ts";
import type { Envelope } from "../types/index.ts";

/** Hàm verify mà ProactiveIngest gọi giữa gate và schedule. true = được vào hàng chờ. */
export type ProactiveVerify = (envelope: Envelope, spec: ProactiveSpec) => Promise<boolean>;

export interface ProactiveVerifyDeps {
  readonly groups: GroupCustomerLookup;
  /** undefined = hệ chưa nối đo chi phí → không có gì để so, cho qua (cùng semantics worker). */
  readonly usage?: {
    readonly port: UsagePort;
    readonly usdVndRate: number;
    readonly enforce: boolean;
  };
}

export function buildProactiveVerify(deps: ProactiveVerifyDeps): ProactiveVerify {
  return async (envelope, spec) => {
    // Phòng chưa xác thực (chưa bind chủ phòng) → agent không có phạm vi dữ liệu để giúp.
    if (spec.requireBoundGroup === true) {
      const customerId = await deps.groups.customerIdOf({
        channel: envelope.channel,
        groupId: envelope.conversationId,
      });
      if (customerId === undefined) return false;
    }

    // Phòng đã tiêu quá trần ngày → không đưa vào hàng chờ. Cùng gate với worker (bước 6d)
    // nhưng chặn TRƯỚC: lượt proactive vượt trần mà để worker xử thì nó báo "hết ngân sách"
    // vào phòng không ai hỏi.
    if (deps.usage !== undefined) {
      const agentType = resolveAgentType(envelope.channel);
      if (agentType !== undefined) {
        const decision = await checkDailyBudget({
          usage: deps.usage.port,
          conversationId: envelope.conversationId,
          agentType,
          usdVndRate: deps.usage.usdVndRate,
          enforce: deps.usage.enforce,
        });
        if (!decision.allowed) return false;
      }
    }

    return true;
  };
}
