// Test extractQrMedia: rút link QR SePay khỏi text trả lời, biến thành OutboundMedia ảnh.

import { describe, expect, test } from "bun:test";

import { extractQrMedia } from "./qr.ts";

const QR = "https://qr.sepay.vn/img?acc=1&des=DH000123&amount=5000000";

describe("extractQrMedia", () => {
  test("không có link QR → trả nguyên văn, media rỗng", () => {
    const input = "Đơn 123 đã giao xong, xem bill: https://cdn/bill.jpg";
    expect(extractQrMedia(input)).toEqual({ text: input, media: [] });
  });

  test("link trần giữa câu → rút link, giữ phần chữ quanh nó", () => {
    const out = extractQrMedia(`Quét mã ${QR} để chuyển khoản nhé.`);
    expect(out.text).toBe("Quét mã  để chuyển khoản nhé.");
    expect(out.media).toEqual([{ type: "image", url: QR }]);
  });

  test("dòng nhãn 'Link QR:' chỉ còn nhãn sau khi rút → xoá cả dòng", () => {
    const out = extractQrMedia(`Còn thiếu 5tr.\nLink QR: ${QR}\nChuyển xong báo em.`);
    expect(out.text).toBe("Còn thiếu 5tr.\nChuyển xong báo em.");
    expect(out.media).toEqual([{ type: "image", url: QR }]);
  });

  test("markdown [Link QR](url) → gỡ cả vỏ markdown", () => {
    const out = extractQrMedia(`Thanh toán tại đây: [Link QR](${QR})`);
    expect(out.text).toBe("Thanh toán tại đây:");
    expect(out.media).toEqual([{ type: "image", url: QR }]);
  });

  test("cùng một URL lặp hai lần → chỉ một ảnh", () => {
    const out = extractQrMedia(`QR: ${QR}\nNhắc lại: ${QR}`);
    expect(out.media).toHaveLength(1);
  });

  test("hai QR khác nhau → hai ảnh, giữ thứ tự xuất hiện", () => {
    const qr2 = "https://qr.sepay.vn/img?acc=1&des=DH000456&amount=200000";
    const out = extractQrMedia(`Đơn 123: ${QR}\nĐơn 456: ${qr2}`);
    expect(out.media.map((m) => m.url)).toEqual([QR, qr2]);
  });

  test("cả câu chỉ có link → text rỗng, vẫn ra ảnh", () => {
    const out = extractQrMedia(QR);
    expect(out.text).toBe("");
    expect(out.media).toEqual([{ type: "image", url: QR }]);
  });

  test("URL không phải qr.sepay.vn → không đụng", () => {
    const input = "Ảnh bill: https://qr.other.vn/img?x=1";
    expect(extractQrMedia(input)).toEqual({ text: input, media: [] });
  });
});
