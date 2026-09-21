// judge-spec.ts — hợp đồng khai phễu của một agent: LÀM ĐƯỢC GÌ, và ngưỡng nào thì nhảy vào.
//
// File LÁ, không import gì: `agents/types.ts` (khai ProactiveSpec) và `proactive/judge.ts` (dựng
// câu hỏi) cùng đọc từ đây, nếu để ở một trong hai thì thành vòng import.

/**
 * Ngưỡng biến xác suất thành quyết định. Để ở SPEC của từng agent chứ không hằng chung: agent đại
 * lý nhảy nhầm vào một câu chỉ là hơi phiền, agent khác có thể đắt hơn nhiều.
 *
 * Mọi ngưỡng là 0–1, đọc thẳng từ `noul` (xác suất mệnh đề đúng). Con số khởi điểm chỉnh theo số
 * đo thật, không phải chỉnh theo cảm giác sau một ca nhặt nhầm.
 */
export interface JudgePolicy {
  /** Từ mức này trở lên thì nhặt: xác suất "trợ lý tự làm được việc trong câu hỏi". */
  readonly minTuLamDuoc: number;
  /** Từ mức này trở lên coi như người hỏi đang nhờ đích danh người khác → không chen vào. */
  readonly maxNhoDichDanh: number;
  /** Từ mức này trở lên coi như trong nhóm đã có người đang lo → không chen vào. */
  readonly maxDaCoNguoiLo: number;
  /** Từ mức này trở lên coi như người hỏi đang bức xúc → để NGƯỜI xử lý. */
  readonly maxBucXuc: number;
}

/** Phần khai phễu của một agent. */
export interface ProactiveJudgeSpec {
  /**
   * Việc agent TỰ LÀM ĐƯỢC, mỗi dòng một việc, viết như nói với người mới vào nghề. Đây là thứ
   * duy nhất câu hỏi `tu_lam_duoc` đối chiếu, nên viết thiếu là agent đứng ngoài việc của mình,
   * viết rộng quá là nhảy vào việc nó không làm nổi.
   */
  readonly capabilities: readonly string[];
  readonly policy: JudgePolicy;
}
