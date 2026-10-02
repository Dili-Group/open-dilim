// Test POLICY thuần của sổ xác nhận (khung giờ + hàng rào trường). Không env, không DB, không LLM.
//
// Bốn thứ phải chốt:
//   1. Mốc giờ đọc theo GIỜ VN — cùng một Date, kết quả không đổi theo TZ của máy chạy test.
//   2. Biên slot: 11:00 và 12:00 không được cùng kết luận.
//   3. Chủ nhật OFF, và đăng ký muộn vẫn GHI ĐƯỢC (chỉ mất `onTime`), không bị chặn.
//   4. Lý do chung chung bị chặn, lý do đã nêu vấn đề thì lọt — kể cả khi nó chứa từ "xác nhận".

import { describe, expect, test } from "bun:test";
import {
  currentSlot,
  isOffDay,
  isOnTime,
  normalizeSlot,
  vnDay,
  vnMinutes,
  weekdayOf,
} from "./impl/xacnhan/khung-gio.ts";
import { cleanText, isVagueReason, normalizePhoneDigits, normalizeStt } from "./impl/xacnhan/chuan-hoa.ts";

/** 2026-09-18 là thứ Sáu. 04:30Z = 11:30 giờ VN → đang trong khung trưa. */
const TRUA_T6 = new Date("2026-09-18T04:30:00Z");
/** 2026-09-18 12:30 VN — khung trưa vừa đóng. */
const SAU_TRUA_T6 = new Date("2026-09-18T05:30:00Z");
/** 2026-09-20 là Chủ nhật, 09:00 VN. */
const CHU_NHAT = new Date("2026-09-20T02:00:00Z");

describe("giờ VN", () => {
  test("ngày sổ lấy theo VN, không theo UTC", () => {
    // 2026-09-18T19:00Z = 02:00 ngày 19 giờ VN. Lấy theo UTC là ghi nhầm sang ngày hôm trước.
    expect(vnDay(new Date("2026-09-18T19:00:00Z"))).toBe("2026-09-19");
    expect(vnDay(TRUA_T6)).toBe("2026-09-18");
  });

  test("phút trong ngày tính theo VN", () => {
    expect(vnMinutes(TRUA_T6)).toBe(11 * 60 + 30);
  });

  test("weekdayOf đọc từ chuỗi ngày, bắt được ngày ảo", () => {
    expect(weekdayOf("2026-09-18")).toBe(5);
    expect(weekdayOf("2026-09-20")).toBe(0);
    expect(weekdayOf("2026-02-31")).toBeUndefined();
    expect(weekdayOf("18/09/2026")).toBeUndefined();
  });

  test("Chủ nhật OFF", () => {
    expect(isOffDay("2026-09-20")).toBe(true);
    expect(isOffDay("2026-09-18")).toBe(false);
    expect(isOffDay("khong-phai-ngay")).toBe(true);
  });
});

describe("currentSlot", () => {
  test("trong khung trưa", () => {
    expect(currentSlot(TRUA_T6)).toBe("trua");
  });

  test("12:00 là ĐÃ ĐÓNG khung trưa, không phải vẫn mở", () => {
    expect(currentSlot(new Date("2026-09-18T05:00:00Z"))).toBeUndefined();
  });

  test("11:00 đúng lúc mở", () => {
    expect(currentSlot(new Date("2026-09-18T04:00:00Z"))).toBe("trua");
  });

  test("khung chiều", () => {
    expect(currentSlot(new Date("2026-09-18T09:30:00Z"))).toBe("chieu");
  });

  test("Chủ nhật không có slot nào", () => {
    expect(currentSlot(CHU_NHAT)).toBeUndefined();
  });
});

describe("isOnTime", () => {
  test("đăng ký sáng cho khung chiều cùng ngày = kịp", () => {
    const sang = new Date("2026-09-18T01:17:00Z"); // 08:17 VN
    expect(isOnTime({ slot: "chieu", day: "2026-09-18", now: sang })).toBe(true);
  });

  test("đăng ký sau khi khung đã đóng = muộn (vẫn ghi, chỉ xếp sau)", () => {
    expect(isOnTime({ slot: "trua", day: "2026-09-18", now: SAU_TRUA_T6 })).toBe(false);
  });

  test("đăng ký tối nay cho khung trưa ngày mai = kịp", () => {
    const toi = new Date("2026-09-18T13:13:00Z"); // 20:13 VN
    expect(isOnTime({ slot: "trua", day: "2026-09-19", now: toi })).toBe(true);
  });

  test("xin khung của ngày đã qua = muộn", () => {
    expect(isOnTime({ slot: "chieu", day: "2026-09-17", now: TRUA_T6 })).toBe(false);
  });

  test("xin vào Chủ nhật = muộn dù đăng ký sớm", () => {
    expect(isOnTime({ slot: "trua", day: "2026-09-20", now: TRUA_T6 })).toBe(false);
  });
});

