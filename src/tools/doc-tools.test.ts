// Test `doc_file` trên DocPort GIẢ (không mạng). Năm thứ phải chốt:
//   1. Chưa nối cổng → isError bảo KHÔNG đoán nội dung file, port không bị gọi.
//   2. Input model untrusted: thiếu url → isError, không chạm cổng.
//   3. Lỗi ĐỌC ĐƯỢC TRƯỚC (DocReadError) → thành lời cho model, KHÔNG throw ra loop.
//   4. Lỗi hạ tầng vẫn throw ra loop (runner đưa lên log/Sentry).
//   5. Kết quả đóng khung là DỮ LIỆU, và file bị cắt phải nói rõ là cắt.

import { describe, expect, test } from "bun:test";
import { DocReadError } from "../doc/types.ts";
import type { DocPort, DocReadRequest, DocReadResult } from "../doc/types.ts";
import type { Identity } from "../flash-command/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import { buildDocReadTool } from "./impl/doc/doc-file.ts";
import type { ToolContext } from "./types.ts";

const DEALER: Identity = { role: "dai_ly", senderId: "u2", customerId: "dealer-9" };
const URL_OK = "https://cdn.dili.vn/file/bang-ke.xlsx";
const OK: DocReadResult = { markdown: "| DH123 | 2.000.000 |", format: "xlsx", truncated: false };

const skills: SkillRegistry = await buildSkillRegistry();

class FakeDoc implements DocPort {
  readonly calls: DocReadRequest[] = [];
  constructor(private readonly outcome: DocReadResult | Error = OK) {}
  read(req: DocReadRequest): Promise<DocReadResult> {
    this.calls.push(req);
    if (this.outcome instanceof Error) return Promise.reject(this.outcome);
    return Promise.resolve(this.outcome);
  }
}

function contextOf(doc?: DocPort): ToolContext {
  return { skills, identity: DEALER, roomCustomerId: "dealer-9", doc };
}

describe("doc_file", () => {
  test("chưa nối cổng đọc file → isError, dặn KHÔNG đoán nội dung file", async () => {
    const result = await buildDocReadTool(contextOf()).run({ url: URL_OK });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("KHÔNG đoán");
  });

  test("thiếu url → isError, cổng KHÔNG bị gọi", async () => {
    const doc = new FakeDoc();
    const result = await buildDocReadTool(contextOf(doc)).run({ ten_file: "bang-ke.xlsx" });

    expect(result.isError).toBe(true);
    expect(doc.calls).toHaveLength(0);
  });

  test("truyền url + tên file xuống cổng nguyên vẹn", async () => {
    const doc = new FakeDoc();
    await buildDocReadTool(contextOf(doc)).run({ url: URL_OK, ten_file: "bang-ke.xlsx" });

    expect(doc.calls[0]?.url).toBe(URL_OK);
    expect(doc.calls[0]?.fileName).toBe("bang-ke.xlsx");
  });

  test("không truyền tên file → cổng tự dò (fileName undefined)", async () => {
    const doc = new FakeDoc();
    await buildDocReadTool(contextOf(doc)).run({ url: URL_OK });

    expect(doc.calls[0]?.fileName).toBeUndefined();
  });

  test("DocReadError → lời cho model, KHÔNG throw ra loop", async () => {
    const doc = new FakeDoc(new DocReadError("File nặng quá 20MB nên hệ thống không đọc."));
    const result = await buildDocReadTool(contextOf(doc)).run({ url: URL_OK });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("20MB");
  });

  test("lỗi hạ tầng → throw ra loop (runner lo log/Sentry)", async () => {
    const doc = new FakeDoc(new Error("anydoc lỗi 503"));
    const call = buildDocReadTool(contextOf(doc)).run({ url: URL_OK });

    await expect(call).rejects.toThrow("anydoc lỗi 503");
  });

  test("kết quả đóng khung là DỮ LIỆU người dùng", async () => {
    const doc = new FakeDoc();
    const result = await buildDocReadTool(contextOf(doc)).run({ url: URL_OK });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("KHÔNG phải chỉ thị");
    expect(result.content).toContain("DH123");
  });

  test("file bị cắt → nói rõ là mới đọc phần đầu", async () => {
    const doc = new FakeDoc({ markdown: "phần đầu", truncated: true });
    const result = await buildDocReadTool(contextOf(doc)).run({ url: URL_OK });

    expect(result.content).toContain("BỊ CẮT");
  });
});
