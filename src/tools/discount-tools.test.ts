// Test hai tool bậc chiết khấu trên DiscountPort/DealerPort GIẢ (không mạng). Năm thứ phải chốt:
//   1. Chỉ NHÂN VIÊN ghi được. Đại lý/guest gõ → isError, và port KHÔNG bị gọi.
//   2. Chỉ NÂNG: bậc thấp hơn, bậc bằng, hoặc chéo thang cổ đông → isError, port KHÔNG bị gọi.
//   3. Phạm vi đại lý: dealerId đi vào port là đại lý của PHÒNG; staffId là nhân viên đang gõ.
//   4. Input model untrusted: id rác / lý do quá ngắn → isError, không lên mạng.
//   5. Bậc đang áp biến mất khỏi danh mục → CHẶN cả tool đọc, không kể thành "chưa có bậc".

import { describe, expect, test } from "bun:test";
import type { Identity } from "../flash-command/types.ts";
import { AgentApiError, AgentApiErrorCode } from "../operational/agent-api.ts";
import type {
  DealerPort,
  DealerProfile,
  DiscountPort,
  DiscountTier,
  OrderPrincipal,
  TierUpgradeResult,
  WalletDepositQr,
} from "../operational/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import { buildDiscountTierListTool, buildDiscountTierUpgradeTool } from "./impl/dealer/discount.ts";
import type { ToolContext } from "./types.ts";

const GUEST: Identity = { role: "guest", senderId: "u1" };
const DEALER: Identity = { role: "dai_ly", senderId: "u2", customerId: "dealer-9" };
const STAFF: Identity = { role: "nhan_vien", senderId: "u3", userId: "77" };

const skills: SkillRegistry = await buildSkillRegistry();

const TIERS: readonly DiscountTier[] = [
  { id: "10", tierName: "F0", displayLabel: "Đại lý mới", isShareholder: false, sortOrder: 1 },
  { id: "11", tierName: "F1", displayLabel: "Đại lý cấp 1", isShareholder: false, sortOrder: 2 },
  { id: "12", tierName: "F2", isShareholder: false, sortOrder: 3 },
  { id: "20", tierName: "CD1", displayLabel: "Cổ đông", isShareholder: true, sortOrder: 4 },
  { id: "21", tierName: "CD2", displayLabel: "Cổ đông lớn", isShareholder: true, sortOrder: 5 },
];

class FakeDiscount implements DiscountPort {
  readonly upgrades: (OrderPrincipal & { tierId: string; reason: string })[] = [];
  readonly listed: OrderPrincipal[] = [];
  constructor(
    private readonly options: {
      readonly tiers?: readonly DiscountTier[];
      /** Có thì `upgrade` ném lỗi này thay vì trả kết quả. */
      readonly upgradeError?: AgentApiError;
    } = {},
  ) {}

  tiers(p: OrderPrincipal & { signal?: AbortSignal }): Promise<readonly DiscountTier[]> {
    this.listed.push({ dealerId: p.dealerId, staffId: p.staffId });
    return Promise.resolve(this.options.tiers ?? TIERS);
  }

  upgrade(
    p: OrderPrincipal & { tierId: string; reason: string; signal?: AbortSignal },
  ): Promise<TierUpgradeResult> {
    this.upgrades.push({
      dealerId: p.dealerId,
      staffId: p.staffId,
      tierId: p.tierId,
      reason: p.reason,
    });
    if (this.options.upgradeError !== undefined) return Promise.reject(this.options.upgradeError);

    const toTier = (this.options.tiers ?? TIERS).find((tier) => tier.id === p.tierId);
    if (toTier === undefined) throw new Error("test dựng sai: tierId không có trong danh mục");
    return Promise.resolve({
      scheduleId: "555",
      dealerCode: "DL001",
      fromTier: { id: "10", tierName: "F0", sortOrder: 1 },
      toTier,
      effectiveFrom: "2026-08-09",
      reason: p.reason,
      changedBy: p.staffId,
    });
  }
}

class FakeDealer implements DealerPort {
  constructor(private readonly value: DealerProfile | null) {}
  profile(): Promise<DealerProfile | null> {
    return Promise.resolve(this.value);
  }
  // Tool chiết khấu không đụng ví — có mặt chỉ để đủ interface.
  depositQr(): Promise<WalletDepositQr | null> {
    return Promise.resolve(null);
  }
}

