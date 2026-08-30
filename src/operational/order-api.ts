// order-api.ts — OrderPort chạy thật trên API vận hành `/agent/*`.
//
// Việc của file này là BOUNDARY: JSON backend là `unknown`, mọi field đọc qua reader có kiểm kiểu.
// Field thiếu/sai kiểu → undefined (tool sẽ bỏ dòng đó khi render) chứ KHÔNG bịa giá trị mặc định —
// model thấy "0đ" sẽ nói "không phải trả gì", thấy dòng vắng thì hỏi lại.
//
// 404 (ORDER_NOT_FOUND) → null/[] : đó là câu trả lời hợp lệ ("đại lý này không có đơn đó"), không
// phải sự cố. Mọi lỗi khác bubble lên để tool báo trục trặc thay vì báo "không có đơn".

import {
  AgentApiError,
  AgentApiErrorCode,
  readEnvelopeData,
  readEnvelopeMeta,
  type AgentApiClient,
  type AgentApiPrincipal,
} from "./agent-api.ts";
import {
  asRecord,
  isPresent,
  numberAsString,
  readBoolean,
  readList,
  readMoney,
  readNumber,
  readString,
} from "./read.ts";
import type {
  CodCheckPart,
  CodCheckResult,
  CodCheckVerdict,
  CodCheckVia,
  OrderCameraLink,
  OrderDetail,
  OrderItem,
  OrderPayment,
  OrderPaymentBank,
  OrderPaymentItem,
  OrderPort,
  OrderPrincipal,
  OrderSearchPage,
  OrderSummary,
  OrderTransition,
  PaymentBatch,
} from "./types.ts";

const ORDERS_PATH = "/agent/orders";
const COD_CHECK_PATH = "/agent/orders/cod-check";
const PAYMENT_BATCHES_PATH = "/agent/payment-batches";
/** Trần backend cho page_size. Xin quá số này backend từ chối. */
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 20;

export class AgentApiOrderPort implements OrderPort {
  constructor(private readonly api: AgentApiClient) {}

