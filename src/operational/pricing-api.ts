// pricing-api.ts — RetailPricingPort chạy thật trên `GET /products?search=` và
// `POST /pricing-vector/recommend`. Ngoài `/agent/*` nhưng vẫn chỉ service token (unscoped): backend
// cho principal service qua cả hai vì chúng `@SkipCheckAbility`. KHÔNG dùng dealer API key — key
// đó bị chặn 403 ngoài host api-dealer, và giá lẻ cũng không thuộc đại lý nào.
//
// `data: null` ở recommend KHÔNG phải lỗi: backend trả null khi không combo nào rẻ hơn giá lẻ hoặc
// có SKU chưa có giá lẻ → trả null nguyên cho tool nói "chưa tính được", không bịa giá.
//
// Danh sách sản phẩm backend trả cả giá vốn, bậc giá đại lý, tồn kho: CHỈ bóc sku/name/unit ở đây,
// thứ còn lại không đi quá lớp này.

import { AgentApiError, AgentApiErrorCode, readEnvelopeData, type AgentApiClient } from "./agent-api.ts";
import { asRecord, isPresent, readList, readNumber, readString } from "./read.ts";
import type {
  RetailCampaign,
  RetailCartLine,
  RetailPricingPort,
  RetailProduct,
  RetailQuote,
} from "./types.ts";

const PRODUCTS_PATH = "/products";
const RECOMMEND_PATH = "/pricing-vector/recommend";
/** Tên khách gõ thường khớp vài biến thể (lọ/hộp, combo) — đủ để model hỏi lại, không dội list dài. */
const SEARCH_PAGE_SIZE = 5;

export class AgentApiRetailPricingPort implements RetailPricingPort {
  constructor(private readonly api: AgentApiClient) {}

  async searchProducts(search: string, signal?: AbortSignal): Promise<readonly RetailProduct[]> {
    const body = await this.api.getUnscoped(PRODUCTS_PATH, {
      signal,
      query: { search, is_active: "true", page_size: SEARCH_PAGE_SIZE },
    });
    const data = readEnvelopeData(body, PRODUCTS_PATH);
    if (!Array.isArray(data)) throw invalidResponse(PRODUCTS_PATH, "data không phải mảng");
    return data.map(toProduct).filter(isPresent);
  }

  async recommend(
    items: readonly RetailCartLine[],
    signal?: AbortSignal,
  ): Promise<RetailQuote | null> {
    const body = await this.api.postUnscoped(RECOMMEND_PATH, {
      signal,
      body: { items: items.map((line) => ({ sku: line.sku, quantity: line.quantity })) },
    });
    const data = readEnvelopeData(body, RECOMMEND_PATH);
    if (data === null) return null;
    return toQuote(data);
  }
}

function toProduct(value: unknown): RetailProduct | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const sku = readString(record, "sku");
  const name = readString(record, "name");
  if (sku === undefined || name === undefined) return undefined;
  const unit = readString(record, "unit");
  return unit === undefined ? { sku, name } : { sku, name, unit };
}

/** Thiếu một trong ba con số chính = không đọc được giá → lỗi, KHÔNG báo giá nửa vời cho khách. */
function toQuote(value: unknown): RetailQuote {
  const record = asRecord(value);
  if (record === undefined) throw invalidResponse(RECOMMEND_PATH, "data không phải object");
  const optimal = readNumber(record, "optimal");
  const retailTotal = readNumber(record, "retailTotal");
  const savings = readNumber(record, "savings");
  if (optimal === undefined || retailTotal === undefined || savings === undefined) {
    throw invalidResponse(RECOMMEND_PATH, "thiếu optimal/retailTotal/savings");
  }
  const pricingEpoch = readNumber(record, "pricing_epoch");
  return {
    optimal,
    retailTotal,
    savings,
    campaigns: readList(record, "campaigns").map(toCampaign).filter(isPresent),
    ...(pricingEpoch === undefined ? {} : { pricingEpoch }),
  };
}

function toCampaign(value: unknown): RetailCampaign | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const label = readString(record, "label") ?? readString(record, "campaign");
  const price = readNumber(record, "price");
  const count = readNumber(record, "count");
  if (label === undefined || price === undefined || count === undefined) return undefined;
  const gifts = toGifts(record["gifts"]);
  return gifts === undefined ? { label, price, count } : { label, price, count, gifts };
}

function toGifts(value: unknown): Readonly<Record<string, number>> | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const gifts: Record<string, number> = {};
  for (const sku of Object.keys(record)) {
    const quantity = readNumber(record, sku);
    if (quantity !== undefined && quantity > 0) gifts[sku] = quantity;
  }
  return Object.keys(gifts).length === 0 ? undefined : gifts;
}

function invalidResponse(path: string, reason: string): AgentApiError {
  return new AgentApiError(`${path} trả response sai shape: ${reason}`, 200, AgentApiErrorCode.InvalidResponse, path);
}
