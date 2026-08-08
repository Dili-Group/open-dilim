// discount-api.ts — DiscountPort chạy thật trên hai endpoint bậc chiết khấu:
//   GET  /agent/discount-tiers          — danh mục bậc (kèm sort_order).
//   POST /agent/discount-tiers/upgrade  — GHI lệnh nâng bậc cho đại lý ở header `x-dealer-id`.
//
// Đại lý và nhân viên KHÔNG đi qua body: cả hai lên header (`x-dealer-id`, `x-staff-id`) như mọi
// endpoint `/agent/*`. Body chỉ có `tier_id` + `reason` — model không có đường nào chỉ định đại lý
// khác, kể cả khi nó tự bịa ra một dealer_id.
//
// Cùng luật boundary với profile-api.ts: JSON là `unknown`, field thiếu/sai kiểu → undefined.
// KHÁC ở chỗ danh mục bậc là dữ liệu QUYẾT ĐỊNH (nâng hay hạ đọc từ `sort_order`): bậc thiếu
// `id`/`tier_name`/`sort_order` bị LOẠI khỏi danh sách, không hạ cấp thành giá trị mặc định — một
// `sortOrder` bịa là một lần hạ bậc lọt qua cửa kiểm.

import {
  AgentApiError,
  AgentApiErrorCode,
  readEnvelopeData,
  type AgentApiClient,
} from "./agent-api.ts";
import { asRecord, isPresent, numberAsString, readBoolean, readNumber, readString } from "./read.ts";
import type {
  DiscountPort,
  DiscountTier,
  DiscountTierRef,
  OrderPrincipal,
  TierUpgradeResult,
} from "./types.ts";

const TIERS_PATH = "/agent/discount-tiers";
const UPGRADE_PATH = "/agent/discount-tiers/upgrade";

export class AgentApiDiscountPort implements DiscountPort {
  constructor(private readonly api: AgentApiClient) {}

  async tiers(
    p: OrderPrincipal & { signal?: AbortSignal },
  ): Promise<readonly DiscountTier[]> {
    const body = await this.api.get(TIERS_PATH, {
      principal: { dealerId: p.dealerId, staffId: p.staffId },
      signal: p.signal,
    });

    const data = readEnvelopeData(body, TIERS_PATH);
    if (!Array.isArray(data)) return [];
    return data.map(parseTier).filter(isPresent);
  }

  async upgrade(
    p: OrderPrincipal & { tierId: string; reason: string; signal?: AbortSignal },
  ): Promise<TierUpgradeResult> {
    const body = await this.api.post(UPGRADE_PATH, {
      principal: { dealerId: p.dealerId, staffId: p.staffId },
      body: { tier_id: p.tierId, reason: p.reason },
      signal: p.signal,
    });

    const record = asRecord(readEnvelopeData(body, UPGRADE_PATH));
    const scheduleId = record === undefined ? undefined : readIdString(record, "schedule_id");
    const toTier = record === undefined ? undefined : parseTier(record["to_tier"]);
    // Hai field này là BẰNG CHỨNG lệnh đã ghi. Thiếu chúng thì không biết đã ghi hay chưa — báo
    // lỗi shape để tool nói "chưa chắc, kiểm tra lại", KHÔNG dựng kết quả nửa vời rồi báo thành công.
    if (record === undefined || scheduleId === undefined || toTier === undefined) {
      throw new AgentApiError(
        `POST ${UPGRADE_PATH} trả response thiếu schedule_id hoặc to_tier`,
        200,
        AgentApiErrorCode.InvalidResponse,
        UPGRADE_PATH,
      );
    }

    return {
      scheduleId,
      toTier,
      dealerCode: readString(record, "dealer_code"),
      fromTier: parseTierRef(record["from_tier"]),
      effectiveFrom: readString(record, "effective_from"),
      reason: readString(record, "reason"),
      changedBy: readIdString(record, "changed_by"),
    };
  }
}

/** undefined = bậc thiếu dữ kiện quyết định (id/tên/thứ tự) → bỏ khỏi danh mục, không đoán bù. */
function parseTier(value: unknown): DiscountTier | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;

  const id = readIdString(record, "id");
  const tierName = readString(record, "tier_name");
  const sortOrder = readNumber(record, "sort_order");
  if (id === undefined || tierName === undefined || sortOrder === undefined) return undefined;

  return {
    id,
    tierName,
    sortOrder,
    // Backend trả `display_label: string | null` — null/thiếu đều thành undefined (readString lo).
    displayLabel: readString(record, "display_label"),
    // Thiếu cờ cổ đông → false: thang thường là thang mặc định của mọi đại lý.
    isShareholder: readBoolean(record, "is_shareholder") ?? false,
  };
}

/** `from_tier` là `null` khi đại lý chưa từng xếp bậc — trạng thái thật, không phải lỗi. */
function parseTierRef(value: unknown): DiscountTierRef | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;

  const id = readIdString(record, "id");
  const tierName = readString(record, "tier_name");
  const sortOrder = readNumber(record, "sort_order");
  if (id === undefined || tierName === undefined || sortOrder === undefined) return undefined;
  return { id, tierName, sortOrder };
}

/** id bigint: backend trả chuỗi, nhưng số cũng nhận — giữ nguyên chữ số, không tính gì lên nó. */
function readIdString(record: Record<string, unknown>, key: string): string | undefined {
  return readString(record, key) ?? numberAsString(record, key);
}
