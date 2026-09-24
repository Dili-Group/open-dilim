// retail-pricing-tools.test.ts — `tra_gia_le` + AgentApiRetailPricingPort.
//
// Thứ cần chốt: tool KHÔNG tự chọn sản phẩm khi tên mơ hồ, KHÔNG báo giá khi backend trả null,
// giỏ gộp theo SKU trước khi gửi; port gọi bằng service token KHÔNG gắn đại lý và KHÔNG để
// giá vốn/bậc giá đại lý lọt ra khỏi lớp operational.

import { describe, expect, test } from "bun:test";
import type { Identity } from "../flash-command/types.ts";
import { AgentApiClient, AgentApiError, type FetchInit } from "../operational/agent-api.ts";
import { AgentApiRetailPricingPort } from "../operational/pricing-api.ts";
import type {
  RetailCartLine,
  RetailPricingPort,
  RetailProduct,
  RetailQuote,
} from "../operational/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import { buildRetailQuoteTool } from "./impl/tra-gia-le.ts";
import type { ToolContext } from "./types.ts";

const skills = await buildSkillRegistry();
const GUEST: Identity = { role: "guest", senderId: "psid-1" };

const SUN_KHOP: RetailProduct = { sku: "SCMNB", name: "Sụn khớp", unit: "hộp" };
const SUN_KHOP_PLUS: RetailProduct = { sku: "SCMNB-P", name: "Sụn khớp Plus", unit: "hộp" };
const QUOTE: RetailQuote = {
  optimal: 3_780_000,
  retailTotal: 4_200_000,
  savings: 420_000,
  campaigns: [{ label: "Sụn x2", price: 3_780_000, count: 1 }],
  pricingEpoch: 1,
};

class FakePricing implements RetailPricingPort {
  readonly recommended: (readonly RetailCartLine[])[] = [];
  constructor(
    private readonly catalog: Readonly<Record<string, readonly RetailProduct[]>>,
    private readonly quote: RetailQuote | null = QUOTE,
    private readonly fail?: Error,
  ) {}

  searchProducts(search: string): Promise<readonly RetailProduct[]> {
    if (this.fail !== undefined) return Promise.reject(this.fail);
    return Promise.resolve(this.catalog[search] ?? []);
  }

  recommend(items: readonly RetailCartLine[]): Promise<RetailQuote | null> {
    this.recommended.push(items);
    return Promise.resolve(this.quote);
  }
}

function ctxWith(retailPricing?: RetailPricingPort): ToolContext {
  return { skills, identity: GUEST, agentType: "sale-facebook", retailPricing };
}

