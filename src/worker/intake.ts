// intake.ts — CỔNG Ý ĐỊNH của phòng chuyên dụng: tin không @agent có phải việc của phòng không,
// quyết TRƯỚC khi tốn một lượt LLM.
//
// Vì sao không còn cổng regex `STT` ở ingest: regex đo TỪ NGỮ. Sale gõ lệch mẫu ("Khách Trang
// 94734 muốn BS gọi 16h"), tin sửa ("khách Trang đổi sang chiều nhé"), tin báo kết quả không có
// tiền tố `KQ:` — đều lọt, và lọt là mất dòng sổ im lặng.
//
// Vì sao ở worker, không ở ingest: ingest là đường nóng webhook (trước 202, trong vùng đã mark
// dedupe) — gọi mạng ở đó là làm chậm ingest và biến lỗi mạng thành nhả dedupe. Worker không ai
// đang chờ, chậm 70–500ms không sao.
//
// Hai bậc, rẻ trước:
//   1. KHUÔN (regex, 0 token) — tin mở bằng `STT <số>` là tin đăng ký, chạy thẳng. Đây là
//      gần như mọi tin đăng ký thật, và chúng mang tên khách + SĐT + bệnh: không gửi sang nhà cung
//      cấp ngoài chỉ để biết điều regex đã biết.
//   2. PHÁN QUYẾT (Jev) — chỉ tin lệch khuôn: đăng ký gõ lệch mẫu, sửa/bổ sung đăng ký.
// Jev vắng/hỏng → bỏ tin lệch khuôn. Không tệ hơn trước khi có cổng này: khi đó tin lệch khuôn
// cũng không bao giờ thành lượt, còn tin đúng khuôn vẫn đi qua bậc 1.

import type { DedicatedRoom } from "../agents/dedicated-rooms.ts";
import { matchesTemplate } from "../agents/dedicated-rooms.ts";
import { JudgeError, noul, type AnswersOf, type JudgePort } from "../judge/index.ts";
import type { HistoryEntry } from "../types/index.ts";

/** Số lượt history trước tin đang xét đưa vào state: đủ hiểu "khách đó đổi sang chiều nhé". */
export const INTAKE_CONTEXT_TURNS = 4;

/**
 * Từ mức này trở lên thì chạy lượt. Thấp hơn vạch nhặt của phễu proactive (0.70) vì cái giá lệch
 * hai chiều khác nhau: chạy nhầm = một lượt LLM agent thấy không có gì để ghi (prompt cho phép im);
 * bỏ nhầm = mất dòng sổ. Đo trên Jev thật — xem docs/architecture/13-xac-nhan-don-bac-si.md §0b.
 */
export const INTAKE_MIN_SCORE = 0.5;

/** Trần cắt để state không phình. Tin đăng ký đủ 5 mục (đi đường khuôn, không tới đây) dài ~600. */
const MAX_TEXT_CHARS = 800;
const MAX_CONTEXT_CHARS = 300;

export const INTAKE_QUESTIONS = {
  // Hỏi "có THUỘC loại nào không", không hỏi "có đủ mục không": tin thiếu mục vẫn là tin đăng ký,
  // và chính agent mới là người nói "thiếu lý do". Cổng mà đòi đủ mục là nuốt mất tin cần nhắc.
  viec_cua_phong: noul("Tin trong `tin` có thuộc một trong các loại ở `loai_tin_can_xu_ly` không?", {
    true: "Có — kể cả khi gõ thiếu mục, lệch mẫu, viết tắt, hay chỉ nhắc lại khách đã nói ở tin trước.",
    false: "Chỉ chào hỏi, cảm ơn, xác nhận đã đọc, tán gẫu, hoặc bàn chuyện khác không dính tới sổ.",
  }),
} as const;

export type IntakeAnswers = AnswersOf<typeof INTAKE_QUESTIONS>;

export interface IntakeInput {
  readonly room: DedicatedRoom;
  readonly text: string;
  readonly senderName?: string;
  /** History phòng, đã gồm chính tin này ở cuối (ingest append trước publish). */
  readonly recent: readonly HistoryEntry[];
  readonly msgId: string;
}

export interface IntakeVerdict {
  readonly run: boolean;
  /**
   * Ai quyết: khuôn regex, model phán quyết, hay model vắng/hỏng. Đi vào reason của lượt bị bỏ để
   * đếm được "bỏ vì tán gẫu" với "bỏ vì Jev sập".
   */
  readonly via: "template" | "judge" | "judge_unavailable";
  readonly score?: number;
}

/**
 * State đem chấm. CHỈ text tin + tên hiển thị — không senderId, không id nhóm: state đi sang nhà
 * cung cấp ngoài, định danh nội bộ không giúp gì cho phán quyết.
 */
export function buildIntakeState(input: IntakeInput): unknown {
  const before = input.recent
    .filter((entry) => entry.msgId !== input.msgId)
    .slice(-INTAKE_CONTEXT_TURNS);
  return {
    tin: { nguoi_gui: input.senderName ?? "một người trong nhóm", noi_dung: cut(input.text, MAX_TEXT_CHARS) },
    tin_truoc: before.map((entry) => ({
      ai: entry.role === "agent" ? "trợ lý" : (entry.senderName ?? "người trong nhóm"),
      noi: cut(entry.text, MAX_CONTEXT_CHARS),
    })),
    loai_tin_can_xu_ly: input.room.intakeKinds,
  };
}

function cut(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Luật thuần: số → quyết định. Tách khỏi I/O để test không cần mạng. */
export function decideIntake(answers: IntakeAnswers): IntakeVerdict {
  const score = answers.viec_cua_phong.noul;
  return { run: score >= INTAKE_MIN_SCORE, via: "judge", score };
}

/**
 * Tin này có đáng một lượt agent không. Khớp khuôn → chạy, không gọi mạng. Lệch khuôn → hỏi
 * `judge`; `judge` undefined (thiếu JEV_API_KEY) hoặc ném `JudgeError` → bỏ. Lỗi KHÁC JudgeError
 * là bug → ném tiếp cho lượt hỏng có vết, không nuốt.
 *
 * Log CHỈ msgId + số — không log text: tin đăng ký mang tên khách, 5 số cuối và tình trạng bệnh.
 */
export async function checkIntake(
  judge: JudgePort | undefined,
  input: IntakeInput,
  signal?: AbortSignal,
): Promise<IntakeVerdict> {
  if (matchesTemplate(input.room, input.text)) return { run: true, via: "template" };
  if (judge === undefined) return { run: false, via: "judge_unavailable" };
  let answers: IntakeAnswers;
  try {
    answers = await judge.ask({ state: buildIntakeState(input), questions: INTAKE_QUESTIONS }, signal);
  } catch (err) {
    if (!(err instanceof JudgeError)) throw err;
    console.warn(`[intake] judge hỏng (${err.status}) msg=${input.msgId} → bỏ tin lệch khuôn: ${err.message}`);
    return { run: false, via: "judge_unavailable" };
  }
  const verdict = decideIntake(answers);
  console.info(
    `[intake] msg=${input.msgId} run=${verdict.run} viec_cua_phong=${answers.viec_cua_phong.noul.toFixed(2)}`,
  );
  return verdict;
}
