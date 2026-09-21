// jev.ts — JudgePort chạy thật trên TypeSafe Jev (`POST /v1/systemone`).
//
// Gọi thẳng bằng fetch thay vì lấy SDK `@typesafe-ai/sdk`: repo chỉ có 4 dependency runtime, SDK
// kéo theo peer zod, mà response vẫn phải narrow tay ở boundary — thứ SDK cho thêm (suy kiểu)
// đã có sẵn ở types.ts.
//
// Đường gọi này CHỈ ĐỌC (chấm một state, không tạo gì) nên retry an toàn: 429/529/5xx/transport
// thử lại có backoff; 4xx và response sai shape thì không — thử lại cũng ra y hệt.
//
// Ném `JudgeError` cho mọi nhánh hỏng. Nơi gọi (phễu proactive) fail-closed: hỏng = đứng im.

import type {
  AnswersOf,
  JudgeAsk,
  JudgePort,
  QuestionDef,
  QuestionSet,
} from "./types.ts";
import { JudgeError } from "./types.ts";

const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1/systemone";
/** Chờ giữa hai lần thử (ms). Hai lần thử lại là đủ: tầng trên có nhịp tick riêng. */
const RETRY_BACKOFF_MS: readonly number[] = [250, 750];

/**
 * Chữ ký fetch tối giản, khai lại tại chỗ thay vì mượn `operational/agent-api.ts`: tầng judge
 * không phụ thuộc tầng vận hành, và gõ theo `typeof fetch` toàn cục thì TS thấy cả Response của
 * Bun lẫn của undici rồi báo không tương thích.
 */
export interface JudgeFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}
export interface JudgeFetchInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal: AbortSignal;
}
export type JudgeFetchLike = (url: string, init: JudgeFetchInit) => Promise<JudgeFetchResponse>;

export interface JevOptions {
  readonly apiKey: string;
  /**
   * PIN bản cụ thể (`jev-1.13.0`), đừng để `jev-latest` chạy prod: ngưỡng ở tầng policy được
   * chỉnh theo hành vi của đúng một bản model, bản đổi dưới chân là ngưỡng sai mà không ai biết.
   */
  readonly model: string;
  readonly timeoutMs: number;
  readonly baseUrl?: string;
  readonly fetchImpl?: JudgeFetchLike;
}

export class JevJudge implements JudgePort {
  private readonly baseUrl: string;
  private readonly fetchImpl: JudgeFetchLike;

  constructor(private readonly options: JevOptions) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  async ask<Q extends QuestionSet>(
    input: JudgeAsk<Q>,
    signal?: AbortSignal,
  ): Promise<AnswersOf<Q>> {
    const body = JSON.stringify({
      model: this.options.model,
      state: input.state,
      questions: input.questions,
    });

    const started = Date.now();
    const raw = await this.send(body, signal);
    const answers = readAnswers(input.questions, raw);
    console.info(
      `[judge] jev ${Date.now() - started}ms tokens=${readUsageTokens(raw)} model=${readModel(raw)}`,
    );
    return answers;
  }