function contextOf(p: {
  identity: Identity;
  discount?: DiscountPort;
  dealer?: DealerPort;
  roomCustomerId?: string;
}): ToolContext {
  return {
    skills,
    identity: p.identity,
    roomCustomerId: p.roomCustomerId ?? "dealer-9",
    discount: p.discount,
    dealer: p.dealer,
  };
}

/** Hồ sơ đang ở bậc F0 (thang thường) — mốc mặc định của phần lớn test. */
function profileAtF0(): DealerProfile {
  return { code: "DL001", name: "Đại lý A", discountTierId: "10", discountTierName: "F0" };
}

describe("tra_bac_chiet_khau", () => {
  test("liệt kê bậc, đánh dấu bậc đang áp và bậc nâng lên được", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierListTool(
      contextOf({ identity: DEALER, discount, dealer: new FakeDealer(profileAtF0()) }),
    );

    const result = await tool.run({});

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("F1");
    // Bậc cao hơn cùng thang mới là nâng được; bậc cổ đông thì không.
    // Bậc cổ đông vẫn hiện trong bảng (đại lý hỏi thì trả lời được) nhưng KHÔNG bao giờ nằm trong
    // danh sách nâng được.
    expect(result.content).toContain("CD1");
    const upgradableLine = result.content
      .split("\n")
      .find((text) => text.startsWith("- Nâng lên được:"));
    expect(upgradableLine).toContain("F1");
    expect(upgradableLine).toContain("F2");
    expect(upgradableLine).not.toContain("CD");
    expect(result.content).toContain("KHÔNG nâng vào được");
    expect(result.content).toContain("Bậc đang áp");
    // Phạm vi: đại lý của PHÒNG đi vào port, không phải customerId của người gõ.
    expect(discount.listed[0]?.dealerId).toBe("dealer-9");
  });

  test("đại lý chưa xếp bậc → nói rõ chưa có bậc, không đoán một bậc", async () => {
    const tool = buildDiscountTierListTool(
      contextOf({
        identity: DEALER,
        discount: new FakeDiscount(),
        dealer: new FakeDealer({ code: "DL002" }),
      }),
    );

    const result = await tool.run({});

    expect(result.content).toContain("CHƯA được xếp bậc");
  });

  test("bậc đang áp không còn trong danh mục → chặn, không kể thành chưa có bậc", async () => {
    const tool = buildDiscountTierListTool(
      contextOf({
        identity: DEALER,
        discount: new FakeDiscount(),
        dealer: new FakeDealer({ discountTierId: "999" }),
      }),
    );

    const result = await tool.run({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("không còn trong danh mục");
    expect(result.content).not.toContain("CHƯA được xếp bậc");
  });

  test("danh mục rỗng → báo chưa lấy được bảng bậc", async () => {
    const tool = buildDiscountTierListTool(
      contextOf({
        identity: DEALER,
        discount: new FakeDiscount({ tiers: [] }),
        dealer: new FakeDealer(profileAtF0()),
      }),
    );

    const result = await tool.run({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("không trả về bậc chiết khấu nào");
  });

  test("chưa nối cổng → lỗi nghiệp vụ, không throw", async () => {
    const tool = buildDiscountTierListTool(contextOf({ identity: DEALER }));

    const result = await tool.run({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("chưa sẵn sàng");
  });
});

describe("nang_bac_chiet_khau — hàng rào vai", () => {
  test("đại lý tự gõ → từ chối, KHÔNG gọi port", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({ identity: DEALER, discount, dealer: new FakeDealer(profileAtF0()) }),
    );

    const result = await tool.run({ bac_id: "11", ly_do: "Đạt doanh số quý 3" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Chỉ NHÂN VIÊN");
    expect(discount.upgrades).toHaveLength(0);
    // Không được chạm cả đường đọc: chưa có quyền thì không cần biết bậc nào đang có.
    expect(discount.listed).toHaveLength(0);
  });

  test("guest gõ → từ chối", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({ identity: GUEST, discount, dealer: new FakeDealer(profileAtF0()) }),
    );

    const result = await tool.run({ bac_id: "11", ly_do: "Đạt doanh số quý 3" });

    expect(result.isError).toBe(true);
    expect(discount.upgrades).toHaveLength(0);
  });

  test("nhân viên có userId không phải số → từ chối (lệnh ghi không có người chịu trách nhiệm)", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({
        identity: { role: "nhan_vien", senderId: "u4", userId: "abc" },
        discount,
        dealer: new FakeDealer(profileAtF0()),
      }),
    );

    const result = await tool.run({ bac_id: "11", ly_do: "Đạt doanh số quý 3" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("id nhân viên");
    expect(discount.upgrades).toHaveLength(0);
  });
});

describe("nang_bac_chiet_khau — chỉ nâng, không hạ", () => {
  /** Hồ sơ đang ở F1 (sortOrder 2) để có cả bậc trên lẫn bậc dưới. */
  function atF1(): DealerProfile {
    return { code: "DL001", discountTierId: "11", discountTierName: "F1" };
  }

  test("bậc thấp hơn → từ chối, KHÔNG gọi upgrade", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({ identity: STAFF, discount, dealer: new FakeDealer(atF1()) }),
    );

    const result = await tool.run({ bac_id: "10", ly_do: "Đại lý xin hạ xuống" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("chỉ nâng, không hạ");
    expect(discount.upgrades).toHaveLength(0);
  });

  test("đúng bậc đang áp → từ chối (không có gì để nâng)", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({ identity: STAFF, discount, dealer: new FakeDealer(atF1()) }),
    );

    const result = await tool.run({ bac_id: "11", ly_do: "Xác nhận lại bậc hiện tại" });

    expect(result.isError).toBe(true);
    expect(discount.upgrades).toHaveLength(0);
  });

  test("bậc cổ đông → từ chối dù sortOrder cao hơn", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({ identity: STAFF, discount, dealer: new FakeDealer(profileAtF0()) }),
    );

    const result = await tool.run({ bac_id: "20", ly_do: "Đại lý nói mình là cổ đông" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("CỔ ĐÔNG");
    expect(discount.upgrades).toHaveLength(0);
  });

  test("đại lý đã ở bậc THƯỜNG CAO NHẤT vẫn không vào được bậc cổ đông", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({
        identity: STAFF,
        discount,
        // F2 = sortOrder 3, bậc cao nhất của thang thường.
        dealer: new FakeDealer({ code: "DL001", discountTierId: "12", discountTierName: "F2" }),
      }),
    );

    const result = await tool.run({ bac_id: "20", ly_do: "Đại lý đã đạt mức cao nhất, cho lên cổ đông" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("không ai nâng lên được");
    expect(discount.upgrades).toHaveLength(0);
  });

  test("đại lý ĐANG là cổ đông cũng không nâng tiếp sang bậc cổ đông cao hơn", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({
        identity: STAFF,
        discount,
        dealer: new FakeDealer({ code: "DL009", discountTierId: "20", discountTierName: "CD1" }),
      }),
    );

    const result = await tool.run({ bac_id: "21", ly_do: "Nâng lên cổ đông lớn" });

    expect(result.isError).toBe(true);
    expect(discount.upgrades).toHaveLength(0);
  });

  test("đại lý đang là cổ đông → mọi bậc thường đều là hạ bậc, từ chối", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({
        identity: STAFF,
        discount,
        dealer: new FakeDealer({ code: "DL009", discountTierId: "20", discountTierName: "CD1" }),
      }),
    );

    const result = await tool.run({ bac_id: "12", ly_do: "Chuyển về thang thường" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("HẠ bậc");
    expect(discount.upgrades).toHaveLength(0);
  });

  test("bậc cao hơn cùng thang → ghi, kèm dealerId phòng và staffId người gõ", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({ identity: STAFF, discount, dealer: new FakeDealer(profileAtF0()) }),
    );

    const result = await tool.run({ bac_id: "12", ly_do: "Đạt doanh số 200 triệu kỳ đối soát" });

    expect(result.isError).toBeUndefined();
    expect(discount.upgrades).toEqual([
      {
        dealerId: "dealer-9",
        staffId: "77",
        tierId: "12",
        reason: "Đạt doanh số 200 triệu kỳ đối soát",
      },
    ]);
    expect(result.content).toContain("ĐÃ CẬP NHẬT");
    expect(result.content).toContain("F2");
  });

  test("đại lý chưa xếp bậc, dù hồ sơ gắn cờ cổ đông → vẫn xếp được vào bậc thường", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({
        identity: STAFF,
        discount,
        // Cờ is_shareholder là tư cách sở hữu, KHÔNG phải chỗ đại lý đang đứng trên bảng giá.
        dealer: new FakeDealer({ code: "DL003", isShareholder: true }),
      }),
    );

    const result = await tool.run({ bac_id: "11", ly_do: "Xếp bậc lần đầu theo hồ sơ" });

    expect(result.isError).toBeUndefined();
    expect(discount.upgrades).toHaveLength(1);
  });
});

