// Test luật câu trả lời: mỗi check bắt đúng câu đã từng lọt ra production, và KHÔNG bắt nhầm câu
// đúng nằm sát ranh giới.

import { describe, expect, test } from "bun:test";
import { NO_AD_DISCLAIMER, NO_CASUAL_CLOSING, NO_DOCTOR_MENTION } from "./reply-checks.ts";
import { customerProfile } from "./roots/customer.ts";
import { saleFacebookProfile } from "./roots/sale-facebook.ts";
import { xacNhanProfile } from "./roots/xac-nhan.ts";

describe("NO_DOCTOR_MENTION", () => {
  test("câu đã lọt ra nhóm xác nhận (bdb12ad) → bắt", () => {
    expect(NO_DOCTOR_MENTION.check("Dạ em ghi rồi ạ, đơn đang chờ bác sĩ duyệt.")).toBeDefined();
  });

  test("viết tắt BS, hoa thường, sỹ/sĩ → đều bắt", () => {
    expect(NO_DOCTOR_MENTION.check("Ca này chờ BS Sơn gọi ạ")).toBeDefined();
    expect(NO_DOCTOR_MENTION.check("bs sẽ xem sau ạ")).toBeDefined();
    expect(NO_DOCTOR_MENTION.check("Bác Sỹ đang bận ạ")).toBeDefined();
  });

  test("chuỗi Unicode tổ hợp (NFD) → vẫn bắt", () => {
    expect(NO_DOCTOR_MENTION.check("chờ bác sĩ duyệt".normalize("NFD"))).toBeDefined();
  });

  test("thêm chữ bác sĩ vào tên → bắt", () => {
    expect(NO_DOCTOR_MENTION.check("Ca này đang chờ bác sĩ Sơn gọi ạ")).toBeDefined();
  });

  test("câu đúng chuẩn → đạt", () => {
    expect(NO_DOCTOR_MENTION.check("Dạ em ghi rồi ạ, đơn đang chờ duyệt.")).toBeUndefined();
  });

  test("gọi là Bác Sơn → đạt, kể cả viết thường hay NFD", () => {
    expect(NO_DOCTOR_MENTION.check("Ca này đang chờ Bác Sơn gọi ạ")).toBeUndefined();
    expect(NO_DOCTOR_MENTION.check("chờ bác sơn duyệt".normalize("NFD"))).toBeUndefined();
  });

  test("chữ có 'bs' nằm giữa từ → không bắt nhầm", () => {
    expect(NO_DOCTOR_MENTION.check("Mã đơn ABS123 em ghi rồi ạ")).toBeUndefined();
  });
});

describe("NO_AD_DISCLAIMER", () => {
  test("câu miễn trừ quảng cáo chèn vào tin chat (7f145ba) → bắt", () => {
    const reply =
      "Nano Nattokinase hỗ trợ tan cục máu đông. Sản phẩm này không phải là thuốc và không có " +
      "tác dụng thay thế thuốc chữa bệnh.";
    expect(NO_AD_DISCLAIMER.check(reply)).toBeDefined();
  });

  test("xuống dòng giữa câu → vẫn bắt", () => {
    expect(NO_AD_DISCLAIMER.check("không thay thế\nthuốc chữa bệnh ạ")).toBeDefined();
  });

  test("trả lời tự nhiên khi khách hỏi có thay thuốc không → đạt", () => {
    expect(
      NO_AD_DISCLAIMER.check("Dạ không cô ơi, cô vẫn uống thuốc bác sĩ kê, cái này chỉ hỗ trợ thêm thôi ạ."),
    ).toBeUndefined();
  });
});

describe("NO_CASUAL_CLOSING", () => {
  test("câu kết 'nha cô', 'nhé' chép từ mẫu skill cũ → bắt", () => {
    expect(NO_CASUAL_CLOSING.check("Dạ em chuyển ngay cho bạn ấy nha cô.")).toBeDefined();
    expect(NO_CASUAL_CLOSING.check("Cô để lại số để bên con hỗ trợ mình nhé.")).toBeDefined();
    expect(NO_CASUAL_CLOSING.check("Chú chờ con chút nhe")).toBeDefined();
  });

  test("hoa đầu câu, NFD → vẫn bắt", () => {
    expect(NO_CASUAL_CLOSING.check("Nhé cô, con gửi liền ạ")).toBeDefined();
    expect(NO_CASUAL_CLOSING.check("cô uống sau ăn nhé".normalize("NFD"))).toBeDefined();
  });

  test("kết bằng ạ, vâng ạ → đạt", () => {
    expect(NO_CASUAL_CLOSING.check("Vâng ạ")).toBeUndefined();
    expect(NO_CASUAL_CLOSING.check("Dạ cô chụp giúp con chỗ hộp móp ạ.")).toBeUndefined();
  });

  test("nhà, nha khoa, nha sĩ, Nha Trang, nhanh → không bắt nhầm", () => {
    expect(NO_CASUAL_CLOSING.check("Con gửi hàng về nhà cô ạ")).toBeUndefined();
    expect(NO_CASUAL_CLOSING.check("Cô hỏi thêm nha sĩ giúp con ạ")).toBeUndefined();
    expect(NO_CASUAL_CLOSING.check("Bên con ship ra Nha Trang được ạ")).toBeUndefined();
    expect(NO_CASUAL_CLOSING.check("Phòng nha khoa gần nhà cô ạ")).toBeUndefined();
    expect(NO_CASUAL_CLOSING.check("Con gửi nhanh cho cô ạ")).toBeUndefined();
  });
});

describe("khai checks trên root", () => {
  test("nhóm xác nhận đơn kiểm câu nhắc bác sĩ", () => {
    expect(xacNhanProfile.replyChecks).toContain(NO_DOCTOR_MENTION);
  });

  test("hai kênh khách lẻ kiểm câu miễn trừ quảng cáo", () => {
    expect(customerProfile.replyChecks).toContain(NO_AD_DISCLAIMER);
    expect(saleFacebookProfile.replyChecks).toContain(NO_AD_DISCLAIMER);
  });

  test("hai kÃªnh khÃ¡ch láº» kiá»m cÃ¢u káº¿t nhÃ©/nha", () => {
    expect(customerProfile.replyChecks).toContain(NO_CASUAL_CLOSING);
    expect(saleFacebookProfile.replyChecks).toContain(NO_CASUAL_CLOSING);
  });
});
