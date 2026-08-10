// types.ts — hợp đồng tool (design §tools): interface Tool { name, schema, run }.
//
// QUAN TRỌNG (chống confused-deputy): danh tính KHÔNG vào schema. Tool chỉ nhận tham số
// nghiệp vụ LLM sinh (mã đơn, ngày...). Act-as handle (userId/customerId) bind từ identity
// SERVER-SIDE qua closure lúc dựng tool cho request — xem buildTools(identity) trong index.ts.

import type { AnnouncePort } from "../announcements/types.ts";
import type { Identity } from "../flash-command/types.ts";
import type {
  DailyPort,
  DealerPort,
  DiscountPort,
  OrderPort,
  PoscakePort,
} from "../operational/types.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import type { WorkflowPort } from "../workflows/service.ts";
import type { RoomRef } from "../workflows/types.ts";

export interface ToolResult {
  /** Nội dung trả về LLM (đã stringify). */
  readonly content: string;
  /** true = lỗi nghiệp vụ → LLM tự sửa, KHÔNG throw ra loop. */
  readonly isError?: boolean;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema object cho tham số nghiệp vụ (không chứa danh tính). */
  readonly inputSchema: Record<string, unknown>;
  /**
   * Câu báo "đang làm" gửi NGAY khi model gọi tool này, trước khi tool chạy (agents/runtime/loop.ts
   * phát 1 lần/lượt). Khai ở đây vì "việc này lâu, phải trấn an khách" là tính chất CỦA TOOL —
   * loop/worker chỉ chuyển phát, model không được quyết (nói rồi mới im lặng còn tệ hơn im luôn).
   * Bỏ trống = tool nhanh/nội bộ, không báo gì.
   *
   * KHÔNG mở đầu bằng "Dạ": tin này không vào history nên model không thấy nó, câu trả lời ngay
   * sau đó rất dễ mở y hệt → người nhận thấy hai tin liền cùng một kiểu mở, đọc ra là máy soạn.
   * Câu này cũng đi tới CẢ nhóm nội bộ lẫn nhóm đại lý → giữ trung tính, đừng xưng hô riêng cho
   * một phía ("giúp anh/chị" nghe lạc trong nhóm vận hành).
   */
  readonly announce?: string;
  run(input: unknown, signal?: AbortSignal): Promise<ToolResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory — mỗi agent khai BỘ TOOL của nó (agent đại lý không thấy tool nội bộ). Tool cần
// identity phải dựng lại mỗi request (closure act-as) nên profile giữ FACTORY, không giữ Tool.
// ─────────────────────────────────────────────────────────────────────────────

/** Thứ có sẵn lúc dựng tool cho 1 lượt: app-scoped (`skills`) + per-request (`identity`). */
export interface ToolContext {
  readonly skills: SkillRegistry;
  readonly identity: Identity;
  /**
   * Root agent đang chạy lượt — quyết định skill nào agent này ĐƯỢC nạp (use_skill/use_reference
   * lọc theo đây). undefined = không lọc (test/dev); wiring thật luôn truyền (build-agent.ts).
   */
  readonly agentType?: string;
  /**
   * Đại lý SỞ HỮU PHÒNG này (worker tra từ group_map), không phải đại lý của người gõ: nhân viên
   * gõ trong nhóm đại lý X thì Identity không mang X nhưng đơn hỏi vẫn là đơn của X.
   * undefined = phòng chưa `/ketnoi-daily`, hoặc chat 1-1.
   */
  readonly roomCustomerId?: string;
  /** Cổng đọc đơn hàng. undefined = chưa nối hệ vận hành → tool tra đơn trả lỗi nghiệp vụ, không throw. */
  readonly orders?: OrderPort;
  /** Cổng đọc hồ sơ đại lý (bậc chiết khấu). undefined = chưa nối → tool trả lỗi nghiệp vụ. */
  readonly dealer?: DealerPort;
  /**
   * Cổng bậc chiết khấu: đọc danh mục bậc + GHI lệnh nâng bậc. Cổng DUY NHẤT có đường ghi —
   * chỉ agent nào thật sự cần mới được khai (xem DEALER_TIER_TOOLS ở tools/index.ts).
   */
  readonly discount?: DiscountPort;
  /** Cổng đọc sổ ngày (xuất kho/hoàn/tiền phải trả/tiền hoàn). undefined = chưa nối → tool trả lỗi. */
  readonly daily?: DailyPort;
  /**
   * Cổng NẠP tài khoản PosCake của đại lý (Shop ID + API Key). Cổng duy nhất chạm CREDENTIAL của
   * đại lý — chỉ agent nào thật sự hướng dẫn PosCake mới được khai (POSCAKE_TOOLS ở tools/index.ts).
   * undefined = chưa nối → tool trả lỗi nghiệp vụ.
   */
  readonly poscake?: PoscakePort;
  /**
   * NHÓM của lượt này (kênh + id nhóm). Việc treo liên nhóm neo vào đây: nhóm hỏi là nhóm
   * này, và nhóm được hỏi cũng phải khớp nhóm này thì mới cho trả lời.
   * undefined = chat 1-1 → không mở/không trả lời được việc treo (việc thuộc về NHÓM, không
   * thuộc về một người).
   */
  readonly room?: RoomRef;
  /** Cổng nghiệp vụ chờ-trả-lời (§6). undefined = chưa nối → tool trả lỗi nghiệp vụ, không throw. */
  readonly workflow?: WorkflowPort;
  /**
   * Cổng PHÁT TIN CHUNG tới mọi nhóm đại lý (kho báo hết hàng). Bán kính ảnh hưởng lớn nhất trong
   * mọi cổng ở đây — tool của nó tự gate theo `role_slug`, và chốt gửi phải qua hai bước.
   * undefined = chưa nối → tool trả lỗi nghiệp vụ.
   */
  readonly announce?: AnnouncePort;
}

export type ToolFactory = (ctx: ToolContext) => Tool;
