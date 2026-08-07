// Test hai tool sổ ngày trên DailyPort GIẢ (không mạng). Bốn thứ phải chốt:
//   1. Phạm vi đại lý: đại lý đi vào port là đại lý của PHÒNG, không phải người gõ.
//   2. Ngày: input model là untrusted — ngày rác/không tồn tại phải ra isError, không lên query.
//   3. Một mục hỏng KHÔNG được kể thành 0 đơn, và không được nuốt ba mục còn lại.
//   4. Chênh lệch tiền tính bằng BigInt: không lệch, không làm tròn.

import { describe, expect, test } from "bun:test";
import type { Identity } from "../flash-command/types.ts";
import { AgentApiError, AgentApiErrorCode } from "../operational/agent-api.ts";
import type {
  DailyChargeLine,
  DailyLine,
  DailyOrderLine,
  DailyPage,
  DailyPort,
  DailyQuery,
  DailyRefundLine,
} from "../operational/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import { buildDailyDetailTool, buildDailyReportTool, parseDate } from "./impl/dealer/daily.ts";
import { subtractMoney, todayInVietnam } from "./impl/order/scope.ts";

const GUEST: Identity = { role: "guest", senderId: "u1" };
const DEALER: Identity = { role: "dai_ly", senderId: "u2", customerId: "dealer-9" };
const STAFF: Identity = { role: "nhan_vien", senderId: "u3", userId: "77" };

const skills: SkillRegistry = await buildSkillRegistry();

/** Trang rỗng có meta — dùng cho mục không cần dữ liệu trong từng test. */
function emptyPage<Line extends DailyLine>(): DailyPage<Line> {
  return { meta: { totalItems: 0, page: 1, totalPages: 1 }, lines: [] };
}

class FakeDaily implements DailyPort {
  readonly seen: DailyQuery[] = [];
  constructor(
    private readonly pages: {
      shipped?: DailyPage<DailyOrderLine>;
      returned?: DailyPage<DailyOrderLine>;
      charges?: DailyPage<DailyChargeLine>;
      refunds?: DailyPage<DailyRefundLine>;
      /** Mục nào nằm ở đây thì ném AgentApiError thay vì trả trang. */
      broken?: ReadonlySet<string>;
      brokenCode?: string;
    },
  ) {}

  shippedOrders(q: DailyQuery): Promise<DailyPage<DailyOrderLine>> {
    return this.answer("shipped", q, this.pages.shipped);
  }
  returnedOrders(q: DailyQuery): Promise<DailyPage<DailyOrderLine>> {
    return this.answer("returned", q, this.pages.returned);
  }
  charges(q: DailyQuery): Promise<DailyPage<DailyChargeLine>> {
    return this.answer("charges", q, this.pages.charges);
  }
  refunds(q: DailyQuery): Promise<DailyPage<DailyRefundLine>> {
    return this.answer("refunds", q, this.pages.refunds);
  }

  private answer<Line extends DailyLine>(
    section: string,
    q: DailyQuery,
    page: DailyPage<Line> | undefined,
  ): Promise<DailyPage<Line>> {
    this.seen.push(q);
    if (this.pages.broken?.has(section) === true) {
      return Promise.reject(
        new AgentApiError(
          `GET /agent/daily/${section} lỗi`,
          500,
          this.pages.brokenCode ?? AgentApiErrorCode.Transport,
          `/agent/daily/${section}`,
        ),
      );
    }
    return Promise.resolve(page ?? emptyPage<Line>());
  }
}

const FULL_DAY = {
  shipped: {
    meta: { date: "2026-08-08", dealerCode: "DL001", totalItems: 12, totalQuantity: 30, totalAmount: "9000000", page: 1, totalPages: 1 },
    lines: [],
  } satisfies DailyPage<DailyOrderLine>,
  returned: {
    meta: { totalItems: 2, totalQuantity: 4, totalAmount: "300000", page: 1, totalPages: 1 },
    lines: [],
  } satisfies DailyPage<DailyOrderLine>,
  charges: {
    meta: { totalItems: 12, totalAmount: "9000000", goodsAmount: "8940000", cartonFee: "60000", page: 1, totalPages: 1 },
    lines: [],
  } satisfies DailyPage<DailyChargeLine>,
  refunds: {
    meta: { totalItems: 2, totalAmount: "300000", page: 1, totalPages: 1 },
    lines: [],
  } satisfies DailyPage<DailyRefundLine>,
};

