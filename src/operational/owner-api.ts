// owner-api.ts — OrderOwnerPort chạy thật trên `GET /agent/orders/{code}/dealer`.
//
// ENDPOINT DUY NHẤT KHÔNG GẮN `x-dealer-id` (getUnscoped): việc của nó chính là TRA RA đại lý từ
// một mã, nên lúc gọi chưa có đại lý nào để mà ép phạm vi. Đổi lại, nó CHỈ trả định danh đại lý —
// muốn biết đơn có gì thì gọi OrderPort với đúng đại lý vừa tra được.
//
// 404 → null (hệ vận hành không có đơn nào mang mã này). Lỗi khác bubble lên để nơi gọi phân biệt
// "không có đơn" với "gọi hỏng" — hai ca đó dẫn tới hai câu trả lời khác hẳn nhau cho người dùng.

import { AgentApiError, readEnvelopeData, type AgentApiClient } from "./agent-api.ts";
import { asRecord, numberAsString, readString } from "./read.ts";
import type { OrderOwner, OrderOwnerPort } from "./types.ts";

/** Mã vận đơn vào path → phải encode (mã có thể chứa `/`). */
function ownerPath(trackingNumber: string): string {
  return `/agent/orders/${encodeURIComponent(trackingNumber)}/dealer`;
}

export class AgentApiOrderOwnerPort implements OrderOwnerPort {
  constructor(private readonly api: AgentApiClient) {}

  async ownerOf(trackingNumber: string, signal?: AbortSignal): Promise<OrderOwner | null> {
    const path = ownerPath(trackingNumber);
    let body: unknown;
    try {
      body = await this.api.getUnscoped(path, { signal });
    } catch (err) {
      if (err instanceof AgentApiError && err.status === 404) return null;
      throw err;
    }

    const record = asRecord(readEnvelopeData(body, path));
    if (record === undefined) return null;
    // id bigint: backend trả chuỗi, nhưng số cũng nhận — giữ nguyên chữ số, không tính gì lên nó.
    const dealerId = readString(record, "dealer_id") ?? numberAsString(record, "dealer_id");
    // Không có định danh đại lý = câu trả lời vô dụng (không tra được nhóm nào) → coi như không có.
    if (dealerId === undefined) return null;
    return {
      dealerId,
      dealerCode: readString(record, "dealer_code"),
      dealerName: readString(record, "dealer_name"),
    };
  }
}
