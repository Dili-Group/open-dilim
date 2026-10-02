import { describe, expect, test } from "bun:test";
import { xacNhanRoom, type DedicatedRoom } from "../agents/dedicated-rooms.ts";
import { JudgeError, type AnswersOf, type JudgeAsk, type JudgePort, type QuestionSet } from "../judge/index.ts";
import type { HistoryEntry } from "../types/index.ts";
import { buildIntakeState, checkIntake, decideIntake, INTAKE_MIN_SCORE, type IntakeInput } from "./intake.ts";

function requireRoom(): DedicatedRoom {
  const built = xacNhanRoom("G-XN");
  if (built === undefined) throw new Error("xacNhanRoom phải dựng được với id hợp lệ");
  return built;
}
const room = requireRoom();

function entry(over: Partial<HistoryEntry>): HistoryEntry {
  return {
    conversationId: "G-XN",
    msgId: "m0",
    senderId: "u0",
    text: "",
    isGroup: true,
    role: "user",
    ts: 1,
    ...over,
  };
}

function input(text: string, recent: readonly HistoryEntry[] = []): IntakeInput {
  return { room: room, text, senderName: "Hoàng Hà", recent, msgId: "m9" };
}

/** Judge giả: trả đúng một điểm, hoặc ném lỗi đã cho. Ghi lại state để soi. */
class FakeJudge implements JudgePort {
  readonly states: unknown[] = [];
  constructor(private readonly outcome: number | Error) {}
  ask<Q extends QuestionSet>(req: JudgeAsk<Q>): Promise<AnswersOf<Q>> {
    this.states.push(req.state);
    if (this.outcome instanceof Error) return Promise.reject(this.outcome);
    const answers: Record<string, unknown> = {};
    for (const id of Object.keys(req.questions)) answers[id] = { noul: this.outcome };
    // Dựng tay theo đúng bộ câu hỏi vừa nhận — cùng cách adapter thật làm ở jev.ts.
    return Promise.resolve(answers as AnswersOf<Q>);
  }
}

describe("decideIntake — luật thuần", () => {
  test("đúng vạch thì chạy, dưới vạch thì bỏ", () => {
    expect(decideIntake({ viec_cua_phong: { noul: INTAKE_MIN_SCORE } }).run).toBe(true);
    expect(decideIntake({ viec_cua_phong: { noul: INTAKE_MIN_SCORE - 0.01 } }).run).toBe(false);
  });
});

/**
 * Tin đăng ký thật của nhóm 29/09–02/10/2026, ĐÃ ẨN DANH (đổi tên khách + 5 số cuối). Giữ nguyên
 * từng kiểu gõ lệch: `STT:   3`, `Stt 4 MKA`, `STT 1: NVH`, `Stt 05 nvh(đã kí rule)`, thiếu ngoặc,
 * 6 chữ số, số trong ngoặc — đó chính là thứ cổng phải bắt.
 */
const REAL_REGISTRATIONS: readonly string[] = [
  "STT 05 VĐĐ (đã ký rule) \n1. Tên KH: Chị Hà  11111\n2. Tình Trạng: chóng mặt , rối loạn tiền đình , mỡ máu cao \n3. Đã Tư vấn: Natto \n4. Lý do xn: thấy nhiều bác Sơn trên mạng quá nên sợ giả mạo\n5. khung giờ: 16-17h ngày 29/9",
  "STT 06 NVH (đã ký rule) \n1. Tên KH: ANH NAM 22222\n2. Tình Trạng: chóng mặt , rối loạn tiền đình , mỡ máu cao \n3. Đã chốt  Dha Rich\n4. Lý do xn: thấy nhiều bác Sơn trên mạng quá nên sợ giả mạo\n5. khung giờ: 16-17h ngày 29/9",
  "STT 08 VĐĐ (đã ký rule) \n1. Tên KH: Chị Lan 33333\n2. Tình Trạng: đau đầu gối trái, đêm nằm nhức\n3. Đã Tư vấn: sụn\n4. Lý do xn: sợ giả mạo. Muốn hỏi bác xem uống sụn có hết đau không\n5. khung giờ: 16-17h ngày 29/9 ( gọi qua sim vì khách không dùng zalo ạ)",
  "STT 09 VDD đã ký rule) \n1. Tên KH: Cô Mai(44444)\n2. Tình Trạng: Đau đầu choáng thoái hóa đốt sống cổ 63t\n3. Đã tư Vấn: Natto- sụn muốn lấy natto trước\n4. Lý do xn: thấy nhiều bác Sơn trên mạng quá nên sợ giả mạo\n5. khung giờ: 16-17h ngày 29/9",
  "STT 02 VDD đã ký rule) \n1. Tên KH: Chú Bình(055555)\n2. Tình Trạng:  Mỡ máu cao chóng mặt 63t\n3. Đã tư Vấn: Nattokinase \n4. Lý do xn: sợ giả mạo\n5. khung giờ: 11-12h",
  "STT:   3 NTA ( đã kí rule)   \n1, Tên KH:A Tùng 66666\n2, Tình trạng: Huyết áp cao\n3, Đã tư vấn: Natto\n4, Lí do XN: Sợ mua hàng giả, gặp đúng B Sơn để yên tâm hơn \n5, Khung H XN: 11-12h",
  "Stt 4 MKA  ( đã ký rule)\n1. Ten KH : Chị Cúc : 77777\n2. Tình trạng:  viêm loét dạ dày\n3. Đang dùng men nghệ , natto sụn\n4. Lí do: uống vào thấy mệt , khó ngủ , muốn gặp Bác để yên tâm sử dụng tiếp\n5. Khung giờ  11-12h",
  "STT 02 VDD ( đã ký rule )\n1. Tên Kh : Cô Đào(88888)\n2. Tình Trạng : người lênh đênh mệt mỏi \n3. Đã tv : Nattokinase \n4 . Lý do xn : sợ hàng giả k đúng bên bác \n5. Khung giờ .11-12h",
  "Stt 05 nvh(đã kí rule)\n1. Tên: cô Huệ 99999\n2. Tình trạng: 63 tuổi hay đau nửa đầu\n3. Đang dùng: natto và sụn\n4. Lý do: con bảo vứt đi sợ hàng giả\n5. Khung giờ: 16-17h",
  "STT 1: NVH ( đã ký rule )\n1. Tên Kh : chị Yến (12345) \n2. Tình Trạng : Đau lưng, thoát vị đĩa đệm \n3. Đã tư vấn: Sụn cá mập \n4 . Lý do xn : sợ hàng giả k đúng bên bác \n5. Khung giờ 11-12h",
  "STT 2 DA (đã ký rule) \n1. Tên Kh: Cô Sen 54321\n2. Tình Trạng: đau khơp gối\n3. Đã tư vấn: sụn cá mập \n4. Lý Do xn: gặp bác để hỏi thêm \n5. Khung giờ: 11-12h",
];

