// judge.test.ts — adapter Jev trên fetch GIẢ (không mạng). Bốn thứ phải chốt:
//   1. Body gửi đi đúng hợp đồng (model pin, state, questions) và có Bearer key.
//   2. Response được narrow THEO ĐỊNH NGHĨA CÂU HỎI — option lạ là lỗi, không phải giá trị.
//   3. Retry đúng chỗ: 429/5xx/transport thử lại; 401/422/shape sai thì không.
//   4. Thiếu `probabilities` KHÔNG làm chết cả phễu — trả {} để tầng policy từ chối có lý do.

import { describe, expect, test } from "bun:test";
import { JevJudge, type JudgeFetchInit, type JudgeFetchLike } from "./jev.ts";
import { JudgeError, choice, noul, score } from "./types.ts";

const QUESTIONS = {
  can_giup: noul("Có cần giúp không?", { true: "cần", false: "không" }),
  nhom: choice("Nhóm nào?", { don: "về đơn", tien: "về tiền" }),
  muc_do: score("Mức nào?", ["thap", "cao"] as const),
} as const;

const OK_BODY = {
  model: "jev-1.13.0",
  answers: {
    can_giup: { type: "noul", noul: 0.91, confidence: 0.88 },
    nhom: { type: "choice", choice: "don", probabilities: { don: 0.8, tien: 0.2 }, confidence: 0.7 },
    muc_do: { type: "score", score: "cao", probabilities: { thap: 0.1, cao: 0.9 }, confidence: 0.8 },
  },
  usage: { input_tokens: 1234, output_tokens: 0 },
};

/** fetch giả: trả lần lượt các response đã kịch bản, ghi lại request để soi. */
function fakeFetch(
  steps: readonly { status: number; body: unknown }[],
): { fetchImpl: JudgeFetchLike; calls: JudgeFetchInit[] } {
  const calls: JudgeFetchInit[] = [];
  let i = 0;
  const fetchImpl: JudgeFetchLike = (_url, init) => {
    calls.push(init);
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step === undefined) throw new Error("thiếu kịch bản");
    if (step.status === 0) return Promise.reject(new Error("mạng chết"));
    return Promise.resolve({
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      text: () => Promise.resolve(JSON.stringify(step.body)),
    });
  };
  return { fetchImpl, calls };
}

function judgeWith(steps: readonly { status: number; body: unknown }[]) {
  const { fetchImpl, calls } = fakeFetch(steps);
  const judge = new JevJudge({
    apiKey: "k-test",
    model: "jev-1.13.0",
    timeoutMs: 1000,
    fetchImpl,
  });
  return { judge, calls };
}

describe("JevJudge — gửi đi", () => {
  test("body mang model đã pin + state + questions, header có Bearer", async () => {
    const { judge, calls } = judgeWith([{ status: 200, body: OK_BODY }]);
    await judge.ask({ state: { cau_hoi: "đơn này sao rồi" }, questions: QUESTIONS });

    const init = calls[0];
    expect(init?.headers.authorization).toBe("Bearer k-test");
    const sent = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    expect(sent.model).toBe("jev-1.13.0");
    expect(sent.state).toEqual({ cau_hoi: "đơn này sao rồi" });
    expect(Object.keys(sent.questions as object)).toEqual(["can_giup", "nhom", "muc_do"]);
  });
});

describe("JevJudge — đọc về", () => {
  test("narrow đúng ba loại câu hỏi", async () => {
    const { judge } = judgeWith([{ status: 200, body: OK_BODY }]);
    const answers = await judge.ask({ state: {}, questions: QUESTIONS });

    expect(answers.can_giup.noul).toBe(0.91);
    expect(answers.can_giup.confidence).toBe(0.88);
    expect(answers.nhom.choice).toBe("don");
    expect(answers.nhom.probabilities.don).toBe(0.8);
    expect(answers.muc_do.score).toBe("cao");
  });

  test("option NGOÀI danh sách đã khai → lỗi, không nhận bừa", async () => {
    const body = {
      ...OK_BODY,
      answers: { ...OK_BODY.answers, nhom: { type: "choice", choice: "abc", confidence: 0.9 } },
    };
    const { judge } = judgeWith([{ status: 200, body }]);
    expect(judge.ask({ state: {}, questions: QUESTIONS })).rejects.toThrow(/trả choice lạ/);
  });

  test("thiếu một câu trả lời → lỗi, không đắp giá trị mặc định", async () => {
    const body = { ...OK_BODY, answers: { can_giup: OK_BODY.answers.can_giup } };
    const { judge } = judgeWith([{ status: 200, body }]);
    expect(judge.ask({ state: {}, questions: QUESTIONS })).rejects.toThrow(/thiếu câu trả lời/);
  });

  test("noul ngoài [0,1] → lỗi, không kẹp về biên", async () => {
    const body = {
      ...OK_BODY,
      answers: { ...OK_BODY.answers, can_giup: { type: "noul", noul: 7, confidence: 0.9 } },
    };
    const { judge } = judgeWith([{ status: 200, body }]);
    expect(judge.ask({ state: {}, questions: QUESTIONS })).rejects.toThrow(/thiếu noul/);
  });

  test("thiếu `probabilities` → trả {} để tầng policy từ chối có lý do, KHÔNG chết cả phễu", async () => {
    const body = {
      ...OK_BODY,
      answers: {
        ...OK_BODY.answers,
        nhom: { type: "choice", choice: "don", confidence: 0.7 },
      },
    };
    const { judge } = judgeWith([{ status: 200, body }]);
    const answers = await judge.ask({ state: {}, questions: QUESTIONS });
    expect(answers.nhom.choice).toBe("don");
    expect(answers.nhom.probabilities).toEqual({});
  });
});

describe("JevJudge — hỏng", () => {
  test("429 rồi 200 → thử lại và trả kết quả", async () => {
    const { judge, calls } = judgeWith([
      { status: 429, body: {} },
      { status: 200, body: OK_BODY },
    ]);
    const answers = await judge.ask({ state: {}, questions: QUESTIONS });
    expect(answers.can_giup.noul).toBe(0.91);
    expect(calls).toHaveLength(2);
  });

  test("401 → KHÔNG thử lại (sai cấu hình, thử lại ra y hệt)", async () => {
    const { judge, calls } = judgeWith([{ status: 401, body: {} }]);
    expect(judge.ask({ state: {}, questions: QUESTIONS })).rejects.toThrow(/HTTP 401/);
    await Promise.resolve();
    expect(calls).toHaveLength(1);
  });

  test("mạng chết → JudgeError retryable, hết lượt thì ném ra ngoài", async () => {
    const { judge, calls } = judgeWith([{ status: 0, body: {} }]);
    try {
      await judge.ask({ state: {}, questions: QUESTIONS });
      throw new Error("đáng lẽ phải ném");
    } catch (err) {
      expect(err).toBeInstanceOf(JudgeError);
      expect((err as JudgeError).status).toBe(0);
    }
    expect(calls).toHaveLength(3);
  });

  test("response thiếu `answers` → lỗi không đáng thử lại", async () => {
    const { judge, calls } = judgeWith([{ status: 200, body: { model: "x" } }]);
    expect(judge.ask({ state: {}, questions: QUESTIONS })).rejects.toThrow(/thiếu `answers`/);
    await Promise.resolve();
    expect(calls).toHaveLength(1);
  });
});
