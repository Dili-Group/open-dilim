// Test tool use_skill / use_reference: chạy trên skill def THẬT (đọc filesystem), input model
// sinh là untrusted nên mọi shape rác phải ra isError chứ không throw. Kèm chốt chặn
// confused-deputy: KHÔNG schema tool nào được chứa trường danh tính.
//
// Tool đơn hàng test trên OrderPort GIẢ (không mạng): thứ cần chốt là PHẠM VI ĐẠI LÝ — đại lý nào
// đi vào port, và đơn của đại lý khác không được rò ra câu trả lời.

import { describe, expect, test } from "bun:test";
import type { Identity } from "../flash-command/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import { AgentApiError, AgentApiErrorCode } from "../operational/agent-api.ts";
import type {
  DealerPort,
  DealerProfile,
  OrderCameraLink,
  OrderDetail,
  OrderPayment,
  OrderPort,
  OrderPrincipal,
  OrderSearchPage,
} from "../operational/types.ts";
import { COMMON_TOOLS, DEALER_TOOLS, ORDER_TOOLS, buildToolRegistry, readStringField } from "./index.ts";
import { readIntegerField } from "./input.ts";
import { buildUseSkillTool } from "./impl/use-skill.ts";
import { buildUseReferenceTool } from "./impl/use-reference.ts";
import { buildOrderStatusTool } from "./impl/order/status.ts";
import { buildOrderPaymentTool } from "./impl/order/payment.ts";
import { buildOrderVideoTool } from "./impl/order/video.ts";
import { buildDealerProfileTool } from "./impl/dealer/profile.ts";

const GUEST: Identity = { role: "guest", senderId: "u1" };
const DEALER: Identity = { role: "dai_ly", senderId: "u2", customerId: "dealer-9" };
const STAFF: Identity = { role: "nhan_vien", senderId: "u3", userId: "77" };

// Registry thật từ src/skills/defs (có "chiet-khau" kèm references/bang-muc.md).
const skills: SkillRegistry = await buildSkillRegistry();

describe("readStringField", () => {
  test("lấy chuỗi đã trim", () => {
    expect(readStringField({ name: "  refund " }, "name")).toBe("refund");
  });

  test("không phải object / thiếu key / sai kiểu / rỗng → undefined", () => {
    expect(readStringField(42, "name")).toBeUndefined();
    expect(readStringField(null, "name")).toBeUndefined();
    expect(readStringField({}, "name")).toBeUndefined();
    expect(readStringField({ name: 7 }, "name")).toBeUndefined();
    expect(readStringField({ name: "   " }, "name")).toBeUndefined();
  });
});

describe("readIntegerField", () => {
  test("nhận số nguyên và chuỗi số nguyên (model hay trả '6')", () => {
    expect(readIntegerField({ status: 6 }, "status")).toBe(6);
    expect(readIntegerField({ status: "-1" }, "status")).toBe(-1);
  });

  test("số thực / chữ / thiếu → undefined", () => {
    expect(readIntegerField({ status: 6.5 }, "status")).toBeUndefined();
    expect(readIntegerField({ status: "giao xong" }, "status")).toBeUndefined();
    expect(readIntegerField({}, "status")).toBeUndefined();
  });
});

