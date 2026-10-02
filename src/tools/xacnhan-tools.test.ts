// xacnhan-tools.test.ts — tool sổ xác nhận (`ghi_dang_ky`) trên cổng GIẢ (không mạng, không DB).
//
// Thứ phải chốt không phải câu chữ mà là mấy hàng rào:
//   1. Chưa nối cổng / gọi ngoài nhóm → KHÔNG ghi gì, và KHÔNG nói là đã ghi.
//   2. Dòng sổ gắn vào NGƯỜI ĐANG GÕ, kể cả khi model khai tên sale khác.
//   3. Thiếu trường / lý do chung chung / case chưa-hiệu-quả thiếu mục → chặn TẠI TOOL.
//   4. Mã đại lý cạnh STT phải KHỚP hệ vận hành trước khi ghi; sai/thiếu/không tra được → không ghi.
//   5. Ghi hỏng 5xx → không được khẳng định đã ghi, và không tự ghi lại.

import { describe, expect, test } from "bun:test";
import type { Identity } from "../flash-command/types.ts";
import { AgentApiError, AgentApiErrorCode } from "../operational/agent-api.ts";
import type {
  DealerRef,
  NewRegistration,
  OrderConfirmPort,
  PurchaseCheck,
  Registration,
} from "../operational/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import { xacNhanProfile } from "../agents/roots/xac-nhan.ts";
import { buildRegisterConfirmTool } from "./impl/xacnhan/ghi-dang-ky.ts";
import type { ToolContext } from "./types.ts";

const skills: SkillRegistry = await buildSkillRegistry();

/** Sale trong nhóm: phần lớn chưa bind định danh hệ vận hành → guest. */
const SALE: Identity = { role: "guest", senderId: "sale-1" };
const ROOM = { channel: "zalo", groupId: "G-XN" } as const;

/** Tin đăng ký đã bóc trường — đúng ca "chị Trang" trong tin thật. */
const DANG_KY = {
  ten_khach: "chị Trang",
  so_cuoi: "94734",
  tinh_trang: "hay đau nhức mỏi người, mấy nay nổi mẩn như mề đay, khó ngủ",
  san_pham: "2TCC",
  da_chot: true,
  ly_do: "hàng giả nhiều nên sợ không mua đúng của bên mình",
  khung_gio: "12h",
  stt: 8,
  ma_dai_ly: "nvh",
};

function rowOf(over: Partial<Registration> = {}): Registration {
  return {
    id: "uuid-1",
    created: true,
    status: "cho_duyet",
    customerName: "chị Trang",
    phoneLast5: "94734",
    dealerCode: "NVH",
    ...over,
  };
}

/** Đại lý có trong hệ thống giả. Tra không phân biệt hoa thường — như backend thật. */
const KNOWN_DEALERS: readonly DealerRef[] = [{ id: "42", code: "NVH", name: "Đại lý NVH" }];

class FakeConfirm implements OrderConfirmPort {
  readonly registered: NewRegistration[] = [];
  readonly lookedUp: string[] = [];
  constructor(
    private readonly opts: {
      readonly fail?: Error;
      readonly lookupFail?: Error;
      /** false = backend trả yêu cầu cũ đang chờ (gửi trùng). */
      readonly created?: boolean;
      /** Số đơn khách có ở đại lý — 0 = chưa mua. */
      readonly orders?: number;
      readonly purchaseFail?: Error;
    } = {},
  ) {}

  readonly purchaseChecks: { dealerId: string; phone: string }[] = [];

  purchaseCheck(input: { dealerId: string; phone: string }): Promise<PurchaseCheck> {
    this.purchaseChecks.push(input);
    if (this.opts.purchaseFail !== undefined) return Promise.reject(this.opts.purchaseFail);
    const orderCount = this.opts.orders ?? 0;
    return Promise.resolve({ purchased: orderCount > 0, orderCount, lastOrderAt: "2026-08-02T03:00:00Z" });
  }

  findDealer(code: string): Promise<DealerRef | null> {
    this.lookedUp.push(code);
    if (this.opts.lookupFail !== undefined) return Promise.reject(this.opts.lookupFail);
    const upper = code.toUpperCase();
    return Promise.resolve(KNOWN_DEALERS.find((dealer) => dealer.code === upper) ?? null);
  }

