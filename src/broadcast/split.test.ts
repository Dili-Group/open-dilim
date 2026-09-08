// Test splitReply: cắt câu trả lời thành nhiều tin theo marker `---` model tự đặt.

import { describe, expect, test } from "bun:test";

import { splitReply, typingDelayMs } from "./split.ts";

describe("splitReply", () => {
  test("không có marker → đúng một tin, nguyên văn", () => {
    expect(splitReply("Đơn DH12345 về tới kho rồi ạ.")).toEqual(["Đơn DH12345 về tới kho rồi ạ."]);
  });

  test("marker trên dòng riêng → cắt thành từng tin, mỗi tin đã trim", () => {
    const input = "Dạ em vừa tra\n---\nDH12345 đang ở kho Hà Nội\n---\nAnh gửi em số đúng nhé ạ";
    expect(splitReply(input)).toEqual([
      "Dạ em vừa tra",
      "DH12345 đang ở kho Hà Nội",
      "Anh gửi em số đúng nhé ạ",
    ]);
  });

  test("gạch giữa câu KHÔNG phải marker — chỉ dòng chỉ có gạch mới cắt", () => {
    const input = "Giao hàng 2--3 ngày ạ\nMã đơn - DH12345";
    expect(splitReply(input)).toEqual([input]);
  });

  test("marker thừa ở đầu/cuối hoặc liền nhau → không đẻ tin rỗng", () => {
    expect(splitReply("---\nMột tin thôi\n---\n---\n")).toEqual(["Một tin thôi"]);
  });

  test("quá 4 đoạn → gộp phần dư vào tin cuối, không bỏ dữ kiện", () => {
    const input = ["a", "b", "c", "d", "e"].join("\n---\n");
    expect(splitReply(input)).toEqual(["a", "b", "c", "d\ne"]);
  });

  test("text rỗng / chỉ khoảng trắng → không có tin nào để gửi", () => {
    expect(splitReply("")).toEqual([]);
    expect(splitReply("  \n\n ")).toEqual([]);
  });

  test("giữ xuống dòng bên trong một tin", () => {
    expect(splitReply("- DH1 · đã giao\n- DH2 · đang đi")).toEqual([
      "- DH1 · đã giao\n- DH2 · đang đi",
    ]);
  });
});

describe("typingDelayMs", () => {
  test("tin dài chờ lâu hơn tin ngắn", () => {
    expect(typingDelayMs("ok")).toBeLessThan(typingDelayMs("x".repeat(100)));
  });

  test("có trần: tin rất dài không kéo lượt vô hạn", () => {
    expect(typingDelayMs("x".repeat(10_000))).toBe(2_500);
  });
});
