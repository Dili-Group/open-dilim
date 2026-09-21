// types.ts — hợp đồng tầng PHÁN QUYẾT (judge): chấm một `state` theo các câu hỏi có KHÔNG GIAN
// TRẢ LỜI KHAI TRƯỚC, trả giá trị có kiểu + phân phối xác suất + độ tin cậy.
//
// Khác LLM: không sinh chữ tự do nên không phải parse, không có giá trị lạ. Khác regex: đo Ý
// ĐỊNH chứ không đo từ ngữ, và trả ra CON SỐ để chỉnh ngưỡng.
//
// File LÁ: không import config, không I/O. Adapter thật nằm ở jev.ts.
//
// Kiểu ở đây là hợp đồng cho CHÍNH MÌNH — nó không chặn được nhà cung cấp đổi shape response.
// Vì vậy adapter BẮT BUỘC narrow runtime theo đúng định nghĩa câu hỏi (luật boundary của repo).

export interface NoulDef {
  readonly type: "noul";
  readonly instructions: string;
  /** Mô tả khi nào là đúng / khi nào là sai. Đây là thứ model đọc, viết như viết cho người. */
  readonly criteria: { readonly true: string; readonly false: string };
}

export interface ChoiceDef<O extends string = string> {
  readonly type: "choice";
  readonly instructions: string;
  readonly criteria: Readonly<Record<O, string>>;
}

export interface ScoreDef<L extends readonly string[] = readonly string[]> {
  readonly type: "score";
  readonly instructions: string;
  /** Thang ĐÃ SẮP THỨ TỰ, từ thấp tới cao. 2–10 mức. */
  readonly criteria: L;
}

export type QuestionDef = NoulDef | ChoiceDef<string> | ScoreDef<readonly string[]>;
export type QuestionSet = Readonly<Record<string, QuestionDef>>;

export interface NoulAnswer {
  /** Xác suất mệnh đề ĐÚNG, 0–1. */
  readonly noul: number;
  readonly confidence: number;
}

export interface ChoiceAnswer<O extends string> {
  readonly choice: O;
  /**
   * Xác suất từng option. CÓ THỂ RỖNG nếu nhà cung cấp đổi tên field — nơi gọi phải xử lý nhánh
   * thiếu (`noUncheckedIndexedAccess` ép sẵn), KHÔNG được đắp giá trị mặc định cho đủ.
   */
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export interface ScoreAnswer<L extends string> {
  readonly score: L;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

/** Kiểu câu trả lời SUY RA từ định nghĩa câu hỏi — khai câu hỏi một lần, dùng kiểu ở mọi nơi. */
export type AnswerOf<Q> = Q extends NoulDef
  ? NoulAnswer
  : Q extends ChoiceDef<infer O>
    ? ChoiceAnswer<O>
    : Q extends ScoreDef<infer L>
      ? ScoreAnswer<L[number] & string>
      : never;

export type AnswersOf<Q extends QuestionSet> = { readonly [K in keyof Q]: AnswerOf<Q[K]> };

export interface JudgeAsk<Q extends QuestionSet> {
  /** Dữ kiện đem chấm. Object/array chứ không phải chuỗi ghép — model đọc cấu trúc tốt hơn. */
  readonly state: unknown;
  readonly questions: Q;
}

export interface JudgePort {
  /**
   * Chấm một state. Mọi câu hỏi trong một lần gọi được chấm ĐỘC LẬP và SONG SONG → gom câu hỏi
   * lại gần như không tốn thêm độ trễ.
   *
   * NÉM `JudgeError` khi không đọc được kết quả. KHÔNG trả giá trị đoán: nơi gọi dựa vào đây để
   * fail-closed (hỏng thì đứng im), đoán bừa là biến lỗi hạ tầng thành hành vi sai.
   */
  ask<Q extends QuestionSet>(input: JudgeAsk<Q>, signal?: AbortSignal): Promise<AnswersOf<Q>>;
}

export class JudgeError extends Error {
  constructor(
    message: string,
    /** HTTP status, 0 = chưa có response (mạng/timeout). */
    readonly status: number,
    /** Thử lại có ích không (429/529/5xx/transport). 4xx và shape sai thì không. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "JudgeError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hàm dựng câu hỏi — dùng để giữ kiểu literal khi khai bằng object const.
// ─────────────────────────────────────────────────────────────────────────────

export function noul(
  instructions: string,
  criteria: { readonly true: string; readonly false: string },
): NoulDef {
  return { type: "noul", instructions, criteria };
}

export function choice<O extends string>(
  instructions: string,
  criteria: Readonly<Record<O, string>>,
): ChoiceDef<O> {
  return { type: "choice", instructions, criteria };
}

export function score<L extends readonly [string, string, ...string[]]>(
  instructions: string,
  criteria: L,
): ScoreDef<L> {
  return { type: "score", instructions, criteria };
}