  register(input: NewRegistration): Promise<Registration> {
    if (this.opts.fail !== undefined) return Promise.reject(this.opts.fail);
    this.registered.push(input);
    return Promise.resolve(rowOf({ created: this.opts.created ?? true }));
  }
}

function ctxWith(orderConfirm?: OrderConfirmPort): ToolContext {
  return {
    skills,
    identity: SALE,
    agentType: "xac-nhan-don",
    room: ROOM,
    ...(orderConfirm === undefined ? {} : { orderConfirm }),
  };
}

/** Chat 1-1: không có phòng nào sở hữu sổ → mọi tool phải từ chối. */
function ctxNoRoom(orderConfirm: OrderConfirmPort): ToolContext {
  return { skills, identity: SALE, agentType: "xac-nhan-don", orderConfirm };
}

const apiError = (status: number): AgentApiError =>
  new AgentApiError("backend nói gì đó có kèm SĐT khách", status, AgentApiErrorCode.InvalidResponse, "/agent/expert-verifications");

describe("ghi_dang_ky — hàng rào", () => {
  test("chưa nối cổng → không ghi, và nói rõ là CHƯA ghi", async () => {
    const result = await buildRegisterConfirmTool(ctxWith()).run(DANG_KY);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG nói là đã ghi");
  });

  test("gọi ngoài nhóm (chat riêng) → từ chối", async () => {
    const port = new FakeConfirm();
    const result = await buildRegisterConfirmTool(ctxNoRoom(port)).run(DANG_KY);
    expect(result.isError).toBe(true);
    expect(port.registered).toHaveLength(0);
  });

  test("thiếu trường → liệt kê đúng mục thiếu, KHÔNG chạm cổng", async () => {
    const port = new FakeConfirm();
    const result = await buildRegisterConfirmTool(ctxWith(port)).run({
      ...DANG_KY,
      so_cuoi: "",
      khung_gio: "",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("5 số cuối SĐT");
    expect(result.content).toContain("khung giờ");
    expect(result.content).not.toContain("tên khách");
    expect(port.registered).toHaveLength(0);
  });

  test("lý do chung chung → chặn tại tool, không phải chỉ ở prompt", async () => {
    const port = new FakeConfirm();
    const result = await buildRegisterConfirmTool(ctxWith(port)).run({
      ...DANG_KY,
      ly_do: "tư vấn thêm",
    });
    expect(result.isError).toBe(true);
    expect(port.registered).toHaveLength(0);
  });

  test("case chưa hiệu quả thiếu mục → bắt bổ sung đúng 5 mục", async () => {
    const port = new FakeConfirm();
    const result = await buildRegisterConfirmTool(ctxWith(port)).run({
      ...DANG_KY,
      chua_hieu_qua: true,
      tinh_trang_truoc: "đau nhiều",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("số lần đã chăm sóc");
    expect(port.registered).toHaveLength(0);
  });

  test("case chưa hiệu quả đủ 5 mục (khách có đơn) → ghi kèm khối theo dõi", async () => {
    const port = new FakeConfirm({ orders: 1 });
    await buildRegisterConfirmTool(ctxWith(port)).run({
      ...DANG_KY,
      chua_hieu_qua: true,
      tinh_trang_truoc: "đau nhiều",
      tinh_trang_hien_tai: "đỡ ít",
      lieu_trinh_da_dung: "sụn 2 hộp",
      thoi_gian_su_dung: "1 tháng",
      so_lan_cham_soc: "3 lần",
    });
    expect(port.registered[0]?.followUp?.careCount).toBe("3 lần");
  });
});

describe("ghi_dang_ky — đối chiếu mã đại lý", () => {
  test("mã KHÔNG có trong hệ thống → không ghi, báo sale kiểm tra lại mã", async () => {
    const port = new FakeConfirm();
    const result = await buildRegisterConfirmTool(ctxWith(port)).run({ ...DANG_KY, ma_dai_ly: "VĐĐ" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('"VĐĐ" KHÔNG có trong hệ thống');
    expect(port.registered).toHaveLength(0);
  });

  test("thiếu mã → không ghi, KHÔNG gọi tra cứu", async () => {
    const port = new FakeConfirm();
    const result = await buildRegisterConfirmTool(ctxWith(port)).run({ ...DANG_KY, ma_dai_ly: " " });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("thiếu MÃ ĐẠI LÝ");
    expect(port.lookedUp).toHaveLength(0);
    expect(port.registered).toHaveLength(0);
  });

  test("tra mã hỏng → không ghi, và KHÔNG đổ cho sale gõ sai", async () => {
    const port = new FakeConfirm({ lookupFail: apiError(503) });
    const result = await buildRegisterConfirmTool(ctxWith(port)).run(DANG_KY);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG phải sale");
    expect(port.registered).toHaveLength(0);
  });

  test("tin còn thiếu trường → hỏi trường thiếu trước, chưa tốn lượt tra mã", async () => {
    const port = new FakeConfirm();
    await buildRegisterConfirmTool(ctxWith(port)).run({ ...DANG_KY, khung_gio: "" });
    expect(port.lookedUp).toHaveLength(0);
  });
});

// Mục 3 "Đang dùng / Đã dùng" thay vì "Đã tư vấn" → phải có đơn thật (5 số cuối + đại lý).
describe("ghi_dang_ky — khách đang dùng", () => {
  const DANG_DUNG = {
    ...DANG_KY,
    so_cuoi: "86639",
    san_pham: "men nghệ, natto sụn",
    dang_dung: "men nghệ, natto sụn",
  };

  test("có đơn ở đại lý → ghi, note mang bằng chứng đơn", async () => {
    const port = new FakeConfirm({ orders: 2 });
    const result = await buildRegisterConfirmTool(ctxWith(port)).run(DANG_DUNG);
    expect(port.purchaseChecks).toEqual([{ dealerId: "42", phone: "86639" }]);
    expect(port.registered[0]?.inUse).toEqual({
      products: "men nghệ, natto sụn",
      verified: true,
      orderCount: 2,
      lastOrderAt: "2026-08-02T03:00:00Z",
    });
    expect(result.isError).toBeUndefined();
  });

  test("KHÔNG có đơn → CHƯA ghi, hỏi lại sale (sợ gửi nhầm)", async () => {
    const port = new FakeConfirm({ orders: 0 });
    const result = await buildRegisterConfirmTool(ctxWith(port)).run(DANG_DUNG);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG thấy đơn nào của SĐT đuôi 86639 ở đại lý NVH");
    expect(port.registered).toHaveLength(0);
  });

  test("không có đơn nhưng sale đã khẳng định lại → ghi, đánh dấu chưa thấy đơn", async () => {
    const port = new FakeConfirm({ orders: 0 });
    await buildRegisterConfirmTool(ctxWith(port)).run({ ...DANG_DUNG, sale_khang_dinh_da_mua: true });
    expect(port.registered[0]?.inUse).toEqual({ products: "men nghệ, natto sụn", verified: false });
  });

  test("vừa tư vấn món MỚI vừa đang uống món KHÁC → kiểm đơn, giữ tách hai món", async () => {
    // "3. Đã tư vấn: men + nghệ. cô đang uống Rich + DHA"
    const port = new FakeConfirm({ orders: 1 });
    await buildRegisterConfirmTool(ctxWith(port)).run({
      ...DANG_KY,
      da_chot: false,
      san_pham: "men + nghệ",
      dang_dung: "Rich + DHA",
    });
    expect(port.purchaseChecks).toHaveLength(1);
    expect(port.registered[0]?.product).toBe("men + nghệ");
    expect(port.registered[0]?.inUse?.products).toBe("Rich + DHA");
  });

  test("'Đã tư vấn' → KHÔNG kiểm đơn (khách chưa mua là bình thường)", async () => {
    const port = new FakeConfirm({ orders: 0 });
    await buildRegisterConfirmTool(ctxWith(port)).run(DANG_KY);
    expect(port.purchaseChecks).toHaveLength(0);
    expect(port.registered).toHaveLength(1);
  });

  test("case chưa hiệu quả cũng là đã dùng → cũng phải kiểm đơn", async () => {
    const port = new FakeConfirm({ orders: 0 });
    const result = await buildRegisterConfirmTool(ctxWith(port)).run({
      ...DANG_KY,
      chua_hieu_qua: true,
      tinh_trang_truoc: "đau nhiều",
      tinh_trang_hien_tai: "nhức thêm",
      lieu_trinh_da_dung: "sụn",
      thoi_gian_su_dung: "1 tháng",
      so_lan_cham_soc: "2 lần",
    });
    expect(result.isError).toBe(true);
    expect(port.registered).toHaveLength(0);
  });

  test("kiểm đơn lỗi → không ghi, KHÔNG đổ cho sale", async () => {
    const port = new FakeConfirm({ purchaseFail: apiError(503) });
    const result = await buildRegisterConfirmTool(ctxWith(port)).run(DANG_DUNG);
    expect(result.content).toContain("kiểm đơn của khách");
    expect(result.content).toContain("KHÔNG phải sale");
    expect(port.registered).toHaveLength(0);
  });
});

describe("ghi_dang_ky — ghi được", () => {
  test("thread lấy từ PHÒNG ĐANG GÕ, mã đại lý là mã HỆ THỐNG, SĐT giữ nguyên chữ số", async () => {
    const port = new FakeConfirm();
    const result = await buildRegisterConfirmTool(ctxWith(port)).run({
      ...DANG_KY,
      ngay: "2126-09-18",
      ten_sale: "Sale Khác",
    });

    const saved = port.registered[0];
    expect(saved?.threadId).toBe("G-XN");
    expect(saved?.phone).toBe("94734");
    expect(saved?.saleName).toBe("Sale Khác");
    expect(saved?.slot).toBe("trua");
    expect(saved?.stt).toBe(8);
    // Ghi mã HỆ THỐNG lưu ("NVH"), không phải chữ sale gõ ("nvh").
    expect(saved?.dealerCode).toBe("NVH");
    expect(saved?.dealerId).toBe("42");
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("đang chờ bác sĩ duyệt");
    // Backend không cấp số thứ tự → tool cấm model bịa ra.
    expect(result.content).toContain("KHÔNG báo số thứ tự");
  });

  test("gửi trùng khi yêu cầu cũ còn chờ → nói rõ ĐÃ CÓ, không cập nhật nội dung mới", async () => {
    const port = new FakeConfirm({ created: false });
    const result = await buildRegisterConfirmTool(ctxWith(port)).run(DANG_KY);
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("ĐÃ CÓ yêu cầu");
    expect(result.content).toContain("KHÔNG cập nhật");
  });

  test("ngày đã qua → vẫn GHI, chỉ đánh dấu xếp sau (không mất dòng sổ)", async () => {
    const port = new FakeConfirm();
    const result = await buildRegisterConfirmTool(ctxWith(port)).run({
      ...DANG_KY,
      ngay: "2020-01-06",
    });
    expect(port.registered[0]?.onTime).toBe(false);
    expect(result.content).toContain("xếp sau");
  });

  test("ngày sai định dạng → hỏi lại, không đoán", async () => {
    const port = new FakeConfirm();
    const result = await buildRegisterConfirmTool(ctxWith(port)).run({ ...DANG_KY, ngay: "18/9" });
    expect(result.isError).toBe(true);
    expect(port.registered).toHaveLength(0);
  });

  test("backend 4xx → nói thẳng chưa ghi; 5xx → không khẳng định, không ghi lại", async () => {
    const four = await buildRegisterConfirmTool(ctxWith(new FakeConfirm({ fail: apiError(400) }))).run(DANG_KY);
    expect(four.isError).toBe(true);
    expect(four.content).toContain("CHƯA ghi được");

    const five = await buildRegisterConfirmTool(ctxWith(new FakeConfirm({ fail: apiError(503) }))).run(DANG_KY);
    expect(five.isError).toBe(true);
    expect(five.content).toContain("KHÔNG gọi lại tool");
    // Không in nội dung lỗi backend ra cho model: body đó có tên khách + số điện thoại.
    expect(five.content).not.toContain("SĐT khách");
  });

  test("lỗi KHÔNG phải HTTP thì ném tiếp, không nuốt thành câu êm tai", () => {
    const tool = buildRegisterConfirmTool(ctxWith(new FakeConfirm({ fail: new Error("bug") })));
    expect(tool.run(DANG_KY)).rejects.toThrow("bug");
  });
});

describe("profile agent xác nhận", () => {
  test("CHỈ ghi đăng ký: không đọc hàng đợi, không ghi kết quả, không tổng hợp, không tool đại lý", () => {
    const names = xacNhanProfile.tools.map((factory) => factory(ctxWith()).name);
    expect(names).toContain("ghi_dang_ky");
    for (const forbidden of [
      "xem_hang_doi",
      "chot_ket_qua",
      "tong_hop_ngay",
      "tra_don_hang",
      "tra_tien_can_chuyen",
      "ho_so_dai_ly",
      "tra_lich_su_vi",
      "xem_anh",
      "doc_file",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });
});
