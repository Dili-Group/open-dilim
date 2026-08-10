// Test `nap_poscake` trên PoscakePort GIẢ (không mạng). Bốn thứ phải chốt:
//   1. API Key KHÔNG rò: không nằm trong kết quả trả về LLM, kể cả khi backend lỗi.
//   2. Guest gõ → isError, và port KHÔNG bị gọi (nạp credential phải có người chịu trách nhiệm).
//   3. Phạm vi: dealerId đi vào port là đại lý của PHÒNG; nhân viên gõ thì kèm staffId.
//   4. Input model untrusted: shop id không phải dãy số / key có khoảng trắng → isError, không lên mạng.

import { describe, expect, test } from "bun:test";
import type { Identity } from "../flash-command/types.ts";
import { AgentApiError, AgentApiErrorCode } from "../operational/agent-api.ts";
import type { OrderPrincipal, PoscakePort, PoscakeShopLink } from "../operational/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import { buildPoscakeRegisterTool } from "./impl/dealer/poscake.ts";
import type { ToolContext } from "./types.ts";

const GUEST: Identity = { role: "guest", senderId: "u1" };
const DEALER: Identity = { role: "dai_ly", senderId: "u2", customerId: "dealer-9" };
const STAFF: Identity = { role: "nhan_vien", senderId: "u3", userId: "77" };

const SHOP_ID = "1234567";
const API_KEY = "pk-live-abcdefghijklmnop";

const skills: SkillRegistry = await buildSkillRegistry();

class FakePoscake implements PoscakePort {
  readonly calls: (OrderPrincipal & { shopId: string; apiKey: string })[] = [];
  constructor(private readonly error?: AgentApiError) {}

  register(
    p: OrderPrincipal & { shopId: string; apiKey: string; signal?: AbortSignal },
  ): Promise<PoscakeShopLink> {
    this.calls.push({
      dealerId: p.dealerId,
      staffId: p.staffId,
      shopId: p.shopId,
      apiKey: p.apiKey,
    });
    if (this.error !== undefined) return Promise.reject(this.error);
    return Promise.resolve({ shopId: p.shopId, dealerCode: "DL001" });
  }
}

function contextOf(p: { identity: Identity; poscake?: PoscakePort }): ToolContext {
  return { skills, identity: p.identity, roomCustomerId: "dealer-9", poscake: p.poscake };
}

describe("nap_poscake", () => {
  test("đại lý gõ đủ shop id + key → gọi port, kết quả KHÔNG chứa key", async () => {
    const poscake = new FakePoscake();
    const tool = buildPoscakeRegisterTool(contextOf({ identity: DEALER, poscake }));

    const result = await tool.run({ shop_id: SHOP_ID, api_key: API_KEY });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("ĐÃ NẠP");
    expect(result.content).toContain(SHOP_ID);
    expect(result.content).toContain("DL001");
    // Key là bí mật: đi một chiều lên backend, không quay lại ngữ cảnh model.
    expect(result.content).not.toContain(API_KEY);
    // Webhook URL vẫn là việc của đại lý — tool không được để model tưởng đã xong hết.
    expect(result.content).toContain("Webhook URL");
    expect(poscake.calls).toEqual([
      { dealerId: "dealer-9", staffId: undefined, shopId: SHOP_ID, apiKey: API_KEY },
    ]);
  });

  test("nhân viên gõ hộ → kèm staffId để backend audit", async () => {
    const poscake = new FakePoscake();
    const tool = buildPoscakeRegisterTool(contextOf({ identity: STAFF, poscake }));

    const result = await tool.run({ shop_id: SHOP_ID, api_key: API_KEY });

    expect(result.isError).toBeUndefined();
    expect(poscake.calls[0]?.staffId).toBe("77");
    expect(poscake.calls[0]?.dealerId).toBe("dealer-9");
  });

  test("guest gõ → từ chối, port KHÔNG bị gọi", async () => {
    const poscake = new FakePoscake();
    const tool = buildPoscakeRegisterTool(contextOf({ identity: GUEST, poscake }));

    const result = await tool.run({ shop_id: SHOP_ID, api_key: API_KEY });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("chưa được định danh");
    expect(poscake.calls).toEqual([]);
  });

  test("shop id không phải dãy số / key có khoảng trắng → isError, không lên mạng", async () => {
    const poscake = new FakePoscake();
    const tool = buildPoscakeRegisterTool(contextOf({ identity: DEALER, poscake }));

    const badShop = await tool.run({
      shop_id: "https://pos.pages.fm/shop/1234567/orders",
      api_key: API_KEY,
    });
    expect(badShop.isError).toBe(true);
    expect(badShop.content).toContain("shop_id");

    const badKey = await tool.run({ shop_id: SHOP_ID, api_key: "key vua tao xong" });
    expect(badKey.isError).toBe(true);
    expect(badKey.content).toContain("api_key");

    const missing = await tool.run({ shop_id: SHOP_ID });
    expect(missing.isError).toBe(true);

    expect(poscake.calls).toEqual([]);
  });

  test("chưa nối cổng → lỗi nghiệp vụ, không throw ra agent loop", async () => {
    const tool = buildPoscakeRegisterTool(contextOf({ identity: DEALER }));

    const result = await tool.run({ shop_id: SHOP_ID, api_key: API_KEY });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("chưa sẵn sàng");
  });

  test("backend từ chối (4xx) → báo chưa nạp được, KHÔNG lộ key trong lỗi", async () => {
    const poscake = new FakePoscake(
      new AgentApiError(
        `POST /agent/poscake-shop trả 422 (POSCAKE_KEY_INVALID): api_key ${API_KEY} không hợp lệ`,
        422,
        "POSCAKE_KEY_INVALID",
        "/agent/poscake-shop",
      ),
    );
    const tool = buildPoscakeRegisterTool(contextOf({ identity: DEALER, poscake }));

    const result = await tool.run({ shop_id: SHOP_ID, api_key: API_KEY });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("TỪ CHỐI");
    expect(result.content).toContain("POSCAKE_KEY_INVALID");
    // Message của backend có thể lặp lại chính thứ vừa gửi lên — tool chỉ in mã lỗi.
    expect(result.content).not.toContain(API_KEY);
  });

  test("backend không phản hồi (5xx) → nói CHƯA CHẮC, không giục gửi lại key", async () => {
    const poscake = new FakePoscake(
      new AgentApiError(
        "POST /agent/poscake-shop thất bại (timeout sau 10000ms)",
        0,
        AgentApiErrorCode.Transport,
        "/agent/poscake-shop",
      ),
    );
    const tool = buildPoscakeRegisterTool(contextOf({ identity: DEALER, poscake }));

    const result = await tool.run({ shop_id: SHOP_ID, api_key: API_KEY });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("CHƯA CHẮC");
    expect(result.content).not.toContain(API_KEY);
  });
});