describe("normalizeSlot", () => {
  test("nhận đúng các kiểu sale hay gõ", () => {
    expect(normalizeSlot("12h")).toBe("trua");
    expect(normalizeSlot("11-12h")).toBe("trua");
    expect(normalizeSlot("Khung giờ 11-12h ngày 18/9")).toBe("trua");
    expect(normalizeSlot("16-17h")).toBe("chieu");
    expect(normalizeSlot("khung chiều")).toBe("chieu");
    expect(normalizeSlot("trua")).toBe("trua");
  });

  test("giờ ngoài hai khung → undefined để tool hỏi lại, không đoán", () => {
    expect(normalizeSlot("9h")).toBeUndefined();
    expect(normalizeSlot("tối nay")).toBeUndefined();
    expect(normalizeSlot(undefined)).toBeUndefined();
  });
});

describe("hàng rào trường", () => {
  test("bóc CHỮ SỐ SĐT sale gõ, giữ nguyên cả cụm (backend tự lấy 5 số cuối)", () => {
    expect(normalizePhoneDigits("chij TRANG   94734")).toBe("94734");
    expect(normalizePhoneDigits("(021329)")).toBe("021329");
    expect(normalizePhoneDigits("0559 047 706")).toBe("0559047706");
  });

  test("dưới 5 chữ số hoặc dài quá một SĐT → undefined, KHÔNG đệm 0", () => {
    expect(normalizePhoneDigits("947")).toBeUndefined();
    expect(normalizePhoneDigits("")).toBeUndefined();
    expect(normalizePhoneDigits(42)).toBeUndefined();
    expect(normalizePhoneDigits("1".repeat(16))).toBeUndefined();
  });

  test("lý do chung chung bị chặn", () => {
    expect(isVagueReason("tư vấn thêm")).toBe(true);
    expect(isVagueReason("TV thêm")).toBe(true);
    expect(isVagueReason("hỗ trợ thêm")).toBe(true);
    expect(isVagueReason("xác nhận")).toBe(true);
    expect(isVagueReason("hỏi")).toBe(true);
  });

  test("bóc vỏ mở đầu rồi mới so: 'gặp bác để hỏi thêm' vẫn là chung chung", () => {
    expect(isVagueReason("gặp bác để hỏi thêm")).toBe(true);
    expect(isVagueReason("muốn gặp bác Sơn để tư vấn thêm")).toBe(true);
    expect(isVagueReason("cần hỗ trợ thêm")).toBe(true);
    expect(isVagueReason("cần tư vấn")).toBe(true);
    // Có nêu vấn đề phía sau thì lọt.
    expect(isVagueReason("gặp bác để hỏi thêm về tương tác với thuốc huyết áp")).toBe(false);
    expect(isVagueReason("muốn gặp Bác để yên tâm sử dụng tiếp")).toBe(false);
  });

  test("lý do đã nêu vấn đề thì lọt, kể cả khi có chữ xác nhận", () => {
    expect(isVagueReason("sợ giả, bị lừa")).toBe(false);
    expect(isVagueReason("đã nghe trợ lý TV nhưng muốn gặp bác Sơn cho yên tâm")).toBe(false);
    expect(isVagueReason("khách cần bác sĩ xác nhận liệu trình 3 tháng có đúng không")).toBe(false);
  });

  test("cleanText gọn khoảng trắng và cắt trần", () => {
    expect(cleanText("  chị   Trang  ", 80)).toBe("chị Trang");
    expect(cleanText("x".repeat(200), 10)).toBe("x".repeat(10));
    expect(cleanText("   ", 80)).toBeUndefined();
    expect(cleanText(7, 80)).toBeUndefined();
  });

  test("normalizeStt đọc số thứ tự, bỏ giá trị vô lý", () => {
    expect(normalizeStt("8")).toBe(8);
    expect(normalizeStt(10)).toBe(10);
    expect(normalizeStt("0")).toBeUndefined();
    expect(normalizeStt("nhiều")).toBeUndefined();
  });
});
