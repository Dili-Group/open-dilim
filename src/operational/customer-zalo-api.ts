// customer-zalo-api.ts — CustomerZaloLinkPort chạy thật trên `POST /agent/customers/zalo-user-id`.
//
// Không gắn `x-dealer-id` lẫn `x-staff-id` (postUnscoped): đây chính là bước TRA RA đại lý từ số
// điện thoại, lúc gọi chưa biết đại lý nào để ép phạm vi — cùng lý do với `getUnscoped` ở owner-api.
//
// Body CHỈ hai khoá: backend bật `forbidNonWhitelisted` nên field lạ là 400, không phải bị bỏ qua.
//
// `matched: 0` KHÔNG phải lỗi (số chưa có hồ sơ khách) → trả về nguyên, để tool nói khác đi cho
// khách mới. 400 (số dưới 9 chữ số) và lỗi khác bubble lên.

import { readEnvelopeData, type AgentApiClient } from "./agent-api.ts";
import { asRecord, readNumber } from "./read.ts";
import type {
  CustomerZaloLink,
  CustomerZaloLinkPort,
  CustomerZaloLinkResult,
} from "./types.ts";

const LINK_PATH = "/agent/customers/zalo-user-id";

export class AgentApiCustomerZaloPort implements CustomerZaloLinkPort {
  constructor(private readonly api: AgentApiClient) {}

  async link(input: CustomerZaloLink, signal?: AbortSignal): Promise<CustomerZaloLinkResult> {
    const body = await this.api.postUnscoped(LINK_PATH, {
      signal,
      body: { customer_phone: input.phone, zalo_user_id: input.zaloUserId },
    });

    const record = asRecord(readEnvelopeData(body, LINK_PATH));
    // Thiếu `matched` = không đọc được kết quả. Trả 0 để tool đi nhánh "chưa gắn được" thay vì
    // báo đã gắn xong — nói nhầm là đã gắn thì không ai đi kiểm lại.
    return { matched: record === undefined ? 0 : (readNumber(record, "matched") ?? 0) };
  }
}
