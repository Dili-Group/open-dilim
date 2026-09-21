// judge.ts — TẦNG 2 của phễu: quyết định "câu này có đáng đánh thức agent không" bằng phán quyết
// CÓ KIỂU (judge/) thay cho danh sách regex.
//
// Vì sao bỏ regex: regex đo TỪ NGỮ, việc cần đo là Ý ĐỊNH. "đơn hôm qua vẫn nằm im" không có từ
// khoá nào; "cảm ơn c, chiết khấu ok rồi" thì trúng từ khoá mà chẳng ai cần giúp. Và regex không
// trả ra con số nào để biết mình đang sai bao nhiêu.
//
// Vì sao đặt ở tầng 2 chứ không thay thẳng tầng 0: tầng 0 chạy TRONG đường nóng webhook
// (message-ingest/gateway.ts gọi trước khi trả 202, bên trong vùng đã mark dedupe) — gọi mạng ở
// đó là làm chậm ingest và biến lỗi mạng thành nhả dedupe, bắt kênh gửi lại nguyên tin. Ở tầng 2
// thì tầng 1 (chờ xem người thật có đáp không) đã lọc gần hết, và không ai đang chờ câu trả lời.
//
// Chia đôi rõ: model TRẢ SỐ, còn LUẬT là `quyetDinh()` — hàm thuần, test không cần mạng.

import { choice, noul, score, type AnswersOf, type JudgePort } from "../judge/index.ts";
import { JudgeError } from "../judge/types.ts";
import type { HistoryEntry } from "../types/index.ts";
import { WORK_BUCKETS, type ProactiveJudgeSpec, type WorkBucket } from "./buckets.ts";
import type { PendingQuestion } from "./pending.ts";

/** Mức độ, sắp từ thấp tới cao — `score` đòi thang có thứ tự. */
const MUC_DO_LEVELS = ["binh_thuong", "hoi_gap", "buc_xuc"] as const;

/**
 * Năm câu hỏi, gửi trong MỘT request: Jev chấm chúng độc lập và song song nên thêm câu gần như
 * không thêm độ trễ, chỉ thêm ít token đầu vào.
 */
export const PROACTIVE_QUESTIONS = {
  tu_lam_duoc: noul(
    "Trợ lý có tự xử lý được yêu cầu trong `cau_hoi` bằng đúng những việc liệt kê ở `tro_ly_lam_duoc` không?",
    {
      true: "Yêu cầu nằm gọn trong danh sách việc trợ lý làm được, và có đủ dữ kiện để bắt đầu xử lý.",
      false:
        "Yêu cầu nằm ngoài danh sách đó, hoặc không phải yêu cầu nào cả, hoặc phải có người thật quyết định mới làm được.",
    },
  ),
  nhom_viec: choice("Yêu cầu trong `cau_hoi` thuộc nhóm việc nào?", WORK_BUCKETS),
  nho_dich_danh: noul(
    "Người hỏi có đang nhờ ĐÍCH DANH một người cụ thể trong nhóm không?",
    {
      true: "Có gọi tên, gọi chức danh, hoặc nhắc rõ một người cụ thể để nhờ việc đó.",
      false: "Hỏi chung cả nhóm, không chỉ định ai.",
    },
  ),
  da_co_nguoi_lo: noul(
    "Trong `tin_sau_cau_hoi`, đã có người nào đang xử lý hoặc đã trả lời đúng yêu cầu đó chưa?",
    {
      true: "Có người đã trả lời đúng việc đó, hoặc nói rõ là đang làm.",
      false:
        "Chưa ai đụng tới yêu cầu đó — danh sách rỗng, hoặc mọi người đang nói chuyện khác.",
    },
  ),
  muc_do: score("Giọng của người hỏi trong `cau_hoi` đang ở mức nào?", MUC_DO_LEVELS),
} as const;

export type ProactiveAnswers = AnswersOf<typeof PROACTIVE_QUESTIONS>;

export type JudgeVerdict =
  | { readonly nhat: true; readonly nhom: WorkBucket; readonly confidence: number }
  | { readonly nhat: false; readonly lyDo: string };

/**
 * Luật biến phân phối xác suất thành quyết định. Trả LÝ DO khi từ chối chứ không trả `false`
 * trần: lý do là thứ duy nhất cho phép chỉnh ngưỡng có căn cứ sau này.
 *
 * Thứ tự kiểm là thứ tự ưu tiên: ba cửa "việc của người khác / đã có người lo / đang bức xúc"
 * chặn TRƯỚC, kể cả khi model rất chắc là trợ lý làm được — chen vào mấy tình huống đó gây hại
 * nhiều hơn là giúp.
 */