describe("checkIntake", () => {
  test("mọi tin đăng ký thật → chạy theo KHUÔN, KHÔNG gọi judge (không gửi dữ liệu khách ra ngoài)", async () => {
    const judge = new FakeJudge(0);
    for (const text of REAL_REGISTRATIONS) {
      expect(await checkIntake(judge, input(text))).toEqual({ run: true, via: "template" });
    }
    expect(judge.states).toHaveLength(0);
  });

  test("khớp khuôn thì chạy cả khi chưa có judge", async () => {
    expect((await checkIntake(undefined, input("STT 3 NTA"))).run).toBe(true);
  });

  test("báo kết quả kiểu `KQ:` KHÔNG còn là khuôn — agent không ghi kết quả", async () => {
    expect((await checkIntake(undefined, input("KQ: 94734 đã chốt"))).run).toBe(false);
  });

  test("lệch khuôn, judge chấm cao → chạy lượt", async () => {
    const verdict = await checkIntake(new FakeJudge(0.9), input("khách Trang đổi sang chiều nhé"));
    expect(verdict).toEqual({ run: true, via: "judge", score: 0.9 });
  });

  test("lệch khuôn, judge chấm thấp → bỏ", async () => {
    expect((await checkIntake(new FakeJudge(0.1), input("ok em"))).run).toBe(false);
  });

  test("lệch khuôn, thiếu judge hoặc judge hỏng → bỏ, ghi rõ lý do để đếm", async () => {
    expect(await checkIntake(undefined, input("khách đổi sang chiều"))).toEqual({
      run: false,
      via: "judge_unavailable",
    });
    const broken = new FakeJudge(new JudgeError("jev: HTTP 529", 529, true));
    expect(await checkIntake(broken, input("khách đổi sang chiều"))).toEqual({
      run: false,
      via: "judge_unavailable",
    });
  });

  test("lỗi KHÔNG phải JudgeError là bug → ném tiếp, không nuốt", async () => {
    const buggy = new FakeJudge(new TypeError("bug"));
    await expect(checkIntake(buggy, input("khách đổi sang chiều"))).rejects.toThrow("bug");
  });
});

describe("buildIntakeState", () => {
  test("bỏ chính tin đang xét khỏi ngữ cảnh, giữ các tin trước, không mang id nội bộ", () => {
    const recent = [
      entry({ msgId: "m1", senderName: "Hoàng Hà", text: "STT: 8 NVH\n1, Tên KH: chị Trang 94734" }),
      entry({ msgId: "m2", role: "agent", text: "Đã ghi, thứ tự 3" }),
      entry({ msgId: "m9", text: "khách đổi sang chiều nhé" }),
    ];
    const state = buildIntakeState(input("khách đổi sang chiều nhé", recent));
    expect(state).toEqual({
      tin: { nguoi_gui: "Hoàng Hà", noi_dung: "khách đổi sang chiều nhé" },
      tin_truoc: [
        { ai: "Hoàng Hà", noi: "STT: 8 NVH 1, Tên KH: chị Trang 94734" },
        { ai: "trợ lý", noi: "Đã ghi, thứ tự 3" },
      ],
      loai_tin_can_xu_ly: room.intakeKinds,
    });
    expect(JSON.stringify(state)).not.toContain("u0");
  });
});
