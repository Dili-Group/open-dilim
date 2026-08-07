// daily-api.ts — DailyPort chạy thật trên bốn endpoint `GET /agent/daily/*`.
//
// Cùng luật boundary với order-api.ts: JSON là `unknown`, field thiếu/sai kiểu → undefined (tool bỏ
// dòng đó khi render), KHÔNG bịa mặc định. Tiền giữ NGUYÊN CHUỖI — không parseFloat, không làm tròn.
//
// Envelope của cụm này dùng `meta_data` (không phải `meta` như `/agent/orders`) — khác biệt đó chốt
// ở MỘT chỗ: hằng META_KEY.
//
// Đại lý KHÔNG đi qua query param: backend lấy từ header `x-dealer-id` (buildAgentHeaders).

import {
  AgentApiError,
  AgentApiErrorCode,
  readEnvelopeData,
  readEnvelopeMeta,
  type AgentApiClient,
} from "./agent-api.ts";
import { asRecord, isPresent, readBoolean, readList, readMoney, readNumber, readString } from "./read.ts";
import type {
  DailyChargeLine,
  DailyLine,
  DailyMeta,
  DailyOrderItem,
  DailyOrderLine,
  DailyPage,
  DailyPort,
  DailyQuery,
  DailyRefundLine,
} from "./types.ts";

const SHIPPED_PATH = "/agent/daily/shipped-orders";
const RETURNED_PATH = "/agent/daily/returned-orders";
const CHARGES_PATH = "/agent/daily/charges";
const REFUNDS_PATH = "/agent/daily/refunds";

/** Khối tổng của envelope sổ ngày. `/agent/orders` dùng `meta`, cụm này dùng `meta_data`. */
const META_KEY = "meta_data";

/** Trần backend cho page_size. Xin quá số này backend từ chối. */
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 20;

export class AgentApiDailyPort implements DailyPort {
  constructor(private readonly api: AgentApiClient) {}

  shippedOrders(q: DailyQuery): Promise<DailyPage<DailyOrderLine>> {
    return this.fetchPage(SHIPPED_PATH, q, readOrderLine);
  }

  returnedOrders(q: DailyQuery): Promise<DailyPage<DailyOrderLine>> {
    return this.fetchPage(RETURNED_PATH, q, readOrderLine);
  }

  charges(q: DailyQuery): Promise<DailyPage<DailyChargeLine>> {
    return this.fetchPage(CHARGES_PATH, q, readChargeLine);
  }

  refunds(q: DailyQuery): Promise<DailyPage<DailyRefundLine>> {
    return this.fetchPage(REFUNDS_PATH, q, readRefundLine);
  }

  private async fetchPage<Line extends DailyLine>(
    path: string,
    q: DailyQuery,
    readLine: (value: unknown) => Line | undefined,
  ): Promise<DailyPage<Line>> {
    const pageSize = Math.min(Math.max(1, q.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const body = await this.api.get(path, {
      principal: { dealerId: q.dealerId, staffId: q.staffId },
      query: { date: q.date, page: Math.max(1, q.page ?? 1), page_size: pageSize },
      signal: q.signal,
    });

    const data = readEnvelopeData(body, path);
    if (!Array.isArray(data)) {
      throw new AgentApiError(
        `GET ${path} trả "data" không phải mảng`,
        200,
        AgentApiErrorCode.InvalidResponse,
        path,
      );
    }
    return { meta: readMeta(readEnvelopeMeta(body, META_KEY)), lines: data.map(readLine).filter(isPresent) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reader domain sổ ngày. Reader chung (asRecord, readMoney...) nằm ở read.ts.
// ─────────────────────────────────────────────────────────────────────────────

function readMeta(record: Record<string, unknown>): DailyMeta {
  return {
    date: readString(record, "date"),
    dealerCode: readString(record, "dealer_code"),
    page: readNumber(record, "page"),
    pageSize: readNumber(record, "page_size"),
    totalItems: readNumber(record, "total_items"),
    totalPages: readNumber(record, "total_pages"),
    totalQuantity: readNumber(record, "total_quantity"),
    totalAmount: readMoney(record, "total_amount"),
    goodsAmount: readMoney(record, "goods_amount"),
    cartonFee: readMoney(record, "carton_fee"),
  };
}

/** Dòng KHÔNG có mã vận đơn thì đại lý không đối chiếu được với sổ → bỏ, đừng in một mã rỗng. */
function readOrderLine(value: unknown): DailyOrderLine | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const trackingNumber = readString(record, "tracking_number");
  if (trackingNumber === undefined) return undefined;
  return {
    trackingNumber,
    createdAt: readString(record, "created_at"),
    at: readString(record, "at"),
    quantity: readNumber(record, "quantity"),
    goodsAmount: readMoney(record, "goods_amount"),
    items: readList(record, "items").map(readOrderItem).filter(isPresent),
  };
}

/** Dòng hàng không có tên lẫn SKU thì không nói được là hàng gì → bỏ. */
function readOrderItem(value: unknown): DailyOrderItem | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const sku = readString(record, "sku");
  const productName = readString(record, "product_name");
  if (sku === undefined && productName === undefined) return undefined;
  return {
    sku,
    productName,
    quantity: readNumber(record, "quantity"),
    isGift: readBoolean(record, "is_gift"),
    lineAmount: readMoney(record, "line_amount"),
  };
}

function readChargeLine(value: unknown): DailyChargeLine | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const trackingNumber = readString(record, "tracking_number");
  if (trackingNumber === undefined) return undefined;
  return {
    trackingNumber,
    shippedAt: readString(record, "shipped_at"),
    quantity: readNumber(record, "quantity"),
    goodsAmount: readMoney(record, "goods_amount"),
    cartonFee: readMoney(record, "carton_fee"),
    amount: readMoney(record, "amount"),
  };
}

function readRefundLine(value: unknown): DailyRefundLine | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const trackingNumber = readString(record, "tracking_number");
  if (trackingNumber === undefined) return undefined;
  return {
    trackingNumber,
    returnedAt: readString(record, "returned_at"),
    quantity: readNumber(record, "quantity"),
    amount: readMoney(record, "amount"),
  };
}
