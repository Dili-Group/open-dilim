// xac-nhan.ts — root agent THƯ KÝ SỔ của nhóm xác nhận đơn với BS Sơn (kênh `zalo`, nhận diện
// theo ID NHÓM — xem agents/dedicated-rooms.ts). Chỉ khai báo; luồng chạy lượt ở runtime/.
//
// KHÔNG khai ORDER_TOOLS/DEALER_TOOLS dù nhóm này nằm trên tài khoản Zalo đại lý: nhóm không
// thuộc đại lý nào nên `roomCustomerId` luôn undefined, mấy tool đó chỉ trả lỗi "chưa biết đại
// lý" — và nếu có chạy được thì cũng là mở dữ liệu đại lý ra một nhóm không liên quan.
//
// KHÔNG khai phễu proactive: cổng ý định (worker/intake.ts) đã chấm MỌI tin của nhóm này. Thêm
// phễu nữa là hai đường cùng đánh thức agent cho một tin.

import { internalOpsSpec } from "../../state/specs.ts";
import { COMMON_TOOLS, XACNHAN_TOOLS } from "../../tools/index.ts";
import { XACNHAN_PROMPT } from "../prompts.ts";
import { AgentType, type RootAgentProfile } from "../types.ts";

export const xacNhanProfile: RootAgentProfile = {
  agentType: AgentType.OrderConfirm,
  // Làm việc trong NHÓM. Sổ thuộc về nhóm, không thuộc người gõ.
  directOnly: false,
  prompt: XACNHAN_PROMPT,
  // Nhớ VIỆC chứ không nhớ sở thích khách: nhóm này bàn ca nào đã đăng ký.
  memorySpec: internalOpsSpec,
  // CHỈ ghi đăng ký (+ bộ chung để nạp skill). Không đọc ảnh/file: cổng ý định chỉ cho tin có
  // CHỮ vào lượt, và việc của agent dừng ở ghi sổ rồi báo lại kết quả ghi.
  tools: [...COMMON_TOOLS, ...XACNHAN_TOOLS],
};
