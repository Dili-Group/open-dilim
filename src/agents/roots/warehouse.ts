// warehouse.ts — root agent cho NHÂN VIÊN KHO trong nhóm nhận hàng hoàn. Chỉ khai báo; luồng
// chạy lượt nằm ở agents/runtime/build-agent.ts.
//
// Bên ĐI HỎI của việc treo (§6): nhận mã hoàn không tra được đơn gốc → mở việc, hệ thống tự hỏi
// đại lý và tự báo kết quả về nhóm này (có thể 1-2 ngày sau).
//
// KHÔNG khai ORDER_TOOLS/DEALER_TOOLS: nhóm kho không thuộc đại lý nào, `roomCustomerId` luôn
// undefined nên mấy tool đó chỉ trả lỗi "chưa biết đại lý". Cần tra đơn thì đi qua nhân viên
// vận hành, đúng như trước khi có agent này.

import { internalOpsSpec } from "../../state/specs.ts";
import { COMMON_TOOLS, WORKFLOW_ASK_TOOLS, WORKFLOW_LIST_TOOLS } from "../../tools/index.ts";
import { WAREHOUSE_PROMPT } from "../prompts.ts";
import { AgentType, type RootAgentProfile } from "../types.ts";

export const warehouseProfile: RootAgentProfile = {
  agentType: AgentType.Warehouse,
  // Kho làm việc trong NHÓM → phục vụ group (và việc treo neo vào nhóm, không vào người gõ).
  directOnly: false,
  prompt: WAREHOUSE_PROMPT,
  memorySpec: internalOpsSpec,
  tools: [...COMMON_TOOLS, ...WORKFLOW_ASK_TOOLS, ...WORKFLOW_LIST_TOOLS],
};