describe("tra_gia_le", () => {
  test("tên khớp chính xác → báo giá khách trả, tiết kiệm, chương trình", async () => {
    const port = new FakePricing({ "sụn khớp": [SUN_KHOP, SUN_KHOP_PLUS] });
    const result = await buildRetailQuoteTool(ctxWith(port)).run({
      gio_hang: [{ san_pham: "sụn khớp", so_luong: 2 }],
    });

    expect(result.isError).toBeUndefined();
    expect(port.recommended).toEqual([[{ sku: "SCMNB", quantity: 2 }]]);
    expect(result.content).toContain("3.780.000 ₫");
    expect(result.content).toContain("tiết kiệm 420.000 ₫");
    expect(result.content).toContain("Sụn x2");
    expect(result.content).toContain("CHƯA gồm phí ship");
  });

  test("hai cách gọi cùng một sản phẩm → gộp một dòng SKU", async () => {
    const port = new FakePricing({ "sụn khớp": [SUN_KHOP], SCMNB: [SUN_KHOP] });
    await buildRetailQuoteTool(ctxWith(port)).run({
      gio_hang: [
        { san_pham: "sụn khớp", so_luong: 1 },
        { san_pham: "SCMNB", so_luong: 2 },
      ],
    });
    expect(port.recommended).toEqual([[{ sku: "SCMNB", quantity: 3 }]]);
  });

  test("tên khớp nhiều sản phẩm → hỏi lại khách, KHÔNG gọi báo giá", async () => {
    const port = new FakePricing({ sun: [SUN_KHOP, SUN_KHOP_PLUS] });
    const result = await buildRetailQuoteTool(ctxWith(port)).run({
      gio_hang: [{ san_pham: "sun", so_luong: 1 }],
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Sụn khớp Plus");
    expect(result.content).toContain("KHÔNG tự chọn hộ khách");
    expect(port.recommended).toHaveLength(0);
  });

  test("không tìm thấy sản phẩm → báo rõ, KHÔNG gọi báo giá", async () => {
    const port = new FakePricing({});
    const result = await buildRetailQuoteTool(ctxWith(port)).run({
      gio_hang: [{ san_pham: "thuốc lạ", so_luong: 1 }],
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("không tìm thấy");
    expect(port.recommended).toHaveLength(0);
  });

  test("backend trả null → không có con số nào, hẹn nhân viên báo giá", async () => {
    const port = new FakePricing({ "sụn khớp": [SUN_KHOP] }, null);
    const result = await buildRetailQuoteTool(ctxWith(port)).run({
      gio_hang: [{ san_pham: "sụn khớp", so_luong: 1 }],
    });
    expect(result.content).toContain("chưa tính được giá");
    expect(result.content).not.toMatch(/\d{3}\.\d{3}/);
  });

  test("quà tặng nhân theo số lần áp chương trình", async () => {
    const quote: RetailQuote = {
      ...QUOTE,
      campaigns: [{ label: "Sụn x3", price: 5_000_000, count: 2, gifts: { SCMNB: 1 } }],
    };
    const port = new FakePricing({ "sụn khớp": [SUN_KHOP] }, quote);
    const result = await buildRetailQuoteTool(ctxWith(port)).run({
      gio_hang: [{ san_pham: "sụn khớp", so_luong: 6 }],
    });
    expect(result.content).toContain("Sụn x3 ×2");
    expect(result.content).toContain("Quà tặng kèm: Sụn khớp ×2");
  });

  test("giỏ sai shape → lỗi nghiệp vụ, không gọi port", async () => {
    const port = new FakePricing({ "sụn khớp": [SUN_KHOP] });
    for (const input of [
      {},
      { gio_hang: [] },
      { gio_hang: [{ san_pham: "sụn khớp", so_luong: 0 }] },
      { gio_hang: [{ san_pham: "", so_luong: 1 }] },
    ]) {
      const result = await buildRetailQuoteTool(ctxWith(port)).run(input);
      expect(result.isError).toBe(true);
    }
    expect(port.recommended).toHaveLength(0);
  });

  test("chưa nối port / API lỗi → không đoán giá", async () => {
    const noPort = await buildRetailQuoteTool(ctxWith()).run({
      gio_hang: [{ san_pham: "sụn khớp", so_luong: 1 }],
    });
    expect(noPort.isError).toBe(true);
    expect(noPort.content).toContain("KHÔNG tự đoán giá");

    const broken = new FakePricing({}, QUOTE, new AgentApiError("x", 503, "HTTP_503", "/products"));
    const failed = await buildRetailQuoteTool(ctxWith(broken)).run({
      gio_hang: [{ san_pham: "sụn khớp", so_luong: 1 }],
    });
    expect(failed.isError).toBe(true);
    expect(failed.content).toContain("KHÔNG tự đoán giá");
  });
});

describe("AgentApiRetailPricingPort", () => {
  function clientReturning(body: unknown, calls: { url: string; init: FetchInit }[]): AgentApiClient {
    return new AgentApiClient({
      baseUrl: "https://api.test/api",
      serviceToken: "service-secret",
      fetchImpl: (url, init) => {
        calls.push({ url, init });
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
      },
    });
  }

  test("tìm sản phẩm: service token, không gắn đại lý; chỉ giữ sku/name/unit", async () => {
    const calls: { url: string; init: FetchInit }[] = [];
    const api = clientReturning(
      {
        success: true,
        data: [{ sku: "SCMNB", name: "Sụn khớp", unit: "hộp", default_cost_price: "900000", price_tiers: [{}] }],
      },
      calls,
    );
    const products = await new AgentApiRetailPricingPort(api).searchProducts("sụn khớp");

    expect(products).toEqual([{ sku: "SCMNB", name: "Sụn khớp", unit: "hộp" }]);
    const call = calls[0];
    expect(call?.url).toContain("https://api.test/api/products?");
    expect(call?.url).toContain("is_active=true");
    expect(call?.init.headers["x-service-token"]).toBe("service-secret");
    expect(call?.init.headers["x-dealer-id"]).toBeUndefined();
  });

  test("recommend: body đúng shape, bóc giá + chương trình", async () => {
    const calls: { url: string; init: FetchInit }[] = [];
    const api = clientReturning(
      {
        success: true,
        data: {
          optimal: 3_780_000,
          retailTotal: 4_200_000,
          savings: 420_000,
          campaigns: [{ campaign: "TH1_SCMNB", label: "Sụn x2", price: 3_780_000, count: 1 }],
          cart: { SCMNB: 2 },
          pricing_epoch: 1,
        },
      },
      calls,
    );
    const quote = await new AgentApiRetailPricingPort(api).recommend([{ sku: "SCMNB", quantity: 2 }]);

    expect(quote).toEqual(QUOTE);
    expect(calls[0]?.url).toBe("https://api.test/api/pricing-vector/recommend");
    expect(JSON.parse(calls[0]?.init.body ?? "")).toEqual({ items: [{ sku: "SCMNB", quantity: 2 }] });
  });

  test("recommend: data null → null, không phải lỗi", async () => {
    const api = clientReturning({ success: true, data: null }, []);
    expect(await new AgentApiRetailPricingPort(api).recommend([{ sku: "X", quantity: 1 }])).toBeNull();
  });
});
