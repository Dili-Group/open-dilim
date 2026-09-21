// buckets.ts — NHÓM VIỆC mà một tin nhóm có thể thuộc về, và hợp đồng khai phễu của agent.
//
// File LÁ, không import gì: `agents/types.ts` (khai ProactiveSpec) và `proactive/judge.ts` (dựng
// câu hỏi) cùng đọc từ đây, nếu để ở một trong hai thì thành vòng import.
//
// Danh sách nhóm là CỐ ĐỊNH cho mọi agent — nhờ vậy kiểu literal sống được tới chỗ quyết định
// (`spec.capabilities` khai sai nhóm là đỏ typecheck). Agent khác nhau ở chỗ nhận nhóm NÀO, chứ
// không ở chỗ định nghĩa lại nhóm.

/** Mô tả là thứ model đọc để phân loại → viết như viết cho người, không viết như tên biến. */
export const WORK_BUCKETS = {
  tra_don:
    "hỏi về một đơn cụ thể: tình trạng, mã vận đơn, đơn treo chưa đi, giục giao, huỷ đơn, lên lại đơn, đổi địa chỉ giao",
  tien_can_chuyen:
    "hỏi tiền phải chuyển cho công ty để đơn được đi, phiếu thanh toán gộp, mã QR chuyển khoản, đã nhận được tiền chưa",
  vi_chiet_khau:
    "hỏi ví tiền hàng, nạp ví, lịch sử ví, bậc chiết khấu, hoa hồng, điều kiện lên bậc",
  doi_soat:
    "đối soát số liệu một ngày: đơn đã xuất, đơn hoàn, tiền phải trả, bảng kê",
  het_hang: "hỏi còn hàng hay hết, khi nào có hàng lại",
  khieu_nai:
    "phàn nàn, bức xúc, hàng lỗi/vỡ/thiếu, đòi đền bù, chê trách cách phục vụ",
  nho_nguoi_khac:
    "nhờ đích danh một người cụ thể trong nhóm (gọi tên, gọi chức danh) làm giúp việc gì đó",
  tan_gau:
    "chào hỏi, cảm ơn, xác nhận đã nhận, thông báo nội bộ, chuyện ngoài lề — không có yêu cầu nào cần xử lý",
} as const;

export type WorkBucket = keyof typeof WORK_BUCKETS;

/** Một việc agent tự làm được, gắn với nhóm việc tương ứng. */
export interface ProactiveCapability {
  readonly bucket: WorkBucket;
  /** Mô tả cho model đọc, bằng tiếng Việt như nói với người mới vào: "tra tình trạng đơn…". */
  readonly moTa: string;
}

/**
 * Ngưỡng biến phân phối xác suất thành quyết định. Để ở SPEC của từng agent chứ không hằng chung:
 * agent đại lý nhảy nhầm vào một câu chỉ là hơi phiền, agent khác có thể đắt hơn nhiều.
 *
 * Mọi ngưỡng là 0–1. Con số khởi điểm chỉnh theo số đo thật, không phải chỉnh theo cảm giác.
 */
export interface JudgePolicy {
  /** Xác suất tối thiểu "trợ lý tự làm được việc này". */
  readonly minTuLamDuoc: number;
  /** Độ tin cậy tối thiểu của câu trên — phân phối bẹt = model đang lưỡng lự, đứng ngoài. */
  readonly minConfidence: number;
  /** Xác suất tối thiểu của nhóm việc được chọn. Thấp = model phân vân giữa nhiều nhóm. */
  readonly minNhomViecProb: number;
  /** Trên mức này coi như người hỏi đang nhờ đích danh người khác → không chen vào. */
  readonly maxNhoDichDanh: number;
  /** Trên mức này coi như trong nhóm đã có người đang lo → không chen vào. */
  readonly maxDaCoNguoiLo: number;
}

/** Phần khai phễu của một agent: làm được gì, và ngưỡng nào thì nhảy vào. */
export interface ProactiveJudgeSpec {
  readonly capabilities: readonly ProactiveCapability[];
  readonly policy: JudgePolicy;
}