describe("parseDate", () => {
  test("bỏ trống = hôm nay giờ VN", () => {
    expect(parseDate(undefined)).toBe(todayInVietnam());
  });

  test("nhận dd/mm/yyyy, dd-mm-yyyy và yyyy-mm-dd → ISO", () => {
    expect(parseDate("08/08/2026")).toBe("2026-08-08");
    expect(parseDate("8-8-2026")).toBe("2026-08-08");
    expect(parseDate("2026-08-08")).toBe("2026-08-08");
  });

  test("ngày không tồn tại / rác → undefined (tool hỏi lại, không để backend đoán)", () => {
    expect(parseDate("31/02/2026")).toBeUndefined();
    expect(parseDate("2026-13-01")).toBeUndefined();
    expect(parseDate("hôm qua")).toBeUndefined();
    expect(parseDate("2026-08-08' OR 1=1")).toBeUndefined();
  });
});

describe("subtractMoney", () => {
  test("trừ chuỗi tiền không qua float", () => {
    expect(subtractMoney("9000000", "300000")).toBe("8700000");
    expect(subtractMoney("9000000.10", "0.20")).toBe("8999999.90");
    // Cặp số kinh điển làm float lệch: 0.1 + 0.2.
    expect(subtractMoney("0.30", "0.10")).toBe("0.20");
  });

  test("hoàn nhiều hơn phải trả → số âm (công ty trả lại đại lý)", () => {
    expect(subtractMoney("100000", "250000")).toBe("-150000");
  });

  test("thiếu vế / shape lạ → undefined, không đoán", () => {
    expect(subtractMoney(undefined, "1")).toBeUndefined();
    expect(subtractMoney("1", "nhiều")).toBeUndefined();
  });
});

