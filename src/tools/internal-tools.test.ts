// Test ba tool sổ nội bộ trên InternalOrdersPort GIẢ (không mạng). Bốn thứ phải chốt:
//   1. Hàng rào: chỉ nhân viên gọi được — đại lý/guest KHÔNG chạm được dữ liệu toàn hệ thống.
//   2. staffId đi lên port là id lấy từ identity server-side, không phải tham số LLM sinh.
//   3. Ngày: input model là untrusted — ngày rác/không tồn tại phải ra isError, không lên query.
//   4. Tổng in ra là `meta.total_items` (cả ngày), KHÔNG phải số dòng của trang đang xem.

import { describe, expect, test } from "bun:test";
import type { Identity } from "../flash-command/types.ts";
import { AgentApiError, AgentApiErrorCode } from "../operational/agent-api.ts";
import type {
  InternalDailyPage,
  InternalDailyQuery,
  InternalOrdersPort,
  InternalValidateRequest,
  InternalValidateResult,
} from "../operational/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import {
  buildInternalInvoicedOrdersTool,
  buildInternalShippedOrdersTool,
  buildInternalUninvoicedOrdersTool,
  parseDate,
} from "./impl/internal/daily-orders.ts";
import { buildValidateOrdersTool } from "./impl/internal/validate-orders.ts";
import { todayInVietnam } from "./impl/order/scope.ts";
import type { ToolContext } from "./types.ts";

const GUEST: Identity = { role: "guest", senderId: "u1" };
const DEALER: Identity = { role: "dai_ly", senderId: "u2", customerId: "dealer-9" };
const STAFF: Identity = { role: "nhan_vien", senderId: "u3", userId: "77" };
/** Bind cũ/hỏng: `accounts.id` là bigint, chuỗi không phải số thuần = chưa biết ai. */
const STAFF_BAD_ID: Identity = { role: "nhan_vien", senderId: "u4", userId: "uuid-abc" };

const skills: SkillRegistry = await buildSkillRegistry();

const PAGE: InternalDailyPage = {
  meta: { date: "2026-08-08", page: 1, pageSize: 20, totalItems: 137, totalPages: 7 },
  lines: [
    {
      trackingNumber: "SPX123456789",
      dealerCode: "DL0042",
      dealerName: "Đại lý Minh Anh",
      shippedAt: "2026-08-08T02:14:31.000Z",
      voucherCode: "PXK-2026-08-0417",
      misaVoucherId: "a3f1c9e2",
      misaSyncAt: "2026-08-08T02:20:07.000Z",
      invoiced: true,
    },
    {
      trackingNumber: "SPX987654321",
      dealerCode: "DL0007",
      shippedAt: "2026-08-08T03:01:00.000Z",
      invoiced: false,
    },
  ],
};

/** Kết quả validate đủ cả năm nhóm — mỗi test render chỉ cần soi phần nó quan tâm. */
const VALIDATE_RESULT: InternalValidateResult = {
  validated: 2,
  alreadyValidated: 1,
  rejected: [{ trackingNumber: "SPX000000005", status: 5 }],
  notFound: ["SPX000000404"],
  excluded: [{ trackingNumber: "SPX000000004", reason: "excluded_sku" }],
};

class FakeInternal implements InternalOrdersPort {
  readonly seen: InternalDailyQuery[] = [];
  readonly validated: InternalValidateRequest[] = [];
  constructor(
    private readonly page: InternalDailyPage = PAGE,
    private readonly failCode?: string,
    private readonly validateResult: InternalValidateResult = VALIDATE_RESULT,
  ) {}

  validateOrders(r: InternalValidateRequest): Promise<InternalValidateResult> {
    this.validated.push(r);
    if (this.failCode !== undefined) {
      return Promise.reject(
        new AgentApiError(
          "POST /agent/internal/orders/validate lỗi",
          500,
          this.failCode,
          "/agent/internal/orders/validate",
        ),
      );
    }
    return Promise.resolve(this.validateResult);
  }

  shippedOrders(q: InternalDailyQuery): Promise<InternalDailyPage> {
    return this.answer("shipped-orders", q);
  }
  invoicedOrders(q: InternalDailyQuery): Promise<InternalDailyPage> {
    return this.answer("invoiced-orders", q);
  }
  uninvoicedOrders(q: InternalDailyQuery): Promise<InternalDailyPage> {
    return this.answer("uninvoiced-orders", q);
  }

  private answer(section: string, q: InternalDailyQuery): Promise<InternalDailyPage> {
    this.seen.push(q);
    if (this.failCode !== undefined) {
      return Promise.reject(
        new AgentApiError(
          `GET /agent/internal/daily/${section} lỗi`,
          this.failCode === AgentApiErrorCode.InvalidDate ? 400 : 500,
          this.failCode,
          `/agent/internal/daily/${section}`,
        ),
      );
    }
    return Promise.resolve(this.page);
  }
}

function ctxOf(identity: Identity, internal?: InternalOrdersPort): ToolContext {
  return { skills, identity, internal, roomCustomerId: "dealer-1" };
}

