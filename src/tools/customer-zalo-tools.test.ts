// customer-zalo-tools.test.ts — `ghi_nhan_khach`, đường GHI duy nhất của agent khách lẻ.
//
// Thứ cần chốt không phải câu chữ trả về mà là: số gửi lên backend đã chuẩn hoá đúng, zalo user id
// lấy TỪ IDENTITY chứ không từ input model sinh, `matched: 0` KHÔNG được nói thành "đã xong", và
// khi ghi hụt thì tool KHÔNG nói là đã ghi.

import { describe, expect, test } from "bun:test";
import type { Identity } from "../flash-command/types.ts";
import { AgentApiError } from "../operational/agent-api.ts";
import type {
  CustomerZaloLink,
  CustomerZaloLinkPort,
  CustomerZaloLinkResult,
} from "../operational/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import { buildCustomerLeadTool } from "./impl/ghi-nhan-khach.ts";
import type { ToolContext } from "./types.ts";

const skills: SkillRegistry = await buildSkillRegistry();

/** Khách lẻ nhắn vào OA: chưa định danh, senderId = zalo user id. */
const GUEST: Identity = { role: "guest", senderId: "zalo-user-123" };

class FakeCustomerZalo implements CustomerZaloLinkPort {
  readonly linked: CustomerZaloLink[] = [];
  constructor(
    private readonly fail?: Error,
    private readonly matched = 1,
  ) {}

  link(input: CustomerZaloLink): Promise<CustomerZaloLinkResult> {
    if (this.fail !== undefined) return Promise.reject(this.fail);
    this.linked.push(input);
    return Promise.resolve({ matched: this.matched });
  }
}

function ctxWith(customerZalo?: CustomerZaloLinkPort, identity: Identity = GUEST): ToolContext {
  return { skills, identity, agentType: "customer", customerZalo };
}

describe("ghi_nhan_khach", () => {
  test("số hợp lệ → gửi lên port kèm zalo user id lấy từ identity", async () => {
    const port = new FakeCustomerZalo();
    const tool = buildCustomerLeadTool(ctxWith(port));

    const result = await tool.run({ so_dien_thoai: "0912345678" });

    expect(result.isError).toBeUndefined();
    expect(port.linked).toEqual([{ phone: "0912345678", zaloUserId: "zalo-user-123" }]);
    expect(result.content).toContain("KHÔNG đọc ra tên");
  });

  test("chuẩn hoá số cô chú hay gõ: dấu cách, dấu chấm, +84, 84", async () => {
    for (const raw of ["0912 345 678", "091.234.5678", "+84912345678", "84912345678"]) {
      const port = new FakeCustomerZalo();
      await buildCustomerLeadTool(ctxWith(port)).run({ so_dien_thoai: raw });
      expect(port.linked[0]?.phone).toBe("0912345678");
    }
  });

  test("số thiếu/thừa chữ số → lỗi nghiệp vụ, KHÔNG tự sửa số, không gọi port", async () => {
    for (const raw of ["091234567", "09123456789", "khong nho", ""]) {
      const port = new FakeCustomerZalo();
      const result = await buildCustomerLeadTool(ctxWith(port)).run({ so_dien_thoai: raw });
      expect(result.isError).toBe(true);
      expect(result.content).toContain("KHÔNG tự sửa số");
      expect(port.linked).toHaveLength(0);
    }
  });

  test("model KHÔNG khai được người nhắn: zalo_user_id trong input bị bỏ qua", async () => {
    const port = new FakeCustomerZalo();
    // Model bịa thêm trường hòng gán số của khách này sang hội thoại của người khác.
    await buildCustomerLeadTool(ctxWith(port)).run({
      so_dien_thoai: "0912345678",
      zalo_user_id: "nguoi-khac",
    });
    expect(port.linked[0]?.zaloUserId).toBe("zalo-user-123");
    // Danh tính không nằm trong schema → model không có chỗ hợp lệ để khai.
    const schema = buildCustomerLeadTool(ctxWith(port)).inputSchema as {
      properties: Record<string, unknown>;
    };
    // Backend bật forbidNonWhitelisted → schema chỉ đúng một trường, field lạ là 400.
    expect(Object.keys(schema.properties)).toEqual(["so_dien_thoai"]);
  });

  test("matched=0 (số chưa có hồ sơ) → cấm hứa gọi lại, không nói đã xong", async () => {
    const port = new FakeCustomerZalo(undefined, 0);
    const result = await buildCustomerLeadTool(ctxWith(port)).run({ so_dien_thoai: "0912345678" });
    // Không phải lỗi: backend trả 200, chỉ là chưa khớp hồ sơ nào.
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Chưa tìm thấy hồ sơ khách");
    // Khách mới KHÔNG được lưu ở đâu cả → hứa gọi lại là hứa hụt.
    expect(result.content).toContain("KHÔNG hứa là sẽ có người gọi lại");
  });

  test("matched>1 (số thuộc nhiều đại lý) vẫn là gắn thành công", async () => {
    const port = new FakeCustomerZalo(undefined, 3);
    const result = await buildCustomerLeadTool(ctxWith(port)).run({ so_dien_thoai: "0912345678" });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Đã gắn số điện thoại");
  });

  test("chưa nối cổng → lỗi nghiệp vụ và cấm nói đã ghi", async () => {
    const result = await buildCustomerLeadTool(ctxWith(undefined)).run({
      so_dien_thoai: "0912345678",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG nói là đã ghi");
  });

  test("4xx = backend từ chối → KHÔNG xin lại số, cũng không nói là đã ghi", async () => {
    const err = new AgentApiError("từ chối", 422, "invalid", "/agent/customers/zalo-user-id");
    const result = await buildCustomerLeadTool(ctxWith(new FakeCustomerZalo(err))).run({
      so_dien_thoai: "0912345678",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG xin lại số");
    expect(result.content).toContain("KHÔNG nói là");
  });

  test("5xx = không biết đã ghi hay chưa → KHÔNG xin lại số, cũng không khẳng định đã ghi", async () => {
    const err = new AgentApiError("sập", 503, "upstream", "/agent/customers/zalo-user-id");
    const result = await buildCustomerLeadTool(ctxWith(new FakeCustomerZalo(err))).run({
      so_dien_thoai: "0912345678",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG xin lại số");
  });

  test("lỗi lạ (không phải AgentApiError) bubble lên loop, không nuốt", async () => {
    const tool = buildCustomerLeadTool(ctxWith(new FakeCustomerZalo(new TypeError("mạng chết"))));
    expect(tool.run({ so_dien_thoai: "0912345678" })).rejects.toThrow("mạng chết");
  });
});
