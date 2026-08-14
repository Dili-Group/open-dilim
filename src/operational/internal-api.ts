// internal-api.ts — InternalOrdersPort chạy thật trên ba endpoint `GET /agent/internal/daily/*`.
//
// Cùng luật boundary với daily-api.ts: JSON là `unknown`, field thiếu/sai kiểu → undefined (tool bỏ
// ô đó khi render), KHÔNG bịa mặc định. Envelope cũng dùng `meta_data` như cụm sổ ngày đại lý.
//
// KHÁC cụm đại lý ở phần định danh: đi qua `getAsStaff` — không có `x-dealer-id`, nên dữ liệu là
// đơn của MỌI đại lý và `x-staff-id` là bắt buộc.

import {
  AgentApiError,
  AgentApiErrorCode,
  readEnvelopeData,
  readEnvelopeMeta,
  type AgentApiClient,
} from "./agent-api.ts";
import { asRecord, isPresent, readBoolean, readList, readNumber, readString } from "./read.ts";
import type {
  InternalDailyMeta,
  InternalDailyPage,
  InternalDailyQuery,
  InternalOrderLine,
  InternalOrdersPort,
  InternalValidateExcludedLine,
  InternalValidateRejectedLine,
  InternalValidateRequest,
  InternalValidateResult,
} from "./types.ts";

const SHIPPED_PATH = "/agent/internal/daily/shipped-orders";
const INVOICED_PATH = "/agent/internal/daily/invoiced-orders";
const UNINVOICED_PATH = "/agent/internal/daily/uninvoiced-orders";
const VALIDATE_PATH = "/agent/internal/orders/validate";

/** Khối tổng của envelope. `/agent/orders` dùng `meta`, cụm sổ ngày dùng `meta_data`. */
const META_KEY = "meta_data";

/** Trần backend cho page_size. Xin quá số này backend từ chối. */
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 20;

export class AgentApiInternalOrdersPort implements InternalOrdersPort {
  constructor(private readonly api: AgentApiClient) {}

  shippedOrders(q: InternalDailyQuery): Promise<InternalDailyPage> {
    return this.fetchPage(SHIPPED_PATH, q);
  }

  invoicedOrders(q: InternalDailyQuery): Promise<InternalDailyPage> {
    return this.fetchPage(INVOICED_PATH, q);
  }

  uninvoicedOrders(q: InternalDailyQuery): Promise<InternalDailyPage> {
    return this.fetchPage(UNINVOICED_PATH, q);
  }

  /**
   * GHI: validate lô đơn qua bước kho. Đi qua `postAsStaff` — không retry (client tự chặn:
   * lệnh ghi bắn lại là ghi hai lần), lỗi để bubble cho tool phân loại và báo người dùng.
   */
  async validateOrders(r: InternalValidateRequest): Promise<InternalValidateResult> {
    const body = await this.api.postAsStaff(VALIDATE_PATH, {
      staffId: r.staffId,
      body: { tracking_numbers: r.trackingNumbers },
      signal: r.signal,
    });

    const data = asRecord(readEnvelopeData(body, VALIDATE_PATH));
    if (data === undefined) {
      throw new AgentApiError(
        `POST ${VALIDATE_PATH} trả "data" không phải object`,
        200,
        AgentApiErrorCode.InvalidResponse,
        VALIDATE_PATH,
      );
    }
    return {
      validated: readNumber(data, "validated"),
      alreadyValidated: readNumber(data, "already_validated"),
      rejected: readList(data, "rejected").map(readRejectedLine).filter(isPresent),
      notFound: readList(data, "not_found")
        .filter(isNonEmptyString)
        .map((code) => code.trim()),
      excluded: readList(data, "excluded").map(readExcludedLine).filter(isPresent),
    };
  }

  private async fetchPage(path: string, q: InternalDailyQuery): Promise<InternalDailyPage> {
    const pageSize = Math.min(Math.max(1, q.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const body = await this.api.getAsStaff(path, {
      staffId: q.staffId,
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
    return {
      meta: readMeta(readEnvelopeMeta(body, META_KEY)),
      lines: data.map(readOrderLine).filter(isPresent),
    };
  }
}

function readMeta(record: Record<string, unknown>): InternalDailyMeta {
  return {
    date: readString(record, "date"),
    // `invoiced: null` (endpoint shipped-orders) → undefined: "không lọc", không phải "chưa hoá đơn".
    invoiced: readBoolean(record, "invoiced"),
    page: readNumber(record, "page"),
    pageSize: readNumber(record, "page_size"),
    totalItems: readNumber(record, "total_items"),
    totalPages: readNumber(record, "total_pages"),
  };
}

/** Dòng từ chối/loại KHÔNG có mã vận đơn thì không báo lại được cho ai → bỏ, đừng in mã rỗng. */
function readRejectedLine(value: unknown): InternalValidateRejectedLine | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const trackingNumber = readString(record, "tracking_number");
  if (trackingNumber === undefined) return undefined;
  return { trackingNumber, status: readNumber(record, "status") };
}

function readExcludedLine(value: unknown): InternalValidateExcludedLine | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const trackingNumber = readString(record, "tracking_number");
  if (trackingNumber === undefined) return undefined;
  return { trackingNumber, reason: readString(record, "reason") };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Dòng KHÔNG có mã vận đơn thì không đối chiếu được với sổ nào → bỏ, đừng in một mã rỗng. */
function readOrderLine(value: unknown): InternalOrderLine | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const trackingNumber = readString(record, "tracking_number");
  if (trackingNumber === undefined) return undefined;
  return {
    trackingNumber,
    dealerCode: readString(record, "dealer_code"),
    dealerName: readString(record, "dealer_name"),
    shippedAt: readString(record, "shipped_at"),
    voucherCode: readString(record, "voucher_code"),
    misaVoucherId: readString(record, "misa_voucher_id"),
    misaSyncAt: readString(record, "misa_sync_at"),
    invoiced: readBoolean(record, "invoiced"),
  };
}
