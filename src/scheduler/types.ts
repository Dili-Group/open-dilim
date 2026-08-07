// types.ts — hợp đồng của tầng scheduler (§8). Không import config/db/redis → test được bằng fake.
//
// Job def sống ở Postgres (durable). `nextRunAt` vừa là due-index vừa là ô CAS: poller giành job
// bằng UPDATE ... WHERE next_run_at = <giá trị vừa đọc> → hai process cùng tick chỉ 1 cái thắng.

import type { Broadcaster, TypingSender } from "../broadcast/index.ts";
import type { Envelope, HistoryEntry } from "../types/index.ts";

/** 1 job đã lên lịch. Đây là phần poller cần — cột audit (created_at/updated_at) không đọc. */
export interface SchedulerJob {
  readonly id: string;
  /** Cron 5 trường, đọc theo GIỜ VN (xem schedule.ts). */
  readonly schedule: string;
  /** Kênh chat: chọn root agent (agents/router.ts) + adapter egress. Y hệt message thường. */
  readonly channel: string;
  /**
   * senderId mà job chạy DƯỚI DANH NGHĨA. Worker resolve vai từ đây qua auth như mọi tin khác
   * → job KHÔNG có "quyền root". Không có binding nào khớp → guest (tool nghiệp vụ vẫn chạy được
   * vì phạm vi dữ liệu lấy từ chủ phòng, xem tools/impl/order/scope.ts).
   */
  readonly identity: string;
  /** "Kiểm tra gì" — text đi vào history phòng như một lượt người dùng. */
  readonly task: string;
  /** conversationId đích: vừa là phòng nạp ngữ cảnh, vừa là đích broadcast. */
  readonly target: string;
  /** undefined = job chưa lên lịch lần nào (mới thêm vào DB) → tick này chỉ set lịch, KHÔNG bắn. */
  readonly nextRunAt?: Date;
}

/** Tham số CAS claim: chỉ đổi lịch khi `expected` còn đúng giá trị vừa đọc. */
export interface ClaimInput {
  readonly id: string;
  /** Giá trị `next_run_at` lúc đọc. undefined = kỳ vọng NULL (job mới). */
  readonly expected?: Date;
  /** Mốc chạy kế tiếp, đã tính từ cron expr. */
  readonly next: Date;
  /** Mốc vừa bắn — undefined khi tick này chỉ lên lịch, không bắn. */
  readonly ran?: Date;
}

/** 1 job nhìn từ phía người quản (flash command `/lich`) — không có `identity`/`channel`. */
export interface JobSummary {
  readonly id: string;
  readonly schedule: string;
  readonly task: string;
  readonly enabled: boolean;
  readonly nextRunAt?: Date;
}

/**
 * Cổng QUẢN job cho flash command. Tách khỏi JobRepo (cổng của poller) vì hai bên khác nhau về
 * quyền: poller đọc mọi job và tự đổi lịch; `/lich` chỉ đụng job của ĐÚNG phòng đang gõ.
 *
 * Mọi thao tác đều nhận (channel, target, shortId): mã ngắn CHỈ có nghĩa TRONG phòng đang gõ.
 * Không có API nào đụng job của phòng khác — nhóm A không tắt/xoá được việc của nhóm B.
 */
export interface JobAdmin {
  /** Thêm job. `next_run_at` để NULL → tick kế tiếp của poller đặt lịch đầu tiên (không bắn ngay). */
  create(job: {
    readonly id: string;
    readonly schedule: string;
    readonly channel: string;
    readonly identity: string;
    readonly task: string;
    readonly target: string;
  }): Promise<void>;
  /** Job của phòng này (cả đang tắt) — `/lich` không args liệt kê ra. */
  listByTarget(p: { readonly channel: string; readonly target: string }): Promise<JobSummary[]>;
  /**
   * Sửa lịch và/hoặc mô tả việc. Bỏ trống trường nào thì giữ nguyên trường đó. Đổi `schedule`
   * → `next_run_at` reset về NULL để poller tính lại (giữ mốc cũ là chạy theo giờ đã xoá).
   */
  update(p: {
    readonly channel: string;
    readonly target: string;
    readonly shortId: string;
    readonly schedule?: string;
    readonly task?: string;
  }): Promise<boolean>;
  /**
   * Bật/tắt job. Bật lại cũng reset `next_run_at` → job tắt cả tuần không bắn bù một phát ngay
   * lúc bật.
   */
  setEnabled(p: {
    readonly channel: string;
    readonly target: string;
    readonly shortId: string;
    readonly enabled: boolean;
  }): Promise<boolean>;
  /** Xoá hẳn job khỏi bảng. Không khôi phục được — `/lich tat` mới là cách dừng tạm. */
  remove(p: {
    readonly channel: string;
    readonly target: string;
    readonly shortId: string;
  }): Promise<boolean>;
}

/** Cổng đọc/ghi job def. Postgres lúc chạy thật, in-mem lúc test. */
export interface JobRepo {
  /** Job đang bật, tới hạn hoặc chưa lên lịch. Sắp xếp job chưa lên lịch trước. */
  due(now: Date): Promise<SchedulerJob[]>;
  /** false = job đã bị process khác giành (next_run_at đổi) → tick này bỏ qua, KHÔNG bắn. */
  claim(input: ClaimInput): Promise<boolean>;
}

/** Đầu publish của broker (scheduler là producer, không consume). */
export interface EnvelopePublisher {
  publish(envelope: Envelope): Promise<void>;
}

/** Ghi lượt cron vào history phòng TRƯỚC khi publish (xem fire.ts). */
export interface HistoryAppender {
  append(entry: HistoryEntry): Promise<void>;
}

/** Chặn bắn trùng theo msgId (cùng cửa sổ dedupe với ingest). */
export interface DedupeGate {
  firstSee(channel: string, msgId: string): Promise<boolean>;
}

/** Chọn TypingSender theo kênh (TypingFactory lúc chạy thật). */
export interface TypingLookup {
  for(channel: string): TypingSender;
}

/**
 * Bó port scheduler cần. Bootstrap cấp implementation thật.
 *
 * `typing`/`broadcaster` là báo trước "sắp chạy job" cho phòng — cosmetic, best-effort: thiếu
 * hoặc hỏng thì job VẪN bắn (xem announceFiring trong fire.ts).
 */
export interface SchedulerDeps {
  readonly repo: JobRepo;
  readonly broker: EnvelopePublisher;
  readonly history: HistoryAppender;
  readonly dedupe: DedupeGate;
  readonly typing?: TypingLookup;
  readonly broadcaster?: Broadcaster;
}