describe("hàng rào: dữ liệu toàn hệ thống chỉ mở cho nhân viên", () => {
  test("đại lý gọi > từ chối, KHÔNG gọi port", async () => {
    const port = new FakeInternal();
    const result = await buildInternalShippedOrdersTool(ctxOf(DEALER, port)).run({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Chỉ nhân viên");
    expect(port.seen).toHaveLength(0);
  });

  test("guest gọi > từ chối, KHÔNG gọi port", async () => {
    const port = new FakeInternal();
    const result = await buildInternalInvoicedOrdersTool(ctxOf(GUEST, port)).run({});
    expect(result.isError).toBe(true);
    expect(port.seen).toHaveLength(0);
  });

  test("nhân viên bind hỏng (userId không phải số) > từ chối, KHÔNG gửi rác lên header", async () => {
    const port = new FakeInternal();
    const result = await buildInternalShippedOrdersTool(ctxOf(STAFF_BAD_ID, port)).run({});
    expect(result.isError).toBe(true);
    expect(port.seen).toHaveLength(0);
  });

  test("chưa nối cổng > lỗi nghiệp vụ, không throw", async () => {
    const result = await buildInternalShippedOrdersTool(ctxOf(STAFF)).run({});
    expect(result.isError).toBe(true);
  });
});

describe("tham số lên port", () => {
  test("staffId lấy từ identity, ngày bỏ trống = hôm nay giờ VN", async () => {
    const port = new FakeInternal();
    const result = await buildInternalShippedOrdersTool(ctxOf(STAFF, port)).run({});
    expect(result.isError).toBeUndefined();
    expect(port.seen[0]).toMatchObject({ staffId: "77", date: todayInVietnam(), page: 1 });
  });

  test("ngày dd/mm/yyyy chuẩn hoá về ISO, trang giữ nguyên", async () => {
    const port = new FakeInternal();
    await buildInternalUninvoicedOrdersTool(ctxOf(STAFF, port)).run({ ngay: "08/08/2026", trang: 3 });
    expect(port.seen[0]).toMatchObject({ date: "2026-08-08", page: 3 });
  });

  test("ngày không tồn tại > isError, KHÔNG gọi port", async () => {
    const port = new FakeInternal();
    const result = await buildInternalShippedOrdersTool(ctxOf(STAFF, port)).run({ ngay: "31/02/2026" });
    expect(result.isError).toBe(true);
    expect(port.seen).toHaveLength(0);
  });

  test("trang âm bị kéo về 1", async () => {
    const port = new FakeInternal();
    await buildInternalShippedOrdersTool(ctxOf(STAFF, port)).run({ trang: -5 });
    expect(port.seen[0]?.page).toBe(1);
  });

  test("parseDate nhận cả ISO lẫn dd-mm-yyyy, từ chối rác", () => {
    expect(parseDate("2026-08-08")).toBe("2026-08-08");
    expect(parseDate("8-8-2026")).toBe("2026-08-08");
    expect(parseDate("hôm kia")).toBeUndefined();
  });
});

describe("render", () => {
  test("tổng in ra là tổng CẢ NGÀY, không phải số dòng trang này", async () => {
    const port = new FakeInternal();
    const result = await buildInternalShippedOrdersTool(ctxOf(STAFF, port)).run({});
    expect(result.content).toContain("137 đơn");
    expect(result.content).not.toContain("2 đơn");
  });

  test("mục xuất kho in cờ đã/chưa hoá đơn và thiếu phiếu xuất kho", async () => {
    const result = await buildInternalShippedOrdersTool(ctxOf(STAFF, new FakeInternal())).run({});
    expect(result.content).toContain("SPX123456789");
    expect(result.content).toContain("DL0042 Đại lý Minh Anh");
    expect(result.content).toContain("đã hoá đơn");
    expect(result.content).toContain("chưa hoá đơn");
    expect(result.content).toContain("chưa có phiếu xuất kho");
  });

  test("còn trang > nhắc gọi lại trang sau, không tự kéo hết", async () => {
    const result = await buildInternalInvoicedOrdersTool(ctxOf(STAFF, new FakeInternal())).run({});
    expect(result.content).toContain("trang 1/7");
    expect(result.content).toContain("trang 2");
  });

  test("mọi kết quả nhắc mốc ngày xuất kho + phạm vi toàn hệ thống", async () => {
    const result = await buildInternalShippedOrdersTool(ctxOf(STAFF, new FakeInternal())).run({});
    expect(result.content).toContain("NGÀY XUẤT KHO");
    expect(result.content).toContain("TOÀN HỆ THỐNG");
  });

  test("trang rỗng nói rõ là không có đơn, không im lặng", async () => {
    const empty: InternalDailyPage = { meta: { totalItems: 0, page: 1, totalPages: 1 }, lines: [] };
    const result = await buildInternalUninvoicedOrdersTool(
      ctxOf(STAFF, new FakeInternal(empty)),
    ).run({});
    expect(result.content).toContain("không có đơn nào");
    expect(result.content).toContain("0 đơn");
  });

  test("backend không trả tổng > nói chưa kết luận được, KHÔNG đếm dòng thay", async () => {
    const noTotal: InternalDailyPage = { meta: { page: 1, totalPages: 1 }, lines: PAGE.lines };
    const result = await buildInternalShippedOrdersTool(ctxOf(STAFF, new FakeInternal(noTotal))).run(
      {},
    );
    expect(result.content).toContain("chưa kết luận được");
  });
});

describe("lỗi từ API vận hành", () => {
  test("ngày backend chê > hỏi lại ngày", async () => {
    const port = new FakeInternal(PAGE, AgentApiErrorCode.InvalidDate);
    const result = await buildInternalShippedOrdersTool(ctxOf(STAFF, port)).run({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Ngày không hợp lệ");
  });

  test("backend lỗi > nói rõ hệ thống lỗi, KHÔNG kể thành 0 đơn", async () => {
    const port = new FakeInternal(PAGE, AgentApiErrorCode.Transport);
    const result = await buildInternalUninvoicedOrdersTool(ctxOf(STAFF, port)).run({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("không phản hồi");
  });
});

describe("duyet_don_qua_kho — lệnh GHI validate đơn qua kho", () => {
  test("đại lý/guest gọi > từ chối, KHÔNG chạm port", async () => {
    const port = new FakeInternal();
    for (const identity of [DEALER, GUEST]) {
      const result = await buildValidateOrdersTool(ctxOf(identity, port)).run({
        ma_van_don: ["SPX1"],
      });
      expect(result.isError).toBe(true);
    }
    expect(port.validated).toHaveLength(0);
  });

  test("nhân viên bind hỏng (userId không phải số) > VẪN gọi được, chỉ mất audit staffId", async () => {
    const port = new FakeInternal();
    const result = await buildValidateOrdersTool(ctxOf(STAFF_BAD_ID, port)).run({
      ma_van_don: ["SPX1"],
    });
    expect(result.isError).toBeUndefined();
    expect(port.validated[0]?.staffId).toBeUndefined();
  });

  test("chưa nối cổng > lỗi nghiệp vụ, không throw", async () => {
    const result = await buildValidateOrdersTool(ctxOf(STAFF)).run({ ma_van_don: ["SPX1"] });
    expect(result.isError).toBe(true);
  });

  test("staffId lên port là id từ identity, danh sách mã giữ nguyên văn", async () => {
    const port = new FakeInternal();
    const result = await buildValidateOrdersTool(ctxOf(STAFF, port)).run({
      ma_van_don: ["S12345678", "S12345679"],
    });
    expect(result.isError).toBeUndefined();
    expect(port.validated[0]).toMatchObject({
      staffId: "77",
      trackingNumbers: ["S12345678", "S12345679"],
    });
  });

  test("danh sách thiếu / rỗng / có phần tử rác > isError, KHÔNG gọi port", async () => {
    const port = new FakeInternal();
    for (const input of [{}, { ma_van_don: [] }, { ma_van_don: ["SPX1", 7] }, { ma_van_don: "SPX1" }]) {
      const result = await buildValidateOrdersTool(ctxOf(STAFF, port)).run(input);
      expect(result.isError).toBe(true);
    }
    expect(port.validated).toHaveLength(0);
  });

  test("quá 200 mã > chặn ở tool, bảo chia lô, KHÔNG gọi port", async () => {
    const port = new FakeInternal();
    const result = await buildValidateOrdersTool(ctxOf(STAFF, port)).run({
      ma_van_don: Array.from({ length: 201 }, (_, i) => `SPX${i}`),
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("tối đa 200");
    expect(port.validated).toHaveLength(0);
  });

  test("render đủ năm nhóm: duyệt mới, duyệt trước, từ chối kèm trạng thái, không thấy, bị loại", async () => {
    const result = await buildValidateOrdersTool(ctxOf(STAFF, new FakeInternal())).run({
      ma_van_don: ["S1"],
    });
    expect(result.content).toContain("2 đơn");
    expect(result.content).toContain("Đã duyệt từ trước");
    expect(result.content).toContain("SPX000000005");
    expect(result.content).toContain("SPX000000404");
    expect(result.content).toContain("excluded_sku");
  });

  test("backend không trả số validated > nói hệ thống không trả số, KHÔNG bịa 0", async () => {
    const noCount: InternalValidateResult = { rejected: [], notFound: [], excluded: [] };
    const result = await buildValidateOrdersTool(
      ctxOf(STAFF, new FakeInternal(PAGE, undefined, noCount)),
    ).run({ ma_van_don: ["S1"] });
    expect(result.content).toContain("hệ thống không trả số");
  });

  test("API lỗi > báo trạng thái LỬNG (không rõ đã ghi chưa), cấm tự gửi lại", async () => {
    const port = new FakeInternal(PAGE, AgentApiErrorCode.Transport);
    const result = await buildValidateOrdersTool(ctxOf(STAFF, port)).run({ ma_van_don: ["S1"] });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG RÕ");
  });
});
