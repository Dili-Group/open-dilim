// dealer.ts — root agent cho ĐẠI LÝ (kế toán đại lý) trong nhóm chat của đại lý đó. Chỉ khai
// báo; luồng chạy lượt nằm ở agents/runtime/build-agent.ts.

import { customerSupportSpec } from "../../state/specs.ts";
import {
  COMMON_TOOLS,
  DAILY_TOOLS,
  DEALER_TIER_TOOLS,
  DEALER_TOOLS,
  DEALER_VALIDATE_TOOLS,
  ORDER_TOOLS,
  PAYMENT_BATCH_TOOLS,
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
  // PAYMENT_BATCH_TOOLS ghi PHIẾU THANH TOÁN GỘP (QR SePay cho nhiều đơn) — đại lý tự gõ được
  // như PosCake: phiếu chỉ gom đơn của chính đại lý phòng, dealerId ép qua header.
  tools: [
    ...COMMON_TOOLS,
    ...ORDER_TOOLS,
    ...PAYMENT_BATCH_TOOLS,
    // Đường GHI duyệt đơn qua kho cho đơn ĐÃ THANH TOÁN (COD 0đ / có bill CK) — phạm vi tự chặn
    // theo đại lý chủ phòng ngay trong tool, điều kiện nghiệp vụ ở skill `duyet-don-0d`.
    ...DEALER_VALIDATE_TOOLS,
    ...DEALER_TOOLS,
    ...DEALER_TIER_TOOLS,
    ...DAILY_TOOLS,
    ...POSCAKE_TOOLS,
    ...VISION_TOOLS,
    ...WORKFLOW_REPLY_TOOLS,
    ...WORKFLOW_LIST_TOOLS,
  ],
  // ⚠️ THỬ NGHIỆM (dev) — tool ngoài qua MCP, xem docs/architecture/10-mcp.md.
  //
  // KHÁC MỌI TOOL Ở TRÊN: tool MCP KHÔNG bind danh tính server-side. `tra_don_hang` ép
  // `roomCustomerId` qua closure nên chỉ tra được đơn của đại lý CHÍNH PHÒNG NÀY; tool MCP thì
  // nhận đúng tham số model sinh ra, phạm vi rộng bằng service token khai trong MCP_SERVERS.
  // Với server `kho` hiện tại nghĩa là: một đại lý gõ số điện thoại bất kỳ sẽ tra được đơn — và
  // link camera — của đại lý KHÁC.
  //
  // Giữ dòng này ở dev để thử. TRƯỚC KHI LÊN PROD phải chọn một trong hai: bỏ dòng này, hoặc
  // dựng cơ chế ép tham số đại lý server-side cho tool MCP (phương án B trong 10-mcp.md).
  mcpServers: ["kho"],
};
