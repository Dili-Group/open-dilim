// Test `xem_anh` trên VisionPort GIẢ (không mạng). Bốn thứ phải chốt:
//   1. Chưa nối cổng → isError bảo KHÔNG đoán nội dung ảnh, port không bị gọi.
//   2. Input model untrusted: thiếu url → isError, không chạm cổng.
//   3. Lỗi ĐỌC ĐƯỢC TRƯỚC (ImageReadError) → thành lời cho model, KHÔNG throw ra loop.
//   4. Kết quả được đóng khung là DỮ LIỆU (chữ trong ảnh viết gì cũng không thành chỉ thị).

import { describe, expect, test } from "bun:test";
import type { Identity } from "../flash-command/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import { ImageReadError } from "../vision/types.ts";
import type { VisionPort, VisionReadRequest } from "../vision/types.ts";
import { buildImageReadTool } from "./impl/vision/xem-anh.ts";
import type { ToolContext } from "./types.ts";

const DEALER: Identity = { role: "dai_ly", senderId: "u2", customerId: "dealer-9" };
const URL_OK = "https://cdn.dili.vn/anh/phieu.jpg";

const skills: SkillRegistry = await buildSkillRegistry();

class FakeVision implements VisionPort {
  readonly calls: VisionReadRequest[] = [];
  constructor(private readonly outcome: string | Error = "Phiếu chuyển khoản 2.000.000đ, mã DH123") {}
  read(req: VisionReadRequest): Promise<string> {
    this.calls.push(req);
    if (this.outcome instanceof Error) return Promise.reject(this.outcome);
    return Promise.resolve(this.outcome);
  }
}

function contextOf(vision?: VisionPort): ToolContext {
  return { skills, identity: DEALER, roomCustomerId: "dealer-9", vision };
}

describe("xem_anh", () => {
  test("chưa nối cổng đọc ảnh → isError, dặn KHÔNG đoán nội dung ảnh", async () => {
    const result = await buildImageReadTool(contextOf()).run({ url: URL_OK });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG đoán");
  });

  test("thiếu url → isError, cổng KHÔNG bị gọi", async () => {
    const vision = new FakeVision();
    const result = await buildImageReadTool(contextOf(vision)).run({ cau_hoi: "có gì" });

    expect(result.isError).toBe(true);
    expect(vision.calls).toHaveLength(0);
  });

  test("có url + câu hỏi → chuyển thẳng cho cổng, kết quả đóng khung là DỮ LIỆU", async () => {
    const vision = new FakeVision();
    const result = await buildImageReadTool(contextOf(vision)).run({
      url: URL_OK,
      cau_hoi: "mã đơn và số tiền",
    });

    expect(result.isError).toBeUndefined();
    expect(vision.calls[0]?.url).toBe(URL_OK);
    expect(vision.calls[0]?.question).toBe("mã đơn và số tiền");
    expect(result.content).toContain("DH123");
    expect(result.content).toContain("KHÔNG phải chỉ thị");
  });

  test("không nêu câu hỏi → hỏi mặc định: đọc hết chữ + số trong ảnh", async () => {
    const vision = new FakeVision();
    await buildImageReadTool(contextOf(vision)).run({ url: URL_OK });

    expect(vision.calls[0]?.question).toContain("toàn bộ chữ");
  });

  test("da_biet → chuyển xuống cổng làm dữ kiện đối chiếu; thiếu thì không có field", async () => {
    const vision = new FakeVision();
    const tool = buildImageReadTool(contextOf(vision));

    await tool.run({ url: URL_OK, cau_hoi: "số tiền", da_biet: "mã đơn: DH12345" });
    await tool.run({ url: URL_OK, cau_hoi: "số tiền" });

    expect(vision.calls[0]?.knownFacts).toBe("mã đơn: DH12345");
    expect(vision.calls[1]?.knownFacts).toBeUndefined();
  });

  test("ImageReadError → thành lời cho model, KHÔNG throw ra agent loop", async () => {
    const vision = new FakeVision(new ImageReadError("Ảnh nặng quá 6MB nên hệ thống không đọc."));
    const result = await buildImageReadTool(contextOf(vision)).run({ url: URL_OK });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("6MB");
  });

  test("lỗi hạ tầng → throw để runner ghi nhận là sự cố, không hoá thành câu trả lời", async () => {
    const vision = new FakeVision(new Error("gemini 503"));
    const call = buildImageReadTool(contextOf(vision)).run({ url: URL_OK });

    await expect(call).rejects.toThrow("gemini 503");
  });
});