describe("use_skill", () => {
  const tool = buildUseSkillTool(skills);

  test("skill có thật → trả body + liệt kê reference", async () => {
    const result = await tool.run({ name: "chiet-khau" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("# Skill: chiet-khau");
    expect(result.content).toContain("use_reference");
  });

  test("agent ngoài scope skill → isError y như tên lạ", async () => {
    // chiet-khau khai `agents: dealer` → agent trợ lý riêng không nạp được.
    const scoped = buildUseSkillTool(skills, "personal");
    const result = await scoped.run({ name: "chiet-khau" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("không tồn tại");
    expect((await buildUseSkillTool(skills, "dealer").run({ name: "chiet-khau" })).isError).toBeFalsy();
  });

  test("tên lạ → isError structured, KHÔNG throw", async () => {
    const result = await tool.run({ name: "khong_co_skill_nay" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("không tồn tại");
  });

  test("input rác → isError", async () => {
    expect((await tool.run({})).isError).toBe(true);
    expect((await tool.run(42)).isError).toBe(true);
    expect((await tool.run({ name: 7 })).isError).toBe(true);
  });
});

describe("use_reference", () => {
  const tool = buildUseReferenceTool(skills);

  test("reference có thật → trả nội dung", async () => {
    const result = await tool.run({ skill: "chiet-khau", reference: "bang-muc.md" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("chiet-khau / bang-muc.md");
  });

  test("path traversal → isError, KHÔNG throw ra loop", async () => {
    const result = await tool.run({ skill: "chiet-khau", reference: "../SKILL.md" });
    expect(result.isError).toBe(true);
  });

  test("thiếu tham số → isError", async () => {
    expect((await tool.run({ skill: "refund" })).isError).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cổng đơn giả. Mỗi đơn gắn CHỦ (dealerId); port chỉ trả đơn của đúng đại lý gọi lên — hệt như
// backend ép theo header x-dealer-id. Đơn của đại lý khác ra null/[] chứ không ra dữ liệu.
// ─────────────────────────────────────────────────────────────────────────────

interface OwnedOrder {
  readonly dealerId: string;
  readonly order: OrderDetail;
}

function makeOrder(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    trackingNumber: "VTP01",
    status: 5,
    carrier: 1,
    totalAmount: "1234567.00",
    customerName: "Nguyễn A",
    customerPhone: "0900000001",
    createdAt: "2026-08-01T03:00:00Z",
    transitions: [
      { fromState: 0, toState: 5, actorName: "Kho 1", createdAt: "2026-08-01T04:00:00Z" },
    ],
    ...over,
  };
}

function makeLink(over: Partial<OrderCameraLink> = {}): OrderCameraLink {
  return {
    sessionCode: "SS-1",
    scannedAt: "2026-08-01T03:30:00Z",
    cameraCount: 2,
    url: "https://media.example/v/VTP01?token=abc",
    expiresAt: "2026-08-01T03:45:00Z",
    ...over,
  };
}

function makePayment(over: Partial<OrderPayment> = {}): OrderPayment {
  return {
    trackingNumber: "VTP01",
    amount: "1005000.00",
    baseAmount: "1000000.00",
    packagingFee: "5000.00",
    dealerCode: "DL001",
    dealerName: "Đại lý A",
    carrier: 0,
    items: [{ orderItemId: "9", unitPrice: "500000", lineTotal: "1000000" }],
    bank: {
      bankCode: "VCB",
      bankName: "Vietcombank",
      accountNumber: "0011000123456",
      accountName: "CONG TY DILI",
    },
    transferContent: "NAP DL001",
    qrUrl: "https://qr.example/abc",
    ...over,
  };
}

class FakeOrders implements OrderPort {
  readonly seen: OrderPrincipal[] = [];
  constructor(
    private readonly owned: readonly OwnedOrder[],
    private readonly links: Readonly<Record<string, readonly OrderCameraLink[]>> = {},
    private readonly payments: Readonly<Record<string, OrderPayment>> = {},
  ) {}

  search(p: OrderPrincipal & { search?: string; status?: number }): Promise<OrderSearchPage> {
    this.seen.push({ dealerId: p.dealerId, staffId: p.staffId });
    const orders = this.mine(p.dealerId)
      .filter((o) => p.status === undefined || o.status === p.status)
      .filter((o) => p.search === undefined || matches(o, p.search));
    return Promise.resolve({ orders, total: orders.length });
  }

  detail(p: OrderPrincipal & { trackingNumber: string }): Promise<OrderDetail | null> {
    this.seen.push({ dealerId: p.dealerId, staffId: p.staffId });
    return Promise.resolve(this.find(p.dealerId, p.trackingNumber) ?? null);
  }

  payment(p: OrderPrincipal & { trackingNumber: string }): Promise<OrderPayment | null> {
    this.seen.push({ dealerId: p.dealerId, staffId: p.staffId });
    if (this.find(p.dealerId, p.trackingNumber) === undefined) return Promise.resolve(null);
    return Promise.resolve(this.payments[p.trackingNumber] ?? null);
  }

  cameraLinks(p: OrderPrincipal & { trackingNumber: string }): Promise<readonly OrderCameraLink[]> {
    this.seen.push({ dealerId: p.dealerId, staffId: p.staffId });
    if (this.find(p.dealerId, p.trackingNumber) === undefined) return Promise.resolve([]);
    return Promise.resolve(this.links[p.trackingNumber] ?? []);
  }

  private mine(dealerId: string): OrderDetail[] {
    return this.owned.filter((o) => o.dealerId === dealerId).map((o) => o.order);
  }

  private find(dealerId: string, trackingNumber: string): OrderDetail | undefined {
    return this.mine(dealerId).find(
      (o) => o.trackingNumber.toLowerCase() === trackingNumber.toLowerCase(),
    );
  }
}

function matches(order: OrderDetail, search: string): boolean {
  const needle = search.toLowerCase();
  return [order.trackingNumber, order.customerName, order.customerPhone].some(
    (field) => field !== undefined && field.toLowerCase().includes(needle),
  );
}

/** Cổng luôn hỏng — chốt rằng sự cố API KHÔNG bị kể lại thành "không tìm thấy đơn". */
class BrokenOrders implements OrderPort {
  private fail(): never {
    throw new AgentApiError("GET /agent/orders trả 500", 500, AgentApiErrorCode.Transport, "/agent/orders");
  }
  search(): Promise<OrderSearchPage> {
    this.fail();
  }
  detail(): Promise<OrderDetail | null> {
    this.fail();
  }
  payment(): Promise<OrderPayment | null> {
    this.fail();
  }
  cameraLinks(): Promise<readonly OrderCameraLink[]> {
    this.fail();
  }
}

describe("tra_don_hang", () => {
  const orders = new FakeOrders([
    { dealerId: "dealer-1", order: makeOrder() },
    {
      dealerId: "dealer-2",
      order: makeOrder({ trackingNumber: "VTP02", customerName: "Trần B", customerPhone: "0900000002" }),
    },
  ]);
  const ctx = { skills, identity: GUEST, roomCustomerId: "dealer-1", orders };

  test("có mã vận đơn của CHỦ PHÒNG → chi tiết + tiền định dạng VN + lịch sử", async () => {
    const result = await buildOrderStatusTool(ctx).run({ ma_van_don: "vtp01" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Đơn VTP01");
    expect(result.content).toContain("đang vận chuyển");
    expect(result.content).toContain("1.234.567 ₫");
    expect(result.content).toContain("Viettel Post");
    expect(result.content).toContain("Lịch sử trạng thái");
  });

  test("mã của đại lý KHÁC → không thấy, cấm nói 'đơn không tồn tại', không rò khách kia", async () => {
    const result = await buildOrderStatusTool(ctx).run({ ma_van_don: "VTP02" });
    expect(result.content).toContain("Không thấy đơn");
    expect(result.content).toContain("30 ngày");
    expect(result.content).not.toContain("Trần B");
  });

  test("không mã → liệt kê đơn gần đây + bảo chốt mã rồi gọi lại", async () => {
    const result = await buildOrderStatusTool(ctx).run({});
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("VTP01");
    expect(result.content).toContain("ma_van_don");
  });

  test("tim_kiem theo SĐT khách → lọc đúng, không đụng đơn đại lý khác", async () => {
    const found = await buildOrderStatusTool(ctx).run({ tim_kiem: "0900000001" });
    expect(found.content).toContain("VTP01");
    const miss = await buildOrderStatusTool(ctx).run({ tim_kiem: "0900000002" });
    expect(miss.content).toContain("Không thấy");
  });

  test("trang_thai lọc theo mã số", async () => {
    const hit = await buildOrderStatusTool(ctx).run({ trang_thai: 5 });
    expect(hit.content).toContain("VTP01");
    const none = await buildOrderStatusTool(ctx).run({ trang_thai: 14 });
    expect(none.content).toContain("Không thấy");
  });

  test("chat 1-1 (không có chủ phòng) → dùng customerId của identity đại lý", async () => {
    const own = new FakeOrders([{ dealerId: "dealer-9", order: makeOrder({ trackingNumber: "VTP09" }) }]);
    const tool = buildOrderStatusTool({ skills, identity: DEALER, orders: own });
    expect((await tool.run({ ma_van_don: "VTP09" })).content).toContain("Đơn VTP09");
    expect(own.seen[0]?.dealerId).toBe("dealer-9");
  });

  test("nhân viên gõ trong nhóm đại lý → dealer = chủ phòng, staff = người gõ (audit)", async () => {
    const staffCtx = { skills, identity: STAFF, roomCustomerId: "dealer-1", orders: new FakeOrders([]) };
    await buildOrderStatusTool(staffCtx).run({});
    expect(staffCtx.orders.seen[0]).toEqual({ dealerId: "dealer-1", staffId: "77" });
  });

  test("không xác định được đại lý → isError, KHÔNG tra bừa", async () => {
    const untouched = new FakeOrders([{ dealerId: "dealer-1", order: makeOrder() }]);
    const tool = buildOrderStatusTool({ skills, identity: GUEST, orders: untouched });
    const result = await tool.run({ ma_van_don: "VTP01" });
    expect(result.isError).toBe(true);
    expect(untouched.seen).toHaveLength(0);
  });

  test("chưa nối cổng đơn → isError structured, KHÔNG throw", async () => {
    const tool = buildOrderStatusTool({ skills, identity: GUEST, roomCustomerId: "dealer-1" });
    expect((await tool.run({ ma_van_don: "VTP01" })).isError).toBe(true);
  });

  test("API vận hành lỗi → báo trục trặc, KHÔNG kể thành 'không tìm thấy đơn'", async () => {
    const tool = buildOrderStatusTool({ ...ctx, orders: new BrokenOrders() });
    const result = await tool.run({ ma_van_don: "VTP01" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG nói là không tìm thấy");
  });

  test("khai announce để loop báo khách trước khi tra", () => {
    expect(buildOrderStatusTool(ctx).announce).toContain("kiểm tra");
  });
});

describe("tra_tien_can_chuyen", () => {
  const orders = new FakeOrders(
    [
      { dealerId: "dealer-1", order: makeOrder() },
      { dealerId: "dealer-2", order: makeOrder({ trackingNumber: "VTP02" }) },
    ],
    {},
    { VTP01: makePayment(), VTP02: makePayment({ trackingNumber: "VTP02", amount: "999.00" }) },
  );
  const ctx = { skills, identity: GUEST, roomCustomerId: "dealer-1", orders };

  test("in số cần chuyển + tách giá đại lý/phí hộp + khối chuyển khoản", async () => {
    const result = await buildOrderPaymentTool(ctx).run({ ma_van_don: "VTP01" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("SỐ TIỀN CẦN CHUYỂN: 1.005.000 ₫");
    expect(result.content).toContain("Giá đại lý: 1.000.000 ₫");
    expect(result.content).toContain("Phí hộp giấy: 5.000 ₫");
    expect(result.content).toContain("0011000123456");
    expect(result.content).toContain("Link QR: https://qr.example/abc");
  });

  test("nội dung chuyển khoản in NGUYÊN VĂN + cấm hiểu nhầm thành COD", async () => {
    const result = await buildOrderPaymentTool(ctx).run({ ma_van_don: "VTP01" });
    expect(result.content).toContain("Nội dung chuyển khoản: NAP DL001");
    expect(result.content).toContain("NGUYÊN VĂN");
    expect(result.content).toContain("KHÔNG phải tiền COD");
  });

  test("đơn của đại lý khác → không thấy, KHÔNG rò số tiền", async () => {
    const result = await buildOrderPaymentTool(ctx).run({ ma_van_don: "VTP02" });
    expect(result.content).toContain("Không thấy đơn");
    expect(result.content).not.toContain("999");
  });

  test("thiếu mã vận đơn → isError, bảo model chốt đơn trước", async () => {
    const result = await buildOrderPaymentTool(ctx).run({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("tra_don_hang");
  });

  test("API vận hành lỗi → báo trục trặc, KHÔNG kể thành 'không có đơn'", async () => {
    const tool = buildOrderPaymentTool({ ...ctx, orders: new BrokenOrders() });
    const result = await tool.run({ ma_van_don: "VTP01" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG nói là không tìm thấy");
  });

  test("không xác định được đại lý → isError, KHÔNG tra bừa", async () => {
    const untouched = new FakeOrders(
      [{ dealerId: "dealer-1", order: makeOrder() }],
      {},
      { VTP01: makePayment() },
    );
    const tool = buildOrderPaymentTool({ skills, identity: GUEST, orders: untouched });
    expect((await tool.run({ ma_van_don: "VTP01" })).isError).toBe(true);
    expect(untouched.seen).toHaveLength(0);
  });
});

describe("video_don_hang", () => {
  const orders = new FakeOrders([{ dealerId: "dealer-1", order: makeOrder() }], {
    VTP01: [makeLink()],
  });
  const ctx = { skills, identity: GUEST, roomCustomerId: "dealer-1", orders };

  test("có video → trả link kèm hạn + nhắc 15 phút", async () => {
    const result = await buildOrderVideoTool(ctx).run({ ma_van_don: "VTP01" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("https://media.example/v/VTP01?token=abc");
    expect(result.content).toContain("15 phút");
    // Khối lặp → bảng TOON: nhãn cột khai một lần ở header, mỗi lần quét là một hàng.
    expect(result.content).toContain("video[1]{lan_quet,luc_quet,so_camera,link,het_han_luc}:");
  });

  test("lần quét thiếu dữ kiện → ô rỗng `\"\"`, KHÔNG bỏ cột (bảng phải đều cột)", async () => {
    const sparse = new FakeOrders([{ dealerId: "dealer-1", order: makeOrder() }], {
      VTP01: [{ url: "https://media.example/v/x" }],
    });
    const result = await buildOrderVideoTool({ ...ctx, orders: sparse }).run({ ma_van_don: "VTP01" });
    expect(result.content).toContain('"","","","https://media.example/v/x",""');
  });

  test("đơn không thuộc đại lý / chưa quay → nói chưa có, không hứa gửi sau", async () => {
    const result = await buildOrderVideoTool(ctx).run({ ma_van_don: "VTP999" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("chưa có video");
    expect(result.content).toContain("Không hứa gửi sau");
  });

  test("API vận hành lỗi → báo trục trặc, KHÔNG kể thành 'chưa có video'", async () => {
    const tool = buildOrderVideoTool({ ...ctx, orders: new BrokenOrders() });
    const result = await tool.run({ ma_van_don: "VTP01" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG nói là không tìm thấy");
  });

  test("thiếu mã vận đơn → isError, bảo model chốt đơn trước", async () => {
    const result = await buildOrderVideoTool(ctx).run({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("tra_don_hang");
  });
});

describe("buildToolRegistry", () => {
  test("có đủ whoami + use_skill + use_reference", () => {
    const names = buildToolRegistry(COMMON_TOOLS, { skills, identity: GUEST })
      .schemas()
      .map((s) => s.name)
      .sort();
    expect(names).toEqual(["use_reference", "use_skill", "whoami"]);
  });

  test("KHÔNG schema nào chứa trường danh tính (chống confused-deputy)", () => {
    const forbidden = ["identity", "role", "user_id", "userId", "customer_id", "customerId", "sender_id", "senderId", "dealer_id", "dealerId"];
    const all = [...COMMON_TOOLS, ...ORDER_TOOLS, ...DEALER_TOOLS];
    for (const schema of buildToolRegistry(all, { skills, identity: GUEST }).schemas()) {
      const serialized = JSON.stringify(schema.inputSchema);
      for (const field of forbidden) {
        expect(serialized).not.toContain(field);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tra_ho_so_dai_ly — hồ sơ đại lý. Chốt: đại lý đi vào port là đại lý của PHÒNG, và bậc chưa xếp
// KHÔNG được kể lại thành một mức % nào.
// ─────────────────────────────────────────────────────────────────────────────

class FakeDealer implements DealerPort {
  readonly seen: OrderPrincipal[] = [];
  constructor(private readonly byDealer: Readonly<Record<string, DealerProfile>>) {}

  profile(p: OrderPrincipal): Promise<DealerProfile | null> {
    this.seen.push({ dealerId: p.dealerId, staffId: p.staffId });
    return Promise.resolve(this.byDealer[p.dealerId] ?? null);
  }
}

class BrokenDealer implements DealerPort {
  profile(): Promise<DealerProfile | null> {
    throw new AgentApiError(
      "GET /agent/profile trả 500",
      500,
      AgentApiErrorCode.Transport,
      "/agent/profile",
    );
  }
}

describe("tra_ho_so_dai_ly", () => {
  const dealer = new FakeDealer({
    "dealer-1": {
      code: "DL0123",
      name: "Nguyễn Văn A",
      discountTierName: "F2",
      discountTierLabel: "Đại lý cấp 2",
      discountEffectiveFrom: "2025-06-01",
      joinedAt: "2025-03-11",
      referralLevel: 2,
      isShareholder: false,
      staffName: "Trần C",
      staffPhone: "0900000009",
    },
    "dealer-2": { code: "DL0999", name: "Đại lý mới" },
  });

  test("in tên bậc + ngày hiệu lực, KHÔNG in phần trăm nào", async () => {
    const ctx = { skills, identity: STAFF, roomCustomerId: "dealer-1", dealer };
    const result = await buildDealerProfileTool(ctx).run({});

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("DL0123");
    expect(result.content).toContain("F2 · Đại lý cấp 2");
    expect(result.content).toContain("01/06/2025");
    expect(result.content).toContain("Trần C · 0900000009");
    expect(result.content).not.toMatch(/\d+\s*%/);
    // Nhân viên gõ trong nhóm đại lý X → hồ sơ của X, staffId chỉ để audit.
    expect(dealer.seen.at(-1)).toEqual({ dealerId: "dealer-1", staffId: "77" });
  });

  test("đại lý tự hỏi → lấy customerId của chính họ", async () => {
    const empty = new FakeDealer({});
    const result = await buildDealerProfileTool({ skills, identity: DEALER, dealer: empty }).run({});

    // dealer-9 (identity) không có hồ sơ trong fake → nhánh NO_PROFILE; phạm vi vẫn phải đúng.
    expect(empty.seen).toEqual([{ dealerId: "dealer-9", staffId: undefined }]);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG kết luận gì về mức chiết khấu");
  });

  test("chưa xếp bậc → nói rõ chưa có bậc, cấm suy % từ giá", async () => {
    const ctx = { skills, identity: STAFF, roomCustomerId: "dealer-2", dealer };
    const result = await buildDealerProfileTool(ctx).run({});

    expect(result.content).toContain("CHƯA được xếp bậc");
    expect(result.content).toContain("Không suy ra mức % từ giá đơn hàng");
  });

  test("chưa /ketnoi-daily → isError, không tra bừa", async () => {
    const result = await buildDealerProfileTool({ skills, identity: GUEST, dealer }).run({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("ketnoi-daily");
  });

  test("chưa nối cổng → isError riêng, không nhầm với 'chưa có bậc'", async () => {
    const result = await buildDealerProfileTool({ skills, identity: DEALER }).run({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("chưa sẵn sàng");
  });

  test("API hỏng → báo trục trặc, KHÔNG kể thành 'chưa có bậc chiết khấu'", async () => {
    const ctx = { skills, identity: DEALER, dealer: new BrokenDealer() };
    const result = await buildDealerProfileTool(ctx).run({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG nói là đại lý chưa có bậc");
  });
});