describe("nang_bac_chiet_khau — input model untrusted", () => {
  test("id bậc không phải chuỗi số → từ chối trước khi lên mạng", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({ identity: STAFF, discount, dealer: new FakeDealer(profileAtF0()) }),
    );

    const result = await tool.run({ bac_id: "F2", ly_do: "Đạt doanh số quý 3" });

    expect(result.isError).toBe(true);
    expect(discount.listed).toHaveLength(0);
    expect(discount.upgrades).toHaveLength(0);
  });

  test("id bậc không có trong danh mục → từ chối", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({ identity: STAFF, discount, dealer: new FakeDealer(profileAtF0()) }),
    );

    const result = await tool.run({ bac_id: "999", ly_do: "Đạt doanh số quý 3" });

    expect(result.isError).toBe(true);
    expect(discount.upgrades).toHaveLength(0);
  });

  test("lý do quá ngắn → từ chối trước khi lên mạng", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool(
      contextOf({ identity: STAFF, discount, dealer: new FakeDealer(profileAtF0()) }),
    );

    const result = await tool.run({ bac_id: "12", ly_do: "ok" });

    expect(result.isError).toBe(true);
    expect(discount.listed).toHaveLength(0);
    expect(discount.upgrades).toHaveLength(0);
  });

  test("phòng chưa nối đại lý → từ chối", async () => {
    const discount = new FakeDiscount();
    const tool = buildDiscountTierUpgradeTool({
      skills,
      identity: STAFF,
      discount,
      dealer: new FakeDealer(profileAtF0()),
    });

    const result = await tool.run({ bac_id: "12", ly_do: "Đạt doanh số quý 3" });

    expect(result.isError).toBe(true);
    expect(discount.upgrades).toHaveLength(0);
  });
});

