// Test tool use_skill / use_reference: chạy trên skill def THẬT (đọc filesystem), input model
// sinh là untrusted nên mọi shape rác phải ra isError chứ không throw. Kèm chốt chặn
// confused-deputy: KHÔNG schema tool nào được chứa trường danh tính.

import { describe, expect, test } from "bun:test";
import type { Identity } from "../flash-command/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import { OrderStatus, type OrderInfo, type OrderPort } from "../operational/types.ts";
import { COMMON_TOOLS, ORDER_TOOLS, buildToolRegistry, readStringField } from "./index.ts";
import { buildUseSkillTool } from "./impl/use-skill.ts";
import { buildUseReferenceTool } from "./impl/use-reference.ts";
import { buildOrderStatusTool } from "./impl/order-status.ts";

const GUEST: Identity = { role: "guest", senderId: "u1" };
const DEALER: Identity = { role: "dai_ly", senderId: "u2", customerId: "dealer-9" };

// Registry thật từ src/skills/defs (có "refund" kèm references/policy.md).
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

describe("use_skill", () => {
  const tool = buildUseSkillTool(skills);

  test("skill có thật → trả body + liệt kê reference", async () => {
    const result = await tool.run({ name: "refund" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("# Skill: refund");
    expect(result.content).toContain("use_reference");
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
    const result = await tool.run({ skill: "refund", reference: "policy.md" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("refund / policy.md");
  });

  test("path traversal → isError, KHÔNG throw ra loop", async () => {
    const result = await tool.run({ skill: "refund", reference: "../SKILL.md" });
    expect(result.isError).toBe(true);
  });

  test("thiếu tham số → isError", async () => {
    expect((await tool.run({ skill: "refund" })).isError).toBe(true);
  });
});

// Cổng đơn giả: chỉ đại lý "dealer-1" có đơn. Dùng để chốt phạm vi — tra mã của đại lý khác
// phải ra rỗng, không phải ra đơn.
function makeOrder(over: Partial<OrderInfo> = {}): OrderInfo {
  return {
    code: "DH-1",
    customerId: "dealer-1",
    status: OrderStatus.DangGiao,
    placedAt: Date.UTC(2026, 7, 1, 3, 0),
    expectedDeliveryAt: Date.UTC(2026, 7, 4, 3, 0),
    totalAmount: 1_200_000,
    carrier: "Viettel Post",
    trackingCode: "VTP01",
    ...over,
  };
}

class FakeOrders implements OrderPort {
  readonly seen: Array<{ customerId: string; code?: string }> = [];
  constructor(private readonly orders: readonly OrderInfo[]) {}
  findByCode(p: { customerId: string; code: string }): Promise<OrderInfo | null> {
    this.seen.push(p);
    const found = this.orders.find(
      (o) => o.customerId === p.customerId && o.code.toLowerCase() === p.code.toLowerCase(),
    );
    return Promise.resolve(found ?? null);
  }
  recent(p: { customerId: string; limit: number }): Promise<readonly OrderInfo[]> {
    this.seen.push({ customerId: p.customerId });
    return Promise.resolve(this.orders.filter((o) => o.customerId === p.customerId).slice(0, p.limit));
  }
}

describe("tra_don_hang", () => {
  const orders = new FakeOrders([makeOrder(), makeOrder({ code: "DH-2", customerId: "dealer-2" })]);

  test("có mã đơn của CHỦ PHÒNG → trả chi tiết đơn", async () => {
    const tool = buildOrderStatusTool({ skills, identity: GUEST, roomCustomerId: "dealer-1", orders });
    const result = await tool.run({ ma_don: "dh-1" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Đơn DH-1");
    expect(result.content).toContain("đang giao");
    expect(result.content).toContain("VTP01");
  });

  test("mã đơn của đại lý KHÁC → không tìm thấy (không rò dữ liệu)", async () => {
    const tool = buildOrderStatusTool({ skills, identity: GUEST, roomCustomerId: "dealer-1", orders });
    const result = await tool.run({ ma_don: "DH-2" });
    expect(result.content).toContain("Không có đơn nào");
    expect(result.content).not.toContain("dealer-2");
  });

  test("thiếu mã đơn → liệt kê đơn gần đây + nhắc hỏi lại", async () => {
    const tool = buildOrderStatusTool({ skills, identity: GUEST, roomCustomerId: "dealer-1", orders });
    const result = await tool.run({});
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("DH-1");
    expect(result.content).toContain("Hỏi lại khách");
  });

  test("chat 1-1 (không có chủ phòng) → dùng customerId của identity đại lý", async () => {
    const own = new FakeOrders([makeOrder({ code: "DH-9", customerId: "dealer-9" })]);
    const tool = buildOrderStatusTool({ skills, identity: DEALER, orders: own });
    expect((await tool.run({ ma_don: "DH-9" })).content).toContain("Đơn DH-9");
    expect(own.seen[0]?.customerId).toBe("dealer-9");
  });

  test("không xác định được đại lý → isError, KHÔNG tra bừa", async () => {
    const untouched = new FakeOrders([makeOrder()]);
    const tool = buildOrderStatusTool({ skills, identity: GUEST, orders: untouched });
    const result = await tool.run({ ma_don: "DH-1" });
    expect(result.isError).toBe(true);
    expect(untouched.seen).toHaveLength(0);
  });

  test("chưa nối cổng đơn → isError structured, KHÔNG throw", async () => {
    const tool = buildOrderStatusTool({ skills, identity: GUEST, roomCustomerId: "dealer-1" });
    expect((await tool.run({ ma_don: "DH-1" })).isError).toBe(true);
  });

  test("khai announce để loop báo khách trước khi tra", () => {
    const tool = buildOrderStatusTool({ skills, identity: GUEST, roomCustomerId: "dealer-1", orders });
    expect(tool.announce).toContain("kiểm tra");
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
    const forbidden = ["identity", "role", "user_id", "userId", "customer_id", "customerId", "sender_id", "senderId"];
    const all = [...COMMON_TOOLS, ...ORDER_TOOLS];
    for (const schema of buildToolRegistry(all, { skills, identity: GUEST }).schemas()) {
      const serialized = JSON.stringify(schema.inputSchema);
      for (const field of forbidden) {
        expect(serialized).not.toContain(field);
      }
    }
  });
});
