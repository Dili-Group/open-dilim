// judge.test.ts — TẦNG 2 của phễu: luật biến xác suất thành quyết định, dữ kiện đem chấm, và
// hành vi khi cổng phán quyết hỏng. Không mạng, không LLM.
//
// Ba thứ phải chốt:
//   1. Ba cửa "việc của người khác / đã có người lo / đang bức xúc" chặn TRƯỚC, kể cả khi model
//      rất chắc là trợ lý làm được.
//   2. Ngưỡng nhặt đọc thẳng `noul` — đúng ngưỡng thì nhặt, dưới một chút thì thôi.
//   3. Cổng hỏng → đứng ngoài (fail-closed), vì tầng 0 không còn regex gác trước.

import { describe, expect, test } from "bun:test";
import { JudgeError, type AnswersOf, type JudgePort, type QuestionSet } from "../judge/index.ts";
import type { HistoryEntry } from "../types/index.ts";
import type { ProactiveJudgeSpec } from "./judge-spec.ts";
import {
  buildJudgeState,
  buildProactiveClassify,
  quyetDinh,
  type ProactiveAnswers,
} from "./judge.ts";
import type { PendingQuestion } from "./pending.ts";

const SPEC: ProactiveJudgeSpec = {
  capabilities: ["tra tình trạng đơn", "tra tiền cần chuyển"],
  policy: {
    minTuLamDuoc: 0.7,
    maxNhoDichDanh: 0.3,
    maxDaCoNguoiLo: 0.3,
    maxBucXuc: 0.3,
  },
};

function answers(over: Partial<ProactiveAnswers> = {}): ProactiveAnswers {
  return {
    tu_lam_duoc: { noul: 0.9, confidence: 0.85 },
    nho_dich_danh: { noul: 0.05, confidence: 0.9 },
    da_co_nguoi_lo: { noul: 0.05, confidence: 0.9 },
    dang_buc_xuc: { noul: 0.05, confidence: 0.9 },
    ...over,
  };
}

describe("quyetDinh", () => {
  test("đủ ngưỡng → nhặt, kèm điểm để soi lại sau", () => {
    expect(quyetDinh(answers(), SPEC)).toEqual({ nhat: true, diem: 0.9 });
  });

  test("đúng bằng ngưỡng vẫn nhặt, dưới ngưỡng một chút thì thôi", () => {
    expect(quyetDinh(answers({ tu_lam_duoc: { noul: 0.7, confidence: 0.9 } }), SPEC)).toEqual({
      nhat: true,
      diem: 0.7,
    });
    expect(quyetDinh(answers({ tu_lam_duoc: { noul: 0.69, confidence: 0.9 } }), SPEC)).toEqual({
      nhat: false,
      lyDo: "ngoai_pham_vi",
    });
  });

  test("nhờ đích danh người khác → đứng ngoài, dù rất chắc là làm được", () => {
    expect(quyetDinh(answers({ nho_dich_danh: { noul: 0.8, confidence: 0.9 } }), SPEC)).toEqual({
      nhat: false,
      lyDo: "nho_dich_danh_nguoi_khac",
    });
  });

  test("đã có người trong nhóm lo → đứng ngoài", () => {
    expect(quyetDinh(answers({ da_co_nguoi_lo: { noul: 0.7, confidence: 0.8 } }), SPEC)).toEqual({
      nhat: false,
      lyDo: "da_co_nguoi_lo",
    });
  });

  test("đang bức xúc → để NGƯỜI xử lý", () => {
    expect(quyetDinh(answers({ dang_buc_xuc: { noul: 0.6, confidence: 0.8 } }), SPEC)).toEqual({
      nhat: false,
      lyDo: "dang_buc_xuc",
    });
  });

  test("ba cửa chặn xếp TRƯỚC ngưỡng làm được: bức xúc thắng cả điểm 0.99", () => {
    const verdict = quyetDinh(
      answers({
        tu_lam_duoc: { noul: 0.99, confidence: 0.99 },
        dang_buc_xuc: { noul: 0.9, confidence: 0.9 },
      }),
      SPEC,
    );
    expect(verdict).toEqual({ nhat: false, lyDo: "dang_buc_xuc" });
  });
});

const QUESTION: PendingQuestion = {
  channel: "zalo",
  conversationId: "G1",
  senderId: "U1",
  senderName: "Chị Lan",
  msgId: "m1",
  text: "đơn hôm qua vẫn nằm im đó em",
  ts: 1_000,
};

function entry(over: Partial<HistoryEntry>): HistoryEntry {
  return {
    conversationId: "G1",
    msgId: "h1",
    senderId: "U1",
    text: "tin nào đó",
    isGroup: true,
    role: "user",
    ts: 900,
    ...over,
  };
}

describe("buildJudgeState", () => {
  const state = buildJudgeState({
    question: QUESTION,
    recent: [
      entry({ msgId: "h1", senderName: "Chị Lan", ts: 900 }),
      entry({ msgId: "h2", senderName: "NV Hà", senderId: "U2", text: "để em xem", ts: 1_500 }),
      entry({ msgId: "h3", senderId: "agent", role: "agent", text: "dạ em tra giúp", ts: 1_600 }),
    ],
    spec: SPEC,
  }) as Record<string, unknown>;

  test("tách tin TRƯỚC và SAU câu hỏi — câu hỏi 'đã có ai lo chưa' dựa vào phần sau", () => {
    expect(state.tin_truoc_cau_hoi).toEqual([{ ai: "Chị Lan", noi: "tin nào đó" }]);
    expect(state.tin_sau_cau_hoi).toEqual([
      { ai: "NV Hà", noi: "để em xem" },
      { ai: "trợ lý", noi: "dạ em tra giúp" },
    ]);
  });

  test("mang năng lực của agent, KHÔNG mang senderId nội bộ", () => {
    expect(state.tro_ly_lam_duoc).toEqual(["tra tình trạng đơn", "tra tiền cần chuyển"]);
    expect(JSON.stringify(state)).not.toContain("U1");
    expect(JSON.stringify(state)).not.toContain("U2");
  });
});

class FakeJudge implements JudgePort {
  constructor(private readonly outcome: ProactiveAnswers | Error) {}
  ask<Q extends QuestionSet>(): Promise<AnswersOf<Q>> {
    if (this.outcome instanceof Error) return Promise.reject(this.outcome);
    return Promise.resolve(this.outcome as unknown as AnswersOf<Q>);
  }
}

describe("buildProactiveClassify", () => {
  const input = { question: QUESTION, recent: [], spec: SPEC };

  test("phán quyết nhặt → true", async () => {
    const classify = buildProactiveClassify(new FakeJudge(answers()));
    expect(await classify(input)).toBe(true);
  });

  test("cổng phán quyết hỏng → FALSE (fail-closed), không ném ra poller", async () => {
    const classify = buildProactiveClassify(new FakeJudge(new JudgeError("sập", 529, true)));
    expect(await classify(input)).toBe(false);
  });

  test("lỗi KHÔNG phải của cổng (bug) → ném tiếp, không nuốt", () => {
    const classify = buildProactiveClassify(new FakeJudge(new Error("bug")));
    expect(classify(input)).rejects.toThrow("bug");
  });
});