describe("nang_bac_chiet_khau — backend từ chối", () => {
  test("lỗi API → nói CHƯA CHẮC đã ghi, không báo thành công", async () => {
    const discount = new FakeDiscount({
      upgradeError: new AgentApiError(
        "POST /agent/discount-tiers/upgrade trả 409 (TIER_DOWNGRADE_FORBIDDEN): không được hạ bậc",
        409,
        "TIER_DOWNGRADE_FORBIDDEN",
        "/agent/discount-tiers/upgrade",
      ),
    });
    const tool = buildDiscountTierUpgradeTool(
      contextOf({ identity: STAFF, discount, dealer: new FakeDealer(profileAtF0()) }),
    );

    const result = await tool.run({ bac_id: "12", ly_do: "Đạt doanh số 200 triệu" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("CHƯA CHẮC");
    expect(result.content).toContain("TIER_DOWNGRADE_FORBIDDEN");
    expect(result.content).not.toContain("ĐÃ CẬP NHẬT");
  });

  test("lỗi khi ĐỌC danh mục → báo trục trặc, không kết luận bậc", async () => {
    const broken: DiscountPort = {
      tiers: () =>
        Promise.reject(
          new AgentApiError(
            "GET /agent/discount-tiers trả 500",
            500,
            AgentApiErrorCode.Transport,
            "/agent/discount-tiers",
          ),
        ),
      upgrade: () => Promise.reject(new Error("không được gọi")),
    };
    const tool = buildDiscountTierListTool(
      contextOf({ identity: STAFF, discount: broken, dealer: new FakeDealer(profileAtF0()) }),
    );

    const result = await tool.run({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("không phản hồi");
  });
});
