// Test AnydocDocReader: hàng rào TRƯỚC khi chạm mạng, trần lúc tải, và cách xử kết quả dịch vụ.
// fetch giả, không mạng thật. Những thứ phải chốt:
//   1. Host ngoài allowlist → KHÔNG có request nào được gửi đi (SSRF).
//   2. Redirect không được đi theo.
//   3. Trần dung lượng cắt theo LUỒNG, không tin content-length.
//   4. PDF scan (422 needsOcr) → thử lại ĐÚNG MỘT LẦN với ocr=hosted.
//   5. Lỗi hạ tầng (5xx, key sai) ≠ lỗi nghiệp vụ: cái trước throw Error, cái sau DocReadError.
//   6. Markdown dài hơn trần → cắt và báo `truncated`.

import { describe, expect, test } from "bun:test";
import { AnydocDocReader } from "./anydoc.ts";
import { DocReadError } from "./types.ts";

const CONFIG = {
  baseUrl: "https://anydoc.test.workers.dev",
  apiKey: "ad_test",
  allowedHosts: ["cdn.dili.vn"] as const,
};
const URL_OK = "https://cdn.dili.vn/file/bang-ke.pdf";
const FILE_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

interface Call {
  readonly url: string;
  readonly method: string;
}

/**
 * fetch giả theo KỊCH BẢN: mỗi lần gọi lấy response kế tiếp trong hàng. Hàng cạn → dùng lại cái
 * cuối (test chỉ quan tâm mấy lượt đầu).
 */
function fakeFetch(responses: readonly (() => Response)[]) {
  const calls: Call[] = [];
  let i = 0;
  const impl = ((input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method ?? "GET",
    });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    if (next === undefined) throw new Error("fakeFetch: không có response nào");
    return Promise.resolve(next());
  }) as typeof fetch;
  return { impl, calls };
}

const download = (bytes: Uint8Array = FILE_BYTES) => (): Response =>
  new Response(bytes, { status: 200 });

