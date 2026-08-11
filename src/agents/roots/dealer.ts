// dealer.ts — root agent cho ĐẠI LÝ (kế toán đại lý) trong nhóm chat của đại lý đó. Chỉ khai
// báo; luồng chạy lượt nằm ở agents/runtime/build-agent.ts.

import { customerSupportSpec } from "../../state/specs.ts";
import {
  COMMON_TOOLS,
  DAILY_TOOLS,
  DEALER_TIER_TOOLS,
  DEALER_TOOLS,
  ORDER_TOOLS,
  POSCAKE_TOOLS,
  VISION_TOOLS,
  WORKFLOW_LIST_TOOLS,
  WORKFLOW_REPLY_TOOLS,
} from "../../tools/index.ts";
import { DEALER_PROMPT } from "../prompts.ts";
import { AgentType, type RootAgentProfile } from "../types.ts";

export const dealerProfile: RootAgentProfile = {
  agentType: AgentType.Dealer,
  // Đại lý làm việc trong NHÓM của họ → cần group scope để đọc/ghi trí nhớ của phòng.
  directOnly: false,
  prompt: DEALER_PROMPT,
  memorySpec: customerSupportSpec,
  // Bên ĐƯỢC HỎI của việc treo (§6): nhóm khác nhờ hỏi đại lý một dữ kiện (vd mã đơn gốc của
  // đơn hoàn) → agent hỏi trong nhóm, đại lý trả lời lúc nào thì ghi lúc đó, kể cả 2 ngày sau.
  //
  // DEALER_TIER_TOOLS mang đường GHI duy nhất của agent này (nâng bậc chiết khấu). Nó ở đây vì
  // cuộc trao đổi nâng mức diễn ra ngay trong nhóm đại lý: đại lý xin, nhân viên phụ trách gõ xác
  // nhận. Tool tự chặn theo vai người gõ, không dựa vào prompt.
  //
  // POSCAKE_TOOLS cũng ghi, nhưng ghi thứ CỦA ĐẠI LÝ (Shop ID + API Key PosCake của họ) nên đại lý
  // tự gõ được — đi liền sau khi agent hướng dẫn lấy key (skill `huong-dan`, reference poscake.md).
  //
  // VISION_TOOLS vì đại lý hay gửi ẢNH thay vì gõ: phiếu chuyển khoản, ảnh màn hình PosCake báo
  // lỗi, ảnh đơn in ra. Đọc lười — chỉ mở ảnh khi nội dung ảnh cần cho việc đang hỏi.
  tools: [
    ...COMMON_TOOLS,
    ...ORDER_TOOLS,
    ...DEALER_TOOLS,
    ...DEALER_TIER_TOOLS,
    ...DAILY_TOOLS,
    ...POSCAKE_TOOLS,
    ...VISION_TOOLS,
    ...WORKFLOW_REPLY_TOOLS,
    ...WORKFLOW_LIST_TOOLS,
  ],
};
