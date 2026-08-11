// Test CdnImageVision: hàng rào TRƯỚC khi chạm mạng và trần lúc tải. fetch + VisionReader giả,
// không mạng thật. Bốn thứ phải chốt:
//   1. Host ngoài allowlist → KHÔNG có request nào được gửi đi (SSRF).
//   2. Redirect không được đi theo (host đã duyệt mà 302 sang chỗ khác là vô hiệu allowlist).
//   3. Trần dung lượng cắt theo LUỒNG, không tin content-length.
//   4. MIME ngoài bộ đọc được → báo lỗi nghiệp vụ, KHÔNG gửi bytes lên model.

import { describe, expect, test } from "bun:test";
import type { VisionReader, VisionRequest } from "../llm/types.ts";
import { CdnImageVision } from "./image-vision.ts";
import { ImageReadError } from "./types.ts";

const HOSTS = ["cdn.dili.vn"] as const;
const URL_OK = "https://cdn.dili.vn/anh/phieu.jpg";
const QUESTION = "trong ảnh có gì";

class FakeReader implements VisionReader {
  readonly name = "fake";
  readonly calls: VisionRequest[] = [];
  constructor(private readonly answer = "phiếu chuyển khoản 2.000.000đ") {}
  describe(req: VisionRequest): Promise<string> {
    this.calls.push(req);
    return Promise.resolve(this.answer);
  }
}

/** fetch giả: ghi lại URL đã gọi, trả response dựng sẵn. */
function fakeFetch(response: Response | (() => Response)) {
  const calls: string[] = [];
  const impl = ((input: Parameters<typeof fetch>[0]): Promise<Response> => {
    calls.push(input instanceof Request ? input.url : input.toString());
    return Promise.resolve(typeof response === "function" ? response() : response);
  }) as typeof fetch;
  return { impl, calls };
}

function imageResponse(bytes: Uint8Array, contentType = "image/jpeg"): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": contentType } });
}

describe("CdnImageVision — hàng rào trước khi tải", () => {
  test("host ngoài allowlist → lỗi nghiệp vụ, KHÔNG gửi request nào", async () => {
    const fetchStub = fakeFetch(imageResponse(new Uint8Array([1, 2, 3])));
    const vision = new CdnImageVision(new FakeReader(), HOSTS, fetchStub.impl);

    const call = vision.read({ url: "http://169.254.169.254/latest/meta-data", question: QUESTION });

    await expect(call).rejects.toBeInstanceOf(ImageReadError);
    expect(fetchStub.calls).toHaveLength(0);
  });

  test("subdomain của host đã duyệt → cho qua", async () => {
    const fetchStub = fakeFetch(imageResponse(new Uint8Array([1, 2, 3])));
    const vision = new CdnImageVision(new FakeReader(), HOSTS, fetchStub.impl);

    const text = await vision.read({
      url: "https://img.cdn.dili.vn/a/b.jpg",
      question: QUESTION,
    });

    expect(text).toContain("phiếu chuyển khoản");
    expect(fetchStub.calls).toHaveLength(1);
  });

  test("allowlist rỗng → không link nào tải được (fail-closed)", async () => {
    const fetchStub = fakeFetch(imageResponse(new Uint8Array([1])));
    const vision = new CdnImageVision(new FakeReader(), [], fetchStub.impl);

    await expect(vision.read({ url: URL_OK, question: QUESTION })).rejects.toBeInstanceOf(
      ImageReadError,
    );
    expect(fetchStub.calls).toHaveLength(0);
  });

  test("giao thức lạ (file://) → lỗi, không chạm mạng", async () => {
    const fetchStub = fakeFetch(imageResponse(new Uint8Array([1])));
    const vision = new CdnImageVision(new FakeReader(), HOSTS, fetchStub.impl);

    await expect(
      vision.read({ url: "file:///etc/passwd", question: QUESTION }),
    ).rejects.toBeInstanceOf(ImageReadError);
    expect(fetchStub.calls).toHaveLength(0);
  });
});

