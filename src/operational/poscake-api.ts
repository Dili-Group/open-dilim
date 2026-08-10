// poscake-api.ts — PoscakePort chạy thật trên `POST /agent/poscake-shop`: nạp Shop ID + API Key
// PosCake của đại lý vào hệ vận hành để đơn PosCake chảy về hệ thống.
//
// Đại lý KHÔNG đi qua body: lấy từ header `x-dealer-id` (buildAgentHeaders), nhân viên gõ đi lên
// `x-staff-id` để backend audit ai nạp. Body chỉ có `shop_id` + `api_key`.
//
// API KEY LÀ BÍ MẬT: file này KHÔNG log body, KHÔNG nhét key vào message lỗi, KHÔNG trả key lại cho
// nơi gọi. AgentApiClient cũng không log body — lỗi chỉ mang method + path + status + code.
//
// KHÔNG retry (AgentApiClient.post đã tự chặn): bắn lại một lệnh ghi credential là ghi hai lần.

import {
  AgentApiError,
  AgentApiErrorCode,
  readEnvelopeData,
  type AgentApiClient,
} from "./agent-api.ts";
import { asRecord, numberAsString, readString } from "./read.ts";
import type { OrderPrincipal, PoscakePort, PoscakeShopLink } from "./types.ts";

const POSCAKE_PATH = "/agent/poscake-shop";

export class AgentApiPoscakePort implements PoscakePort {
  constructor(private readonly api: AgentApiClient) {}

  async register(
    p: OrderPrincipal & { shopId: string; apiKey: string; signal?: AbortSignal },
  ): Promise<PoscakeShopLink> {
    const body = await this.api.post(POSCAKE_PATH, {
      principal: { dealerId: p.dealerId, staffId: p.staffId },
      body: { shop_id: p.shopId, api_key: p.apiKey },
      signal: p.signal,
    });

    const record = asRecord(readEnvelopeData(body, POSCAKE_PATH));
    // shop_id là bằng chứng backend đã ghi. Thiếu nó thì không biết đã nạp hay chưa — báo lỗi shape
    // để tool nói "chưa chắc, kiểm tra lại", KHÔNG báo thành công.
    const shopId =
      record === undefined
        ? undefined
        : (readString(record, "shop_id") ?? numberAsString(record, "shop_id"));
    if (record === undefined || shopId === undefined) {
      throw new AgentApiError(
        `POST ${POSCAKE_PATH} trả response thiếu shop_id`,
        200,
        AgentApiErrorCode.InvalidResponse,
        POSCAKE_PATH,
      );
    }

    return { shopId, dealerCode: readString(record, "dealer_code") };
  }
}
