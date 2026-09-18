// profile-api.ts — DealerPort chạy thật trên `GET /agent/profile`.
//
// Cùng luật boundary với order-api.ts: JSON là `unknown`, field thiếu/sai kiểu → undefined (tool bỏ
// dòng đó), KHÔNG bịa mặc định. 404 → null (đại lý chưa có hồ sơ) — lỗi khác bubble lên để tool báo
// trục trặc thay vì báo "chưa xếp bậc".
//
// Đại lý KHÔNG đi qua query param: backend lấy từ header `x-dealer-id` (buildAgentHeaders).

import { AgentApiError, readEnvelopeData, readEnvelopeMeta, type AgentApiClient } from "./agent-api.ts";
import {
  asRecord,
  isPresent,
  numberAsString,
  readBoolean,
  readMoney,
  readNumber,
  readString,
} from "./read.ts";
import type {
  DealerPort,
  DealerProfile,
  OrderPrincipal,
  WalletDepositQr,
  WalletLedgerEntry,
  WalletLedgerPage,
} from "./types.ts";

const PROFILE_PATH = "/agent/profile";
const DEPOSIT_QR_PATH = "/agent/wallet/deposit-qr";
const WALLET_LEDGER_PATH = "/agent/wallet/ledger";

export class AgentApiDealerPort implements DealerPort {
  constructor(private readonly api: AgentApiClient) {}

  async profile(
    p: OrderPrincipal & { signal?: AbortSignal },
  ): Promise<DealerProfile | null> {
    let body: unknown;
    try {
      body = await this.api.get(PROFILE_PATH, {
        principal: { dealerId: p.dealerId, staffId: p.staffId },
        signal: p.signal,
      });
    } catch (err) {
      if (err instanceof AgentApiError && err.status === 404) return null;
      throw err;
    }

    const record = asRecord(readEnvelopeData(body, PROFILE_PATH));
    if (record === undefined) return null;
    return {
      code: readString(record, "code"),
      name: readString(record, "name"),
      phone: readString(record, "phone"),
      email: readString(record, "email"),
      address: readString(record, "address"),
      province: readString(record, "province"),
      district: readString(record, "district"),
      ward: readString(record, "ward"),
      joinedAt: readString(record, "joined_at"),
      referralLevel: readNumber(record, "referral_level"),
      isShareholder: readBoolean(record, "is_shareholder"),
      usesBrand: readBoolean(record, "uses_brand"),
      referrerCode: readString(record, "referrer_code"),
      referrerName: readString(record, "referrer_name"),
      staffName: readString(record, "staff_name"),
      staffPhone: readString(record, "staff_phone"),
      // id bigint: backend trả chuỗi, nhưng số cũng nhận — giữ nguyên chữ số, không tính gì lên nó.
      discountTierId: readString(record, "discount_tier_id") ?? numberAsString(record, "discount_tier_id"),
      discountTierName: readString(record, "discount_tier_name"),
      discountTierLabel: readString(record, "discount_tier_label"),
      // discount_rate_min/max backend có trả — CỐ Ý bỏ: tỉ lệ khác nhau theo từng sản phẩm nên một
      // biên min–max chỉ làm model chốt đại một con số % cho đại lý.
      discountEffectiveFrom: readString(record, "discount_effective_from"),
    };
  }

  async depositQr(
    p: OrderPrincipal & { amount?: number; signal?: AbortSignal },
  ): Promise<WalletDepositQr | null> {
    let body: unknown;
    try {
      body = await this.api.get(DEPOSIT_QR_PATH, {
        principal: { dealerId: p.dealerId, staffId: p.staffId },
        // amount undefined → client tự bỏ khỏi query (buildUrl), backend trả QR không đặt sẵn tiền.
        query: { amount: p.amount },
        signal: p.signal,
      });
    } catch (err) {
      if (err instanceof AgentApiError && err.status === 404) return null;
      throw err;
    }

    const record = asRecord(readEnvelopeData(body, DEPOSIT_QR_PATH));
    if (record === undefined) return null;
    return {
      // Khoá camelCase là CỐ Ý — backend trả `imageQRUrl`, không phải snake_case như phần còn lại.
      qrImageUrl: readString(record, "imageQRUrl"),
      transferContent: readString(record, "transfer_content"),
      bankName: readString(record, "bank_name"),
      accountNumber: readString(record, "account_number"),
      accountName: readString(record, "account_name"),
      amount: readMoney(record, "amount"),
    };
  }

  async walletLedger(
    p: OrderPrincipal & { page?: number; signal?: AbortSignal },
  ): Promise<WalletLedgerPage> {
    const body = await this.api.get(WALLET_LEDGER_PATH, {
      principal: { dealerId: p.dealerId, staffId: p.staffId },
      query: { page: p.page },
      signal: p.signal,
    });

    const data = readEnvelopeData(body, WALLET_LEDGER_PATH);
    const rows = Array.isArray(data) ? data : [];
    const meta = readEnvelopeMeta(body);
    return {
      entries: rows.map(toLedgerEntry).filter(isPresent),
      page: readNumber(meta, "page"),
      totalPages: readNumber(meta, "total_pages"),
      totalItems: readNumber(meta, "total_items"),
    };
  }
}

function toLedgerEntry(row: unknown): WalletLedgerEntry | undefined {
  const record = asRecord(row);
  if (record === undefined) return undefined;
  return {
    id: readString(record, "id") ?? numberAsString(record, "id"),
    type: readNumber(record, "type"),
    amount: readMoney(record, "amount"),
    balanceAfter: readMoney(record, "balance_after"),
    referenceType: readNumber(record, "reference_type"),
    referenceId: readString(record, "reference_id") ?? numberAsString(record, "reference_id"),
    description: readString(record, "description"),
    createdAt: readString(record, "created_at"),
  };
}