  async search(
    p: OrderPrincipal & {
      search?: string;
      status?: number;
      today?: boolean;
      createdFrom?: string;
      createdTo?: string;
      pageSize?: number;
      signal?: AbortSignal;
    },
  ): Promise<OrderSearchPage> {
    const pageSize = Math.min(Math.max(1, p.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const body = await this.api.get(ORDERS_PATH, {
      principal: toPrincipal(p),
      query: {
        search: p.search,
        status: p.status,
        // Backend đọc cờ dạng chuỗi "true"; false = không gửi param (gửi "false" backend vẫn coi là
        // có mặt ở vài route), để `created_from`/`created_to` tự quyết định.
        today: p.today === true ? "true" : undefined,
        created_from: p.createdFrom,
        created_to: p.createdTo,
        page: 1,
        page_size: pageSize,
      },
      signal: p.signal,
    });

    const data = readEnvelopeData(body, ORDERS_PATH);
    if (!Array.isArray(data)) {
      throw new AgentApiError(
        `GET ${ORDERS_PATH} trả "data" không phải mảng`,
        200,
        AgentApiErrorCode.InvalidResponse,
        ORDERS_PATH,
      );
    }
    const orders = data.map(readSummary).filter(isPresent);
    const total = readNumber(readEnvelopeMeta(body), "total") ?? orders.length;
    return { orders, total };
  }

  async detail(
    p: OrderPrincipal & { trackingNumber: string; signal?: AbortSignal },
  ): Promise<OrderDetail | null> {
    const path = `${ORDERS_PATH}/${encodeURIComponent(p.trackingNumber)}`;
    const body = await this.notFoundToNull(path, p);
    if (body === null) return null;

    const data = readEnvelopeData(body, path);
    const summary = readSummary(data);
    if (summary === undefined) {
      throw new AgentApiError(
        `GET ${path} trả đơn thiếu tracking_number`,
        200,
        AgentApiErrorCode.InvalidResponse,
        path,
      );
    }
    const record = asRecord(data) ?? {};
    return {
      ...summary,
      source: readString(record, "source"),
      shippingAddress: readString(record, "shipping_address"),
      province: readString(record, "province"),
      district: readString(record, "district"),
      ward: readString(record, "ward"),
      subtotal: readMoney(record, "subtotal"),
      discount: readMoney(record, "discount"),
      notes: readString(record, "notes"),
      staffName: readString(record, "staff_name"),
      transitions: readList(record, "transitions").map(readTransition),
    };
  }

  async payment(
    p: OrderPrincipal & { trackingNumber: string; signal?: AbortSignal },
  ): Promise<OrderPayment | null> {
    const path = `${ORDERS_PATH}/${encodeURIComponent(p.trackingNumber)}/payment`;
    const body = await this.notFoundToNull(path, p);
    if (body === null) return null;

    const record = asRecord(readEnvelopeData(body, path));
    // Không có `amount` thì cả câu trả lời vô nghĩa (đại lý hỏi đúng con số này) → lỗi shape, để tool
    // báo trục trặc, KHÔNG in một khối chuyển khoản thiếu số tiền.
    const amount = record === undefined ? undefined : readMoney(record, "amount");
    if (record === undefined || amount === undefined) {
      throw new AgentApiError(
        `GET ${path} trả thiếu "amount"`,
        200,
        AgentApiErrorCode.InvalidResponse,
        path,
      );
    }
    return {
      trackingNumber: readString(record, "tracking_number") ?? p.trackingNumber,
      amount,
      baseAmount: readMoney(record, "base_amount"),
      packagingFee: readMoney(record, "packaging_fee"),
      dealerCode: readString(record, "dealer_code"),
      dealerName: readString(record, "dealer_name"),
      carrier: readNumber(record, "carrier"),
      items: readList(record, "items").map(readPaymentItem).filter(isPresent),
      bank: readBank(record),
      transferContent: readString(record, "transfer_content"),
      qrUrl: readString(record, "qr_url"),
    };
  }

  async createPaymentBatch(
    p: OrderPrincipal & { trackingNumbers: readonly string[]; signal?: AbortSignal },
  ): Promise<PaymentBatch | null> {
    let body: unknown;
    try {
      body = await this.api.post(PAYMENT_BATCHES_PATH, {
        principal: toPrincipal(p),
        body: { tracking_numbers: p.trackingNumbers },
        signal: p.signal,
      });
    } catch (err) {
      // 404 = có mã không tồn tại HOẶC không thuộc đại lý này (backend cố ý gộp, chống dò mã)
      // → phiếu chưa tạo, là câu trả lời hợp lệ chứ không phải sự cố.
      if (err instanceof AgentApiError && err.status === 404) return null;
      throw err;
    }

    const record = asRecord(readEnvelopeData(body, PAYMENT_BATCHES_PATH));
    // Ba field này là BẰNG CHỨNG phiếu đã tạo + thứ đại lý PHẢI chuyển đúng. Thiếu chúng thì
    // không dựng nổi hướng dẫn chuyển khoản an toàn → lỗi shape, KHÔNG báo thành công nửa vời.
    const code = record === undefined ? undefined : readString(record, "code");
    const transferContent = record === undefined ? undefined : readString(record, "transfer_content");
    const totalAmount = record === undefined ? undefined : readMoney(record, "total_amount");
    if (record === undefined || code === undefined || transferContent === undefined || totalAmount === undefined) {
      throw new AgentApiError(
        `POST ${PAYMENT_BATCHES_PATH} trả response thiếu code/transfer_content/total_amount`,
        200,
        AgentApiErrorCode.InvalidResponse,
        PAYMENT_BATCHES_PATH,
      );
    }

    return {
      code,
      transferContent,
      totalAmount,
      paidAmount: readMoney(record, "paid_amount"),
      qrUrl: readString(record, "qr_url"),
      uuid: readString(record, "uuid"),
      status: readNumber(record, "status"),
      orderIds: readList(record, "order_ids")
        .map((id) => (typeof id === "string" ? id : typeof id === "number" ? String(id) : undefined))
        .filter(isPresent),
      orderCount: readNumber(record, "order_count"),
      createdAt: readString(record, "created_at"),
      bank: readBank(record),
    };
  }

  async cameraLinks(
    p: OrderPrincipal & { trackingNumber: string; signal?: AbortSignal },
  ): Promise<readonly OrderCameraLink[]> {
    const path = `${ORDERS_PATH}/${encodeURIComponent(p.trackingNumber)}/camera-links`;
    const body = await this.notFoundToNull(path, p);
    if (body === null) return [];

    const data = readEnvelopeData(body, path);
    if (!Array.isArray(data)) return [];
    return data.map(readCameraLink).filter(isPresent);
  }

  async codCheck(
    p: OrderPrincipal & {
      trackingNumber?: string;
      items?: Readonly<Record<string, number>>;
      cod?: number;
      signal?: AbortSignal;
    },
  ): Promise<CodCheckResult | null> {
    // Luật backend: có tracking_number thì items/cod bị bỏ qua → đừng gửi kèm cho đỡ nhiễu.
    const payload =
      p.trackingNumber !== undefined
        ? { tracking_number: p.trackingNumber }
        : { items: p.items, cod: p.cod };
    let body: unknown;
    try {
      body = await this.api.post(COD_CHECK_PATH, {
        principal: toPrincipal(p),
        body: payload,
        signal: p.signal,
      });
    } catch (err) {
      // 404 ORDER_NOT_FOUND: mã không tồn tại / đơn xoá mềm — câu trả lời hợp lệ, không phải sự cố.
      if (err instanceof AgentApiError && err.status === 404) return null;
      throw err;
    }

    const record = asRecord(readEnvelopeData(body, COD_CHECK_PATH));
    const cod = record === undefined ? undefined : readNumber(record, "cod");
    const verdict = record === undefined ? undefined : readVerdict(record["verdict"]);
    // Thiếu cod hoặc verdict.status thì không có gì để kết luận → lỗi shape, tool báo trục trặc
    // thay vì dựng một kết luận nửa vời.
    if (record === undefined || cod === undefined || verdict === undefined) {
      throw new AgentApiError(
        `POST ${COD_CHECK_PATH} trả response thiếu cod/verdict.status`,
        200,
        AgentApiErrorCode.InvalidResponse,
        COD_CHECK_PATH,
      );
    }

    const order = asRecord(record["order"]);
    return {
      input: readString(record, "input"),
      cod,
      risk: readString(record, "risk"),
      verdict,
      cart: readSkuCounts(record["cart"]),
      giftItems: readSkuCounts(record["gift_items"]),
      paidItems: readSkuCounts(record["paid_items"]),
      pricingEpoch: readNumber(record, "pricing_epoch"),
      orderCodAmount: order === undefined ? undefined : readMoney(order, "cod_amount"),
      hypotheses: readList(record, "hypotheses")
        .map((h) => (typeof h === "string" && h.trim() !== "" ? h : undefined))
        .filter(isPresent),
    };
  }

  /** 404 = đơn không thuộc đại lý này → null. Lỗi khác bubble (tool phân biệt "không có" vs "hỏng"). */
  private async notFoundToNull(
    path: string,
    p: OrderPrincipal & { signal?: AbortSignal },
  ): Promise<unknown> {
    try {
      return await this.api.get(path, { principal: toPrincipal(p), signal: p.signal });
    } catch (err) {
      if (err instanceof AgentApiError && err.status === 404) return null;
      throw err;
    }
  }
}

function toPrincipal(p: OrderPrincipal): AgentApiPrincipal {
  return { dealerId: p.dealerId, staffId: p.staffId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reader domain đơn hàng. Reader chung (asRecord, readString...) nằm ở read.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Đơn KHÔNG có tracking_number là đơn không tra lại được → bỏ, đừng đưa cho model một mã rỗng. */
function readSummary(value: unknown): OrderSummary | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const trackingNumber = readString(record, "tracking_number");
  if (trackingNumber === undefined) return undefined;

  const items = readList(record, "items").map(readItem).filter(isPresent);
  return {
    trackingNumber,
    status: readNumber(record, "status"),
    carrier: readNumber(record, "carrier"),
    totalAmount: readMoney(record, "total_amount"),
    codAmount: readMoney(record, "cod_amount"),
    shippingFee: readMoney(record, "shipping_fee"),
    customerName: readString(record, "customer_name"),
    customerPhone: readString(record, "customer_phone"),
    isNewCustomer: readBoolean(record, "is_new_customer"),
    createdAt: readString(record, "created_at"),
    updatedAt: readString(record, "updated_at"),
    items: items.length === 0 ? undefined : items,
  };
}

function readItem(value: unknown): OrderItem | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const name = readString(record, "item_name");
  if (name === undefined) return undefined;
  return {
    name,
    sku: readString(record, "sku") ?? "",
    quantity: readNumber(record, "quantity") ?? 0,
    unitPrice: readMoney(record, "unit_price") ?? "",
    lineTotal: readMoney(record, "line_total") ?? "",
  };
}

/** Dòng không có `order_item_id` thì không đối chiếu được với gì → bỏ. */
function readPaymentItem(value: unknown): OrderPaymentItem | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const orderItemId = readString(record, "order_item_id") ?? numberAsString(record, "order_item_id");
  if (orderItemId === undefined) return undefined;
  return {
    orderItemId,
    unitPrice: readMoney(record, "dealer_unit_price"),
    lineTotal: readMoney(record, "dealer_line_total"),
  };
}

/** Không field nào đọc được → undefined để tool bỏ hẳn khối chuyển khoản, không in nửa vời. */
function readBank(record: Record<string, unknown>): OrderPaymentBank | undefined {
  const bank = asRecord(record["bank"]);
  if (bank === undefined) return undefined;
  const result: OrderPaymentBank = {
    bankCode: readString(bank, "bank_code"),
    bankName: readString(bank, "bank_name"),
    accountNumber: readString(bank, "account_number"),
    accountName: readString(bank, "account_name"),
  };
  return Object.values(result).every((value) => value === undefined) ? undefined : result;
}

function readTransition(value: unknown): OrderTransition {
  const record = asRecord(value) ?? {};
  return {
    event: readString(record, "event"),
    fromState: readNumber(record, "from_state"),
    toState: readNumber(record, "to_state"),
    actorName: readString(record, "actor_name"),
    reason: readString(record, "reason"),
    createdAt: readString(record, "created_at"),
  };
}

/** Map SKU → số lượng. Không phải object, hay có value không phải số → undefined/bỏ entry. */
function readSkuCounts(value: unknown): Readonly<Record<string, number>> | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const counts: Record<string, number> = {};
  for (const [sku, qty] of Object.entries(record)) {
    if (typeof qty === "number" && Number.isFinite(qty)) counts[sku] = qty;
  }
  return counts;
}