export function quyetDinh(answers: ProactiveAnswers, spec: ProactiveJudgeSpec): JudgeVerdict {
  const { policy } = spec;

  if (answers.nho_dich_danh.noul >= policy.maxNhoDichDanh) {
    return { nhat: false, lyDo: "nho_dich_danh_nguoi_khac" };
  }
  if (answers.da_co_nguoi_lo.noul >= policy.maxDaCoNguoiLo) {
    return { nhat: false, lyDo: "da_co_nguoi_lo" };
  }
  // Bức xúc thì để NGƯỜI xử lý: agent nhảy vào giữa lúc người ta đang cáu là đổ thêm dầu.
  if (answers.muc_do.score === "buc_xuc") {
    return { nhat: false, lyDo: "dang_buc_xuc" };
  }
  if (answers.tu_lam_duoc.noul < policy.minTuLamDuoc) {
    return { nhat: false, lyDo: "ngoai_pham_vi" };
  }
  if (answers.tu_lam_duoc.confidence < policy.minConfidence) {
    return { nhat: false, lyDo: "khong_du_chac" };
  }

  const nhom = answers.nhom_viec.choice;
  if (!spec.capabilities.some((cap) => cap.bucket === nhom)) {
    return { nhat: false, lyDo: `nhom_ngoai_pham_vi:${nhom}` };
  }
  const prob = answers.nhom_viec.probabilities[nhom];
  // Thiếu phân phối = không đọc được field (nhà cung cấp đổi tên) → từ chối kèm lý do đọc được
  // ở log, thay vì im lặng coi như đủ ngưỡng.
  if (prob === undefined) return { nhat: false, lyDo: "thieu_phan_phoi" };
  if (prob < policy.minNhomViecProb) return { nhat: false, lyDo: "phan_van_giua_cac_nhom" };

  return { nhat: true, nhom, confidence: answers.tu_lam_duoc.confidence };
}

/** Trần cắt để state không phình: câu dài của người dùng đi thẳng vào token đầu vào. */
const MAX_TEXT_CHARS = 400;
const MAX_TIN_TRUOC = 6;
const MAX_TIN_SAU = 6;

export interface JudgeStateInput {
  readonly question: PendingQuestion;
  /** Cửa sổ history poller vừa đọc cho tầng 1 — dùng lại, không đọc Redis hai lần. */
  readonly recent: readonly HistoryEntry[];
  readonly spec: ProactiveJudgeSpec;
}

/**
 * Dữ kiện đem chấm. Object có cấu trúc chứ không phải một chuỗi ghép — model đọc theo khoá.
 *
 * KHÔNG đưa senderId, mã đơn hay số điện thoại vào đây ngoài phần text người ta tự gõ: state đi
 * sang một nhà cung cấp ngoài, đưa thừa định danh nội bộ không giúp gì cho phán quyết.
 */
export function buildJudgeState(input: JudgeStateInput): unknown {
  const { question, recent, spec } = input;
  const truoc = recent.filter((e) => e.ts <= question.ts).slice(-MAX_TIN_TRUOC);
  const sau = recent.filter((e) => e.ts > question.ts).slice(0, MAX_TIN_SAU);

  return {
    cau_hoi: {
      nguoi_hoi: question.senderName ?? "một người trong nhóm",
      noi_dung: cut(question.text),
    },
    tin_truoc_cau_hoi: truoc.map(toLine),
    tin_sau_cau_hoi: sau.map(toLine),
    tro_ly_lam_duoc: spec.capabilities.map((cap) => ({ nhom: cap.bucket, viec: cap.moTa })),
  };
}

function toLine(entry: HistoryEntry): { ai: string; noi: string } {
  return {
    ai: entry.role === "agent" ? "trợ lý" : (entry.senderName ?? "người trong nhóm"),
    noi: cut(entry.text),
  };
}

function cut(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
}

/** Chữ ký seam tầng 2 mà poller gọi. */
export type ProactiveClassify = (input: JudgeStateInput) => Promise<boolean>;

/**
 * Cắm cổng phán quyết vào phễu. FAIL-CLOSED: judge hỏng/timeout → KHÔNG nhặt.
 *
 * Đây là chỗ đổi luật so với seam cũ ("chưa nối thì cho qua"): luật cũ đúng khi regex còn đứng ở
 * tầng 0 gác trước. Bỏ regex rồi mà vẫn cho qua thì mọi câu chưa ai đáp đều đánh thức agent —
 * đúng kiểu spam mà cả phễu này sinh ra để tránh.
 */
export function buildProactiveClassify(judge: JudgePort): ProactiveClassify {
  return async (input) => {
    let answers: ProactiveAnswers;
    try {
      answers = await judge.ask({
        state: buildJudgeState(input),
        questions: PROACTIVE_QUESTIONS,
      });
    } catch (err) {
      if (!(err instanceof JudgeError)) throw err;
      console.warn(`[proactive] judge hỏng (${err.status}) → đứng ngoài: ${err.message}`);
      return false;
    }

    const verdict = quyetDinh(answers, input.spec);
    // Log đủ số để chỉnh ngưỡng sau vài ngày. KHÔNG log nội dung tin: nhóm đại lý nói cả chuyện
    // đơn hàng lẫn chuyện riêng, log text là rò sang nơi không ai kiểm soát vòng đời.
    console.info(
      `[proactive] judge msg=${input.question.msgId} nhat=${verdict.nhat} ` +
        `${verdict.nhat ? `nhom=${verdict.nhom}` : `lyDo=${verdict.lyDo}`} ` +
        `lam_duoc=${answers.tu_lam_duoc.noul.toFixed(2)}/${answers.tu_lam_duoc.confidence.toFixed(2)} ` +
        `dich_danh=${answers.nho_dich_danh.noul.toFixed(2)} ` +
        `co_nguoi_lo=${answers.da_co_nguoi_lo.noul.toFixed(2)} muc_do=${answers.muc_do.score}`,
    );
    return verdict.nhat;
  };
}
