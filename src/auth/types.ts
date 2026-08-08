// types.ts — port resolve danh tính. Vai LUÔN resolve từ senderId server-side TRƯỚC khi chạy
// agent (design §5 bước 6, §auth). LLM/client KHÔNG được tự set identity → chống bypass.

import type { Identity } from "../flash-command/types.ts";

export interface ResolveInput {
  readonly channel: string;
  readonly senderId: string;
  /** undefined khi chat trực tiếp (không phải group). */
  readonly groupId?: string;
}

export interface IdentityResolver {
  resolve(input: ResolveInput): Promise<Identity>;
}

/** Nhóm chat cần tra chủ sở hữu. Không có groupId (chat 1-1) thì không có gì để tra. */
export interface GroupLookupInput {
  readonly channel: string;
  readonly groupId: string;
}

/**
 * Tra nhóm → khách hàng sở hữu (group_map). TÁCH khỏi IdentityResolver vì đây là thuộc tính của
 * PHÒNG, không của người gõ: nhân viên gõ trong phòng khách X vẫn phải ra X (Identity nhân viên
 * không mang customerId). Dùng để dựng MemoryScope — memory thuộc phòng, không thuộc người.
 */
export interface GroupCustomerLookup {
  /** undefined = nhóm chưa bind / đã tắt → KHÔNG có memory scope (không đoán, không dùng rổ chung). */
  customerIdOf(input: GroupLookupInput): Promise<string | undefined>;
}

/** Nhóm chat của một khách: cặp (kênh, id nhóm). */
export interface CustomerRoom {
  readonly channel: string;
  readonly groupId: string;
}

/**
 * Chiều NGƯỢC của GroupCustomerLookup: khách hàng X → nhóm chat của họ. Dùng khi hệ thống chủ
 * động NHẮN cho khách (vd hỏi đại lý mã đơn gốc — workflows/), chứ không phải khi khách nhắn tới.
 *
 * Tách interface thay vì thêm method: hai chiều có hai nhóm người gọi khác hẳn nhau (mọi lượt
 * chat vs vài việc treo), và chiều này KHÔNG được nằm trên đường nóng của worker.
 */
export interface CustomerRoomLookup {
  /** undefined = khách chưa có nhóm nào đang bật → không có chỗ để nhắn. */
  roomOf(customerId: string): Promise<CustomerRoom | undefined>;
}