/** Thiếu `status` = không có kết luận → undefined để codCheck() coi là lỗi shape. */
function readVerdict(value: unknown): CodCheckVerdict | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const status = readString(record, "status");
  if (status === undefined) return undefined;
  return {
    status,
    optimal: readNumber(record, "optimal"),
    overpay: readNumber(record, "overpay"),
    nearest: readList(record, "nearest")
      .map((n) => (typeof n === "number" && Number.isFinite(n) ? n : undefined))
      .filter(isPresent),
    validCount: readNumber(record, "validCount"),
    via: readVia(record["via"]),
    optimalVia: readVia(record["optimalVia"]),
  };
}

function readVia(value: unknown): CodCheckVia | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const remainder = asRecord(record["retailRemainder"]);
  return {
    group: readString(record, "group"),
    parts: readList(record, "parts").map(readPart).filter(isPresent),
    retailRemainderAmount:
      remainder === undefined ? undefined : readNumber(remainder, "amount"),
  };
}

/** Phần không có cả label lẫn price thì không kể được gì cho người nghe → bỏ. */
function readPart(value: unknown): CodCheckPart | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const label = readString(record, "label");
  const price = readNumber(record, "price");
  if (label === undefined && price === undefined) return undefined;
  return {
    label,
    price,
    items: readSkuCounts(record["items"]),
    gifts: readSkuCounts(record["gifts"]),
  };
}

/** Không có `url` thì cái link đó vô dụng với đại lý → bỏ. */
function readCameraLink(value: unknown): OrderCameraLink | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const url = readString(record, "url");
  if (url === undefined) return undefined;
  return {
    url,
    sessionCode: readString(record, "session_code"),
    sessionType: readNumber(record, "session_type"),
    scannedAt: readString(record, "scanned_at"),
    cameraCount: readNumber(record, "camera_count"),
    expiresAt: readString(record, "expires_at"),
  };
}
