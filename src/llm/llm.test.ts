// Test lớp dịch sang Messages API. KHÔNG network: chỉ kiểm hàm thuần map type trung lập → shape SDK.
//
// Đáng test vì đây là chỗ tiền: sai shape `cache_control` thì hoặc 400, hoặc TỆ HƠN — API nhận
// nhưng không cache, im lặng, và mỗi lượt trả full giá cho prompt + tool schema.

import { describe, expect, test } from "bun:test";
import { toApiSystem } from "./providers/anthropic.ts";
import { parseChatResult, toGeminiBody } from "./providers/gemini.ts";
import { LLMError, type ChatRequest } from "./types.ts";

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

// Lớp dịch Gemini (nén hội thoại ngắn hạn). Cùng lý do đáng test với toApiSystem: sai shape thì
// hoặc 400, hoặc tệ hơn — API nhận nhưng hiểu sai (system rơi vào contents, usage đếm trượt).
describe("toGeminiBody", () => {
  const base: ChatRequest = {
    system: [{ text: "bạn là bộ nén" }],
    messages: [
      { role: "user", content: [{ type: "text", text: "hội thoại cũ" }] },
      { role: "assistant", content: [{ type: "text", text: "bản tóm trước" }] },
    ],
    tools: [],
    maxTokens: 1024,
    effort: "low",
  };

  test("system → systemInstruction; assistant → role model; maxTokens giữ nguyên", () => {
    expect(toGeminiBody(base, "gemini")).toEqual({
      systemInstruction: { parts: [{ text: "bạn là bộ nén" }] },
      contents: [
        { role: "user", parts: [{ text: "hội thoại cũ" }] },
        { role: "model", parts: [{ text: "bản tóm trước" }] },
      ],
      generationConfig: { maxOutputTokens: 1024 },
    });
  });

  test("system rỗng → KHÔNG sinh systemInstruction rỗng", () => {
    const body = toGeminiBody({ ...base, system: [] }, "gemini");
    expect("systemInstruction" in body).toBe(false);
  });

  test("có tool schema → throw rõ ràng (text-only seam), không im lặng bỏ tool", () => {
    const req: ChatRequest = {
      ...base,
      tools: [{ name: "t", description: "d", inputSchema: {} }],
    };
    expect(() => toGeminiBody(req, "gemini")).toThrow(LLMError);
  });

  test("block tool_use trong message → throw, không rơi rụng thành text", () => {
    const req: ChatRequest = {
      ...base,
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "1", name: "t", input: {} }] },
      ],
    };
    expect(() => toGeminiBody(req, "gemini")).toThrow(LLMError);
  });
});

describe("parseChatResult", () => {
  test("gộp part text + map finishReason STOP → end_turn + tách usage cache", () => {
    const raw = JSON.stringify({
      candidates: [{ content: { parts: [{ text: "tóm " }, { text: "tắt" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 30, candidatesTokenCount: 20 },
    });
    expect(parseChatResult(raw, "gemini")).toEqual({
      content: [
        { type: "text", text: "tóm " },
        { type: "text", text: "tắt" },
      ],
      stopReason: "end_turn",
      usage: { input: 70, output: 20, cacheRead: 30, cacheWrite: 0 },
    });
  });

  test("MAX_TOKENS → max_tokens; thoughtsTokenCount cộng vào output (cùng đơn giá)", () => {
    const raw = JSON.stringify({
      candidates: [{ content: { parts: [{ text: "x" }] }, finishReason: "MAX_TOKENS" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 },
    });
    const result = parseChatResult(raw, "gemini");
    expect(result.stopReason).toBe("max_tokens");
    expect(result.usage).toEqual({ input: 10, output: 12, cacheRead: 0, cacheWrite: 0 });
  });

  test("không candidate (safety/cụt) → content rỗng, KHÔNG throw — compactor coi là nén hụt", () => {
    const result = parseChatResult(JSON.stringify({ usageMetadata: {} }), "gemini");
    expect(result).toEqual({
      content: [],
      stopReason: "other",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });

  test("response không phải JSON → LLMError, không nuốt", () => {
    expect(() => parseChatResult("<html>", "gemini")).toThrow(LLMError);
  });
});