  private async send(body: string, signal: AbortSignal | undefined): Promise<unknown> {
    let last: JudgeError | undefined;
    for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
      if (attempt > 0) await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 0);
      try {
        return await this.attempt(body, signal);
      } catch (err) {
        if (!(err instanceof JudgeError) || !err.retryable) throw err;
        last = err;
      }
    }
    throw last ?? new JudgeError("jev: hết lượt thử", 0, false);
  }

  private async attempt(body: string, signal: AbortSignal | undefined): Promise<unknown> {
    // Hạn giờ của TỪNG lần thử. Ghép với signal của lượt gọi để caller huỷ được giữa chừng.
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const merged = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

    let response: JudgeFetchResponse;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body,
        signal: merged,
      });
    } catch (err) {
      // Người gọi chủ động huỷ thì KHÔNG phải lỗi đáng thử lại.
      const aborted = signal?.aborted === true;
      throw new JudgeError(`jev: gọi hỏng (${describe(err)})`, 0, !aborted);
    }

    const text = await response.text();
    if (!response.ok) {
      // 401/422 = sai cấu hình hoặc sai body, thử lại ra y hệt. 429/529/5xx thì đáng thử lại.
      const retryable = response.status === 429 || response.status >= 500;
      throw new JudgeError(`jev: HTTP ${response.status}`, response.status, retryable);
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new JudgeError("jev: response không phải JSON", response.status, false);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(err: unknown): string {
  return err instanceof Error ? err.name : "lỗi lạ";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readModel(raw: unknown): string {
  const model = isRecord(raw) ? raw.model : undefined;
  return typeof model === "string" ? model : "?";
}

function readUsageTokens(raw: unknown): number {
  const usage = isRecord(raw) ? raw.usage : undefined;
  const input = isRecord(usage) ? usage.input_tokens : undefined;
  return typeof input === "number" ? input : 0;
}

/**
 * Narrow response theo ĐÚNG định nghĩa câu hỏi đã gửi đi. Thiếu câu, sai kiểu, option lạ →
 * `JudgeError`, KHÔNG đắp giá trị mặc định: phán quyết dựng trên số bịa còn tệ hơn không phán.
 *
 * Ép kiểu một lần ở cuối là cố ý và là chỗ DUY NHẤT: từng answer vừa được kiểm bằng tay theo
 * `def`, nhưng TS không nối được quan hệ "def này ↔ nhánh kia" xuyên qua vòng lặp.
 */
function readAnswers<Q extends QuestionSet>(questions: Q, raw: unknown): AnswersOf<Q> {
  const body = isRecord(raw) ? raw.answers : undefined;
  if (!isRecord(body)) throw new JudgeError("jev: response thiếu `answers`", 200, false);

  const out: Record<string, unknown> = {};
  for (const [id, def] of Object.entries(questions)) {
    const answer = body[id];
    if (!isRecord(answer)) throw new JudgeError(`jev: thiếu câu trả lời "${id}"`, 200, false);
    out[id] = readOne(id, def, answer);
  }
  return out as AnswersOf<Q>;
}

function readOne(id: string, def: QuestionDef, answer: Record<string, unknown>): unknown {
  const confidence = readUnit(answer.confidence);
  switch (def.type) {
    case "noul": {
      const value = readUnit(answer.noul);
      if (value === undefined) throw new JudgeError(`jev: "${id}" thiếu noul`, 200, false);
      return confidence === undefined ? { noul: value } : { noul: value, confidence };
    }
    case "choice":
      return readPicked(id, answer, "choice", Object.keys(def.criteria), confidence);
    case "score":
      return readPicked(id, answer, "score", [...def.criteria], confidence);
  }
}

/** choice và score đọc y hệt nhau, chỉ khác tên field và nguồn danh sách giá trị hợp lệ. */
function readPicked(
  id: string,
  answer: Record<string, unknown>,
  field: "choice" | "score",
  allowed: readonly string[],
  confidence: number | undefined,
): unknown {
  const picked = answer[field];
  if (typeof picked !== "string" || !allowed.includes(picked)) {
    throw new JudgeError(`jev: "${id}" trả ${field} lạ`, 200, false);
  }
  const parsed = {
    [field]: picked,
    probabilities: readProbabilities(answer.probabilities, allowed),
  };
  return confidence === undefined ? parsed : { ...parsed, confidence };
}

/**
 * Phân phối xác suất. Nhà cung cấp đổi tên field → trả {} chứ không ném: nơi gọi có nhánh
 * "thiếu phân phối" riêng (từ chối kèm lý do đọc được), như vậy lỗi lộ ra ở log thay vì làm
 * chết cả phễu.
 */
function readProbabilities(raw: unknown, allowed: readonly string[]): Record<string, number> {
  if (!isRecord(raw)) return {};
  const out: Record<string, number> = {};
  for (const key of allowed) {
    const value = readUnit(raw[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Số trong [0,1]. Ngoài khoảng = không đọc được, không kẹp về biên. */
function readUnit(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : undefined;
}
