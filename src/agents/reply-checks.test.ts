// Test luật câu trả lời: mỗi check bắt đúng câu đã từng lọt ra production, và KHÔNG bắt nhầm câu
// đúng nằm sát ranh giới.

import { describe, expect, test } from "bun:test";
import {
  NO_AD_DISCLAIMER,
  NO_CASUAL_CLOSING,
  NO_CONTRADICT_CONSULTANT,
  NO_DOCTOR_MENTION,
  NO_MEDICAL_ADVICE,
  NO_STOP_ADVICE,
} from "./reply-checks.ts";
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

describe("NO_STOP_ADVICE", () => {
  test("câu đã lọt ra OA khi khách kể đau ngón chân → bắt", () => {
    expect(
      NO_STOP_ADVICE.check(
        "Anh/chị ngưng dùng AFCRICH từ bây giờ. Nếu còn đau hoặc khó chịu, anh/chị đi khám sớm và mang theo hộp sản phẩm cho bác sĩ xem ạ.",
      ),
    ).toBeDefined();
    expect(
      NO_STOP_ADVICE.check(
        "Trong lúc chờ, anh vẫn ngưng AFCRICH, và nếu ngón chân đau tăng thì anh đi khám ngay ạ.",
      ),
    ).toBeDefined();
  });

  test("các cách nói ngưng khác, hoa đầu câu, NFD → vẫn bắt", () => {
    expect(NO_STOP_ADVICE.check("Cô đừng uống tiếp giúp con ạ")).toBeDefined();
    expect(NO_STOP_ADVICE.check("Tạm ngừng sử dụng giúp em ạ")).toBeDefined();
    expect(NO_STOP_ADVICE.check("Ngưng dùng sản phẩm giúp con ạ".normalize("NFD"))).toBeDefined();
  });

  test("hộp quá hạn → được khuyên ngưng", () => {
    expect(
      NO_STOP_ADVICE.check("Dạ hộp đó quá hạn rồi, cô ngưng dùng giúp em, đừng uống tiếp ạ."),
    ).toBeUndefined();
  });

  test("hỏi rõ thêm, chữ 'dừng/ngưng' việc khác → đạt", () => {
    expect(
      NO_STOP_ADVICE.check("Dạ anh đau ngón chân từ khi nào ạ, có từ trước khi uống AFCRICH không?"),
    ).toBeUndefined();
    expect(NO_STOP_ADVICE.check("Em dừng ở đây, bạn phụ trách gọi anh ạ")).toBeUndefined();
    expect(NO_STOP_ADVICE.check("Mẫu này bên em ngưng bán rồi ạ")).toBeUndefined();
  });
});

// Hai tin đã lọt ra OA: khách hỏi gói bột Chou Beauty Queen, rồi nói "bạn tư vấn nói gói men đó
// hỗ trợ đau bao tử".
const LEAKED_DISEASE_REPLY =
  "Gói bột pha nước (Chou Beauty Queen) là thực phẩm bổ sung, không phải thuốc nên không dùng để trị bệnh ạ. Sản phẩm bổ sung chất xơ inulin, hỗ trợ tiêu hóa.\nNếu anh/chị đang có bệnh hoặc đang dùng thuốc, anh/chị hỏi bác sĩ điều trị trước khi dùng ạ.";
const LEAKED_CONTRADICT_REPLY =
  "Em không có thông tin nào cho thấy sản phẩm này hỗ trợ đau bao tử, nên em không xác nhận điều đó được ạ. Sản phẩm là thực phẩm bổ sung, không phải thuốc, nên không dùng để trị đau dạ dày.\nNếu anh/chị đang bị đau bao tử, anh/chị nên đi khám để có chẩn đoán rõ hơn ạ. Anh/chị cho em xin số điện thoại để bạn phụ trách giải đáp lại lời tư vấn lúc trước ạ.";

// Câu đúng cho ca "bạn tư vấn nói SP hỗ trợ X": xác nhận công dụng công bố, tách hỗ trợ khỏi điều
// trị, nhận phần diễn đạt chưa rõ về phía công ty, xin số. Phải lọt qua cả hai check.
const FOUR_STEP_REPLY =
  "Dạ đúng ạ, sản phẩm có hỗ trợ tiêu hóa, là thực phẩm bổ sung chứ không phải thuốc điều trị ạ. Nếu bên em nói chưa rõ thì em xin lỗi anh/chị, anh/chị cho em xin số điện thoại để bạn phụ trách gọi giải thích kỹ ạ.";

// Lần sau, khách hỏi viêm loét / trào ngược dạ dày: vẫn bác lời bạn tư vấn và bảo đi khám.
const LEAKED_STOMACH_REPLY =
  "Dạ đúng, em không có thông tin nào cho thấy các sản phẩm này hỗ trợ viêm loét hay trào ngược dạ dày. Đây là thực phẩm bổ sung, không thay thế thuốc ạ.\nVới bệnh dạ dày, anh/chị nên đi khám và dùng theo chỉ định của bác sĩ điều trị. Anh/chị cho em xin số điện thoại để bạn phụ trách xem lại lời tư vấn lúc trước ạ.";

