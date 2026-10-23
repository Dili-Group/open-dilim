// kiem-kho.ts — root agent THƯ KÝ KIỂM KHO của nhóm báo tồn (kênh `zalo-kho`, nhận diện theo ID
// NHÓM — xem agents/dedicated-rooms.ts). Chỉ khai báo; luồng chạy lượt ở runtime/.
//
// KHÔNG khai VISION_TOOLS dù việc chính là đọc ảnh: `ghi_ton_kho` tự đọc ảnh và tự đối chiếu số.
// Có thêm `xem_anh` là mở đường cho model đọc bảng rồi tự chép số — đúng thứ tool đang chặn.
//
// KHÔNG khai phễu proactive: cổng ý định (worker/intake.ts) đã chấm MỌI tin của nhóm này.

import { internalOpsSpec } from "../../state/specs.ts";
import { COMMON_TOOLS, INVENTORY_COUNT_TOOLS } from "../../tools/index.ts";
import { KIEMKHO_PROMPT } from "../prompts.ts";
import { AgentType, type RootAgentProfile } from "../types.ts";

export const kiemKhoProfile: RootAgentProfile = {
  agentType: AgentType.InventoryCount,
  // Kho gửi bảng trong NHÓM. Phiên kiểm thuộc về chi nhánh, không thuộc người gõ.
  directOnly: false,
  prompt: KIEMKHO_PROMPT,
  memorySpec: internalOpsSpec,
  tools: [...COMMON_TOOLS, ...INVENTORY_COUNT_TOOLS],
};