const converted = (markdown: string, format = "pdf") => (): Response =>
  new Response(JSON.stringify({ markdown, format }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const failed = (status: number, body: Record<string, unknown>) => (): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("AnydocDocReader — hàng rào trước khi tải", () => {
  test("host ngoài allowlist → lỗi nghiệp vụ, KHÔNG gửi request nào", async () => {
    const fetchStub = fakeFetch([download()]);
    const doc = new AnydocDocReader(CONFIG, fetchStub.impl);

    const call = doc.read({ url: "http://169.254.169.254/latest/meta-data" });

    await expect(call).rejects.toBeInstanceOf(DocReadError);
    expect(fetchStub.calls).toHaveLength(0);
  });

  test("allowlist rỗng = đóng cổng, kể cả host trông quen", async () => {
    const fetchStub = fakeFetch([download()]);
    const doc = new AnydocDocReader({ ...CONFIG, allowedHosts: [] }, fetchStub.impl);

    await expect(doc.read({ url: URL_OK })).rejects.toBeInstanceOf(DocReadError);
    expect(fetchStub.calls).toHaveLength(0);
  });

  test("subdomain của host đã duyệt → cho qua", async () => {
    const fetchStub = fakeFetch([download(), converted("# bảng kê")]);
    const doc = new AnydocDocReader(CONFIG, fetchStub.impl);

    const result = await doc.read({ url: "https://files.cdn.dili.vn/a/b.docx" });

    expect(result.markdown).toBe("# bảng kê");
    expect(result.format).toBe("pdf");
    expect(result.truncated).toBe(false);
  });

  test("redirect KHÔNG đi theo → lỗi nghiệp vụ", async () => {
    const redirect = (): Response =>
      new Response(null, { status: 302, headers: { location: "http://10.0.0.1/" } });
    const doc = new AnydocDocReader(CONFIG, fakeFetch([redirect]).impl);

    await expect(doc.read({ url: URL_OK })).rejects.toBeInstanceOf(DocReadError);
  });

  test("file vượt trần dung lượng → lỗi nghiệp vụ, không gọi anydoc", async () => {
    const huge = new Uint8Array(21 * 1024 * 1024);
    const fetchStub = fakeFetch([download(huge), converted("x")]);
    const doc = new AnydocDocReader(CONFIG, fetchStub.impl);

    await expect(doc.read({ url: URL_OK })).rejects.toBeInstanceOf(DocReadError);
    expect(fetchStub.calls).toHaveLength(1);
  });
});

describe("AnydocDocReader — gọi dịch vụ chuyển đổi", () => {
  test("gửi POST /convert kèm json=1 và tên file", async () => {
    const fetchStub = fakeFetch([download(), converted("nội dung")]);
    const doc = new AnydocDocReader(CONFIG, fetchStub.impl);

    await doc.read({ url: URL_OK, fileName: "bang ke.xlsx" });

    const convert = fetchStub.calls[1];
    expect(convert?.method).toBe("POST");
    expect(convert?.url).toContain("https://anydoc.test.workers.dev/convert");
    expect(convert?.url).toContain("json=1");
    expect(convert?.url).toContain("filename=bang+ke.xlsx");
  });

  test("thiếu tên file → suy từ đường dẫn url", async () => {
    const fetchStub = fakeFetch([download(), converted("nội dung")]);
    const doc = new AnydocDocReader(CONFIG, fetchStub.impl);

    await doc.read({ url: URL_OK });

    expect(fetchStub.calls[1]?.url).toContain("filename=bang-ke.pdf");
  });

  test("PDF scan (422 needsOcr) → thử lại đúng một lần với ocr=hosted", async () => {
    const fetchStub = fakeFetch([
      download(),
      failed(422, { error: "scanned pdf", code: "needsOcr" }),
      converted("chữ đọc bằng OCR"),
    ]);
    const doc = new AnydocDocReader(CONFIG, fetchStub.impl);

    const result = await doc.read({ url: URL_OK });

    expect(result.markdown).toBe("chữ đọc bằng OCR");
    expect(fetchStub.calls).toHaveLength(3);
    expect(fetchStub.calls[1]?.url).not.toContain("ocr=hosted");
    expect(fetchStub.calls[2]?.url).toContain("ocr=hosted");
  });

  test("OCR vẫn needsOcr → lỗi nghiệp vụ, KHÔNG thử lần ba", async () => {
    const fetchStub = fakeFetch([
      download(),
      failed(422, { error: "scanned pdf", code: "needsOcr" }),
      failed(422, { error: "scanned pdf", code: "needsOcr" }),
    ]);
    const doc = new AnydocDocReader(CONFIG, fetchStub.impl);

    await expect(doc.read({ url: URL_OK })).rejects.toBeInstanceOf(DocReadError);
    expect(fetchStub.calls).toHaveLength(3);
  });

  test("định dạng không đọc được (400) → lỗi nghiệp vụ", async () => {
    const fetchStub = fakeFetch([download(), failed(400, { error: "unsupported format" })]);
    const doc = new AnydocDocReader(CONFIG, fetchStub.impl);

    await expect(doc.read({ url: URL_OK })).rejects.toBeInstanceOf(DocReadError);
  });

  test("key sai (401) → SỰ CỐ hạ tầng, không phải lỗi nghiệp vụ", async () => {
    const fetchStub = fakeFetch([download(), failed(401, { error: "unauthorized" })]);
    const doc = new AnydocDocReader(CONFIG, fetchStub.impl);

    const call = doc.read({ url: URL_OK });

    await expect(call).rejects.toThrow(/anydoc/);
    await expect(call).rejects.not.toBeInstanceOf(DocReadError);
  });

  test("dịch vụ 5xx → SỰ CỐ hạ tầng", async () => {
    const fetchStub = fakeFetch([download(), failed(503, { error: "container down" })]);
    const doc = new AnydocDocReader(CONFIG, fetchStub.impl);

    const call = doc.read({ url: URL_OK });

    await expect(call).rejects.toThrow(/anydoc/);
    await expect(call).rejects.not.toBeInstanceOf(DocReadError);
  });

  test("file không có chữ nào → lỗi nghiệp vụ", async () => {
    const fetchStub = fakeFetch([download(), converted("   \n  ")]);
    const doc = new AnydocDocReader(CONFIG, fetchStub.impl);

    await expect(doc.read({ url: URL_OK })).rejects.toBeInstanceOf(DocReadError);
  });

  test("markdown dài hơn trần → cắt và báo truncated", async () => {
    const long = "a".repeat(30_000);
    const fetchStub = fakeFetch([download(), converted(long)]);
    const doc = new AnydocDocReader(CONFIG, fetchStub.impl);

    const result = await doc.read({ url: URL_OK });

    expect(result.truncated).toBe(true);
    expect(result.markdown).toHaveLength(24_000);
  });
});