describe("NO_MEDICAL_ADVICE", () => {
  test("ba tin đã lọt ra OA → bắt", () => {
    expect(NO_MEDICAL_ADVICE.check(LEAKED_DISEASE_REPLY)).toBeDefined();
    expect(NO_MEDICAL_ADVICE.check(LEAKED_CONTRADICT_REPLY)).toBeDefined();
    expect(NO_MEDICAL_ADVICE.check(LEAKED_STOMACH_REPLY)).toBeDefined();
  });

  test("'theo chỉ định', 'khám bệnh' không kèm chữ bác sĩ → bắt", () => {
    expect(NO_MEDICAL_ADVICE.check("Anh dùng theo chỉ định điều trị ạ")).toBeDefined();
    expect(NO_MEDICAL_ADVICE.check("Chú nên khám bệnh viện cho chắc ạ")).toBeDefined();
  });

  test("từng cụm riêng lẻ, NFD → bắt", () => {
    expect(NO_MEDICAL_ADVICE.check("Cô nên đi khám cho chắc ạ")).toBeDefined();
    expect(NO_MEDICAL_ADVICE.check("Chú hỏi ý kiến bác sĩ trước ạ")).toBeDefined();
    expect(NO_MEDICAL_ADVICE.check("Cần chẩn đoán mới biết ạ")).toBeDefined();
    expect(NO_MEDICAL_ADVICE.check("Chị tham khảo chuyên gia y tế trước ạ")).toBeDefined();
    expect(NO_MEDICAL_ADVICE.check("Chú hỏi ý kiến bác sĩ trước ạ".normalize("NFD"))).toBeDefined();
  });

  test("không còn ngoại lệ: 'đi khám ngay', 'cấp cứu' cũng bắt", () => {
    expect(
      NO_MEDICAL_ADVICE.check("Dạ cô đang khó thở thì cô đi khám ngay giúp con ạ, hoặc vào bệnh viện ngay."),
    ).toBeDefined();
  });

  test("ghi nhận rồi xin số, chữ 'khám' của việc khác → đạt", () => {
    expect(
      NO_MEDICAL_ADVICE.check(
        "Dạ vâng ạ, phần này để bạn tư vấn trao đổi kỹ lại với anh/chị. Anh/chị cho em xin số điện thoại để bạn gọi lại ạ.",
      ),
    ).toBeUndefined();
    expect(NO_MEDICAL_ADVICE.check("Gói bột bổ sung chất xơ inulin, pha với nước ấm ạ.")).toBeUndefined();
    expect(NO_MEDICAL_ADVICE.check(FOUR_STEP_REPLY)).toBeUndefined();
    expect(NO_MEDICAL_ADVICE.check("Dạ em đã khám phá thêm, hộp còn hạn tới 2027 ạ.")).toBeUndefined();
  });
});

describe("NO_CONTRADICT_CONSULTANT", () => {
  test("hai tin bác lời bạn tư vấn đã lọt ra OA → bắt", () => {
    expect(NO_CONTRADICT_CONSULTANT.check(LEAKED_CONTRADICT_REPLY)).toBeDefined();
    expect(NO_CONTRADICT_CONSULTANT.check(LEAKED_STOMACH_REPLY)).toBeDefined();
  });

  test("biến thể, NFD → bắt", () => {
    expect(NO_CONTRADICT_CONSULTANT.check("Em chưa có thông tin về việc đó ạ")).toBeDefined();
    expect(NO_CONTRADICT_CONSULTANT.check("Em không thể xác nhận điều này ạ".normalize("NFD"))).toBeDefined();
    expect(NO_CONTRADICT_CONSULTANT.check("Sản phẩm không có tác dụng đó đâu ạ")).toBeDefined();
  });

  test("câu 4 bước (xác nhận công dụng, nhận diễn đạt chưa chính xác) → đạt", () => {
    expect(NO_CONTRADICT_CONSULTANT.check(FOUR_STEP_REPLY)).toBeUndefined();
  });

  test("ghi nhận lời bạn tư vấn rồi xin số → đạt", () => {
    expect(
      NO_CONTRADICT_CONSULTANT.check(
        "Dạ vâng ạ, bạn tư vấn đã trao đổi với anh/chị rồi. Anh/chị cho em xin số điện thoại để bạn gọi lại nói kỹ hơn ạ.",
      ),
    ).toBeUndefined();
  });
});

describe("khai checks trên root", () => {
  test("hai kênh khách lẻ kiểm câu tư vấn bệnh và câu bác lời bạn tư vấn", () => {
    for (const profile of [customerProfile, saleFacebookProfile]) {
      expect(profile.replyChecks).toContain(NO_MEDICAL_ADVICE);
      expect(profile.replyChecks).toContain(NO_CONTRADICT_CONSULTANT);
    }
  });

  test("nhóm xác nhận đơn kiểm câu nhắc bác sĩ", () => {
    expect(xacNhanProfile.replyChecks).toContain(NO_DOCTOR_MENTION);
  });

  test("hai kênh khách lẻ kiểm câu miễn trừ quảng cáo", () => {
    expect(customerProfile.replyChecks).toContain(NO_AD_DISCLAIMER);
    expect(saleFacebookProfile.replyChecks).toContain(NO_AD_DISCLAIMER);
  });

  test("OA kiểm câu khuyên ngưng sản phẩm", () => {
    expect(customerProfile.replyChecks).toContain(NO_STOP_ADVICE);
  });

  test("hai kênh khách lẻ kiểm câu kết nhé/nha", () => {
    expect(customerProfile.replyChecks).toContain(NO_CASUAL_CLOSING);
    expect(saleFacebookProfile.replyChecks).toContain(NO_CASUAL_CLOSING);
  });
});