describe("CdnImageVision — lúc tải", () => {
  test("redirect KHÔNG đi theo → lỗi nghiệp vụ", async () => {
    const redirect = new Response(null, { status: 302, headers: { location: "http://10.0.0.1/" } });
    const vision = new CdnImageVision(new FakeReader(), HOSTS, fakeFetch(redirect).impl);

    await expect(vision.read({ url: URL_OK, question: QUESTION })).rejects.toBeInstanceOf(
      ImageReadError,
    );
  });

  test("link chết (404) → lỗi nghiệp vụ, không throw ra ngoài dạng lỗi hạ tầng", async () => {
    const vision = new CdnImageVision(
      new FakeReader(),
      HOSTS,
      fakeFetch(new Response("no", { status: 404 })).impl,
    );

    await expect(vision.read({ url: URL_OK, question: QUESTION })).rejects.toBeInstanceOf(
      ImageReadError,
    );
  });

  test("MIME ngoài bộ đọc được (pdf) → lỗi, model KHÔNG bị gọi", async () => {
    const reader = new FakeReader();
    const vision = new CdnImageVision(
      reader,
      HOSTS,
      fakeFetch(imageResponse(new Uint8Array([1, 2]), "application/pdf")).impl,
    );

    await expect(vision.read({ url: URL_OK, question: QUESTION })).rejects.toBeInstanceOf(
      ImageReadError,
    );
    expect(reader.calls).toHaveLength(0);
  });

  test("ảnh vượt trần dung lượng → cắt theo luồng, model KHÔNG bị gọi", async () => {
    const reader = new FakeReader();
    // content-length nói dối 1KB, thân thật 7MB → chỉ đọc theo luồng mới bắt được.
    const huge = new Uint8Array(7 * 1024 * 1024);
    const response = new Response(huge, {
      status: 200,
      headers: { "content-type": "image/png", "content-length": "1024" },
    });
    const vision = new CdnImageVision(reader, HOSTS, fakeFetch(response).impl);

    await expect(vision.read({ url: URL_OK, question: QUESTION })).rejects.toBeInstanceOf(
      ImageReadError,
    );
    expect(reader.calls).toHaveLength(0);
  });

  test("ảnh hợp lệ → model nhận base64 + MIME đúng, trả chữ", async () => {
    const reader = new FakeReader();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const vision = new CdnImageVision(reader, HOSTS, fakeFetch(imageResponse(bytes)).impl);

    const text = await vision.read({ url: URL_OK, question: QUESTION });

    expect(text).toBe("phiếu chuyển khoản 2.000.000đ");
    expect(reader.calls[0]?.mimeType).toBe("image/jpeg");
    expect(reader.calls[0]?.question).toContain(QUESTION);
    expect(reader.calls[0]?.imageBase64).toBe(Buffer.from(bytes).toString("base64"));
  });

  test("câu hỏi của agent đi qua KHUNG: luật chống bịa + dạng trả lời, câu hỏi đứng CUỐI", async () => {
    const reader = new FakeReader();
    const vision = new CdnImageVision(
      reader,
      HOSTS,
      fakeFetch(imageResponse(new Uint8Array([1, 2, 3]))).impl,
    );

    await vision.read({ url: URL_OK, question: QUESTION });
    const prompt = reader.calls[0]?.question ?? "";

    expect(prompt).toContain("không có trong ảnh");
    expect(prompt).toContain("[không đọc được]");
    expect(prompt).toContain("THẤY:");
    // Việc cần làm đặt cuối — phần model bám sát nhất.
    expect(prompt.indexOf(QUESTION)).toBeGreaterThan(prompt.indexOf("LUẬT"));
  });

  test("dữ kiện đã biết → khối riêng, nói rõ KHÔNG phải thứ nhìn thấy trong ảnh", async () => {
    const reader = new FakeReader();
    const vision = new CdnImageVision(
      reader,
      HOSTS,
      fakeFetch(imageResponse(new Uint8Array([1, 2, 3]))).impl,
    );

    await vision.read({ url: URL_OK, question: QUESTION, knownFacts: "mã đơn: DH12345" });
    const prompt = reader.calls[0]?.question ?? "";

    expect(prompt).toContain("DH12345");
    expect(prompt).toContain("KHÔNG phải thứ nhìn thấy trong ảnh");
  });

  test("không có dữ kiện đối chiếu → không chèn khối rỗng", async () => {
    const reader = new FakeReader();
    const vision = new CdnImageVision(
      reader,
      HOSTS,
      fakeFetch(imageResponse(new Uint8Array([1, 2, 3]))).impl,
    );

    await vision.read({ url: URL_OK, question: QUESTION });

    expect(reader.calls[0]?.question).not.toContain("<da_biet>");
  });

  test("model không đọc ra gì → lỗi nghiệp vụ (không trả chuỗi rỗng cho agent)", async () => {
    const vision = new CdnImageVision(
      new FakeReader(""),
      HOSTS,
      fakeFetch(imageResponse(new Uint8Array([1, 2, 3]))).impl,
    );

    await expect(vision.read({ url: URL_OK, question: QUESTION })).rejects.toBeInstanceOf(
      ImageReadError,
    );
  });
});