describe("bao_cao_ngay", () => {
  test("in bốn con số từ meta + chênh lệch, phạm vi là đại lý của phòng", async () => {
    const daily = new FakeDaily(FULL_DAY);
    const result = await buildDailyReportTool({ skills, identity: STAFF, roomCustomerId: "dealer-1", daily }).run({
      ngay: "08/08/2026",
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Sổ ngày 08/08/2026 — đại lý DL001");
    expect(result.content).toContain("Xuất kho: 12 đơn · 30 sản phẩm");
    expect(result.content).toContain("9.000.000 ₫ (tiền hàng 8.940.000 ₫ + phí thùng 60.000 ₫)");
    expect(result.content).toContain("Hoàn về: 2 đơn · 4 sản phẩm");
    expect(result.content).toContain("Chênh lệch còn phải chuyển: 8.700.000 ₫");
    expect(result.content).toContain("NGÀY XUẤT KHO / NGÀY HOÀN");
    // Nhân viên gõ trong nhóm đại lý X → sổ của X, staffId chỉ để audit.
    expect(daily.seen.every((q) => q.dealerId === "dealer-1" && q.staffId === "77")).toBe(true);
    expect(daily.seen.every((q) => q.date === "2026-08-08")).toBe(true);
  });

  test("bỏ trống ngay → hôm nay giờ VN", async () => {
    const daily = new FakeDaily(FULL_DAY);
    await buildDailyReportTool({ skills, identity: DEALER, daily }).run({});

    expect(daily.seen[0]?.date).toBe(todayInVietnam());
    expect(daily.seen[0]?.dealerId).toBe("dealer-9");
  });

  test("ngày rác → isError, KHÔNG gọi API", async () => {
    const daily = new FakeDaily(FULL_DAY);
    const result = await buildDailyReportTool({ skills, identity: DEALER, daily }).run({ ngay: "31/02/2026" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Ngày không hợp lệ");
    expect(daily.seen).toHaveLength(0);
  });

  test("0 đơn là dữ liệu thật → không phải lỗi", async () => {
    const daily = new FakeDaily({});
    const result = await buildDailyReportTool({ skills, identity: DEALER, daily }).run({});

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Xuất kho: 0 đơn");
  });

  test("một mục hỏng → nói rõ chưa tra được, ba mục còn lại vẫn báo", async () => {
    const daily = new FakeDaily({ ...FULL_DAY, broken: new Set(["returned"]) });
    const result = await buildDailyReportTool({ skills, identity: DEALER, daily }).run({});

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Hoàn về: chưa tra được");
    expect(result.content).toContain("Xuất kho: 12 đơn");
    expect(result.content).not.toContain("Hoàn về: 0 đơn");
  });

  test("cả bốn mục hỏng → isError, cấm nói 'không có đơn'", async () => {
    const broken = new Set(["shipped", "returned", "charges", "refunds"]);
    const daily = new FakeDaily({ ...FULL_DAY, broken });
    const result = await buildDailyReportTool({ skills, identity: DEALER, daily }).run({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG nói là ngày đó không có đơn");
  });

  test("backend báo ngày sai → hỏi lại ngày, không báo trục trặc hệ thống", async () => {
    const broken = new Set(["shipped", "returned", "charges", "refunds"]);
    const daily = new FakeDaily({ broken, brokenCode: AgentApiErrorCode.InvalidDate });
    const result = await buildDailyReportTool({ skills, identity: DEALER, daily }).run({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Ngày không hợp lệ");
  });

  test("chưa /ketnoi-daily → isError, không tra bừa", async () => {
    const result = await buildDailyReportTool({ skills, identity: GUEST, daily: new FakeDaily({}) }).run({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("ketnoi-daily");
  });

  test("chưa nối cổng → isError riêng, không nhầm với 'không có đơn'", async () => {
    const result = await buildDailyReportTool({ skills, identity: DEALER }).run({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("chưa sẵn sàng");
  });
});

describe("chi_tiet_so_ngay", () => {
  const shipped: DailyPage<DailyOrderLine> = {
    meta: { totalItems: 25, totalAmount: "9000000", page: 1, pageSize: 20, totalPages: 2 },
    lines: [
      {
        trackingNumber: "VTP001",
        at: "2026-08-08T03:15:00Z",
        quantity: 3,
        goodsAmount: "450000",
        items: [
          { sku: "SP1", productName: "Sữa hạt", quantity: 2, isGift: false, lineAmount: "450000" },
          { sku: "SP2", productName: "Ly sứ", quantity: 1, isGift: true, lineAmount: "0" },
        ],
      },
    ],
  };

  test("liệt kê đơn, ghi rõ (Tặng) cho hàng tặng", async () => {
    const daily = new FakeDaily({ shipped });
    const result = await buildDailyDetailTool({ skills, identity: DEALER, daily }).run({ muc: "xuat_kho" });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("VTP001");
    expect(result.content).toContain("Ly sứ SP2 · x1 · (Tặng)");
    expect(result.content).not.toContain("Ly sứ SP2 · x1 · 0 ₫");
  });

  test("in tổng cả ngày, không để model cộng các dòng", async () => {
    const daily = new FakeDaily({ shipped });
    const result = await buildDailyDetailTool({ skills, identity: DEALER, daily }).run({ muc: "xuat_kho" });

    expect(result.content).toContain("Tổng cả ngày: 25 đơn");
    expect(result.content).toContain("Tổng tiền cả ngày: 9.000.000 ₫");
  });

  test("còn trang → nhắc hỏi khách, không tự kéo tiếp", async () => {
    const daily = new FakeDaily({ shipped });
    const result = await buildDailyDetailTool({ skills, identity: DEALER, daily }).run({ muc: "xuat_kho" });

    expect(result.content).toContain("trang 1/2");
    expect(result.content).toContain("đừng tự kéo hết");
  });

  test("trang do model chọn đi thẳng vào query, tối thiểu là 1", async () => {
    const daily = new FakeDaily({ shipped });
    const tool = buildDailyDetailTool({ skills, identity: DEALER, daily });
    await tool.run({ muc: "xuat_kho", trang: 2 });
    await tool.run({ muc: "xuat_kho", trang: -5 });

    expect(daily.seen.map((q) => q.page)).toEqual([2, 1]);
  });

  test("mục sai → isError liệt kê đúng bốn lựa chọn", async () => {
    const daily = new FakeDaily({});
    const result = await buildDailyDetailTool({ skills, identity: DEALER, daily }).run({ muc: "ton_kho" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("xuat_kho, hoan_ve, tien_phai_tra, tien_hoan_lai");
    expect(daily.seen).toHaveLength(0);
  });

  test("mục tiền phải trả kèm cảnh báo không phải COD", async () => {
    const charges: DailyPage<DailyChargeLine> = {
      meta: { totalItems: 1, totalAmount: "450000", page: 1, totalPages: 1 },
      lines: [
        {
          trackingNumber: "VTP001",
          shippedAt: "2026-08-08T03:15:00Z",
          quantity: 3,
          goodsAmount: "445000",
          cartonFee: "5000",
          amount: "450000",
        },
      ],
    };
    const result = await buildDailyDetailTool({
      skills,
      identity: DEALER,
      daily: new FakeDaily({ charges }),
    }).run({ muc: "tien_phai_tra" });

    expect(result.content).toContain("phí thùng 5.000 ₫");
    expect(result.content).toContain("KHÔNG phải COD khách trả");
  });

  test("trang rỗng nói thẳng, không im lặng", async () => {
    const result = await buildDailyDetailTool({
      skills,
      identity: DEALER,
      daily: new FakeDaily({}),
    }).run({ muc: "tien_hoan_lai" });

    expect(result.content).toContain("không có đơn nào");
  });

  test("API hỏng → báo trục trặc, KHÔNG kể thành 'không có đơn'", async () => {
    const daily = new FakeDaily({ broken: new Set(["charges"]) });
    const result = await buildDailyDetailTool({ skills, identity: DEALER, daily }).run({ muc: "tien_phai_tra" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG nói là ngày đó không có đơn");
  });
});
