// Test lớp dịch sang Messages API. KHÔNG network: chỉ kiểm hàm thuần map type trung lập → shape SDK.
//
// Đáng test vì đây là chỗ tiền: sai shape `cache_control` thì hoặc 400, hoặc TỆ HƠN — API nhận
// nhưng không cache, im lặng, và mỗi lượt trả full giá cho prompt + tool schema.

import { describe, expect, test } from "bun:test";
import { toApiSystem } from "./providers/anthropic.ts";

describe("toApiSystem", () => {
  test("khối cache → có cache_control ephemeral; khối thường → KHÔNG có field đó", () => {
    const blocks = toApiSystem([{ text: "ổn định", cache: true }, { text: "biến động" }]);
    expect(blocks).toEqual([
      { type: "text", text: "ổn định", cache_control: { type: "ephemeral" } },
      { type: "text", text: "biến động" },
    ]);
  });

  test("giữ nguyên thứ tự (cache là PREFIX MATCH — đảo khối là hỏng cache)", () => {
    const blocks = toApiSystem([{ text: "a", cache: true }, { text: "b" }, { text: "c" }]);
    expect(blocks.map((b) => b.text)).toEqual(["a", "b", "c"]);
  });

  test("cache: false đối xử như không cache (không sinh breakpoint thừa)", () => {
    expect(toApiSystem([{ text: "x", cache: false }])).toEqual([{ type: "text", text: "x" }]);
  });
});
