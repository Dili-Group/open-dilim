// types.ts — hợp đồng tầng workflows: VIỆC TREO CHỜ NGƯỜI Ở NHÓM KHÁC TRẢ LỜI (§6).
//
// Đây là cơ chế CHUNG, không thuộc nghiệp vụ nào. Một việc treo luôn có đúng hình dạng này:
//
//   nhóm A hỏi ──▶ [ghi pending] ──▶ đẩy 1 lượt cho agent nhóm B tự hỏi người
//        ▲                                              │
//        └──── báo kết quả ◀── [đóng pending] ◀── người ở B trả lời (giây → giờ → NGÀY)
//                                   ▲
//                        poller nhắc lại / đóng khi quá hạn
//
// Nghiệp vụ khác nhau chỉ khác ở: hỏi AI (resolveTarget), câu chữ (askText/resultText), hạn và
// nhịp nhắc. Tất cả gói trong MỘT `WorkflowDef` = DATA, đặt ở workflows/defs/. Thêm nghiệp vụ =
// thêm 1 file def + 1 dòng register — KHÔNG thêm bảng, KHÔNG thêm tool, KHÔNG đụng bộ máy.
//
// File LÁ: không import config.ts (fail-fast env), không import tầng agents → def, store và test
// cùng import được.

import type { PendingStatus } from "../db/schema.ts";
import type { Broadcaster } from "../broadcast/types.ts";
import type { Envelope, HistoryEntry } from "../types/index.ts";

/**
 * senderId của lượt do tầng workflows tự phát (câu hỏi + nhắc lại). AUTH vẫn resolve từ đây như
 * mọi tin khác → ra `guest`: lượt hỏi KHÔNG mang sẵn quyền gì, phạm vi dữ liệu của tool vẫn lấy
 * từ chủ nhóm.
 */
export const WORKFLOW_SENDER_ID = "workflow";

/** Một nhóm chat: cặp (kênh, id nhóm). Cùng shape cho nhóm hỏi lẫn nhóm trả lời. */
export interface RoomRef {
  readonly channel: string;
  readonly groupId: string;
}

/**
 * Một việc đang treo (hoặc đã đóng). Đúng phần code đọc — cột audit không có ở đây.
 *
 * `state` là dữ kiện RIÊNG của workflow (jsonb `state_snapshot`): bộ máy không đọc, chỉ chuyển
 * tiếp cho def. Def muốn nhớ gì thêm thì bỏ vào đây, không phải xin thêm cột.
 */
export interface PendingRequest {
  readonly id: string;
  readonly workflow: string;
  /** Khoá nghiệp vụ đã chuẩn hoá (mã đơn hoàn...). undefined = việc không có khoá. */
  readonly subject?: string;
  /** Nhóm PHẢI trả lời — đích bắn câu hỏi + nhắc lại. */
  readonly target: RoomRef;
  /** Nhóm ĐÃ hỏi — đích báo kết quả, kể cả 2 ngày sau. */
  readonly origin: RoomRef;
  /** senderId người đã hỏi, để @ lại lúc báo kết quả. */
  readonly requesterId: string;
  readonly state: Readonly<Record<string, unknown>>;
  /** Số lần đã hỏi (lần đầu tính 1). Đi vào msgId dedupe của lượt hỏi. */
  readonly askCount: number;
  /** Mốc nhắc kế tiếp — cũng là ô CAS claim. undefined = đã đóng, hoặc def không nhắc. */
  readonly nextRemindAt?: Date;
  readonly expiresAt: Date;
  readonly status: PendingStatus;
  /** Đáp án đã ghi. Chỉ có khi đã đóng bằng câu trả lời. */
  readonly answer?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowDef — KHAI BÁO một nghiệp vụ. DATA, không phải code chạy lượt.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ai phải trả lời việc này:
 *  - room           : tìm ra nhóm, kèm dữ kiện def muốn nhớ vào `state`.
 *  - unknown_subject: hệ thống không biết khoá này (mã không tồn tại).
 *  - no_room        : biết chủ nhưng chủ chưa có nhóm chat nào để mà hỏi.
 *  - failed         : gọi hệ ngoài hỏng (mạng/5xx) — THỬ LẠI ĐƯỢC, khác hẳn hai ca trên.
 */
export type TargetResolution =
  | { readonly kind: "room"; readonly room: RoomRef; readonly state?: Record<string, unknown> }
  | { readonly kind: "unknown_subject" }
  | { readonly kind: "no_room"; readonly detail: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Khai báo một nghiệp vụ chờ-trả-lời. Mọi thứ RIÊNG của nghiệp vụ nằm ở đây; bộ máy
 * (engine.ts + poller.ts) không biết gì về đơn hoàn, đại lý hay kho.
 *
 * Nhãn (`subjectLabel`, `answerLabel`, `targetLabel`) để TOOL CHUNG dựng câu trả lời cho người
 * dùng mà không phải biết nghiệp vụ: "đang chờ đại lý cho mã đơn gốc của mã đơn hoàn X".
 */
export interface WorkflowDef {
  /** Slug, cũng là giá trị cột `workflow`. Đổi tên = mồ côi mọi việc đang treo. */
  readonly name: string;
  /** Vd "mã đơn hoàn" — thứ người dùng đưa vào. */
  readonly subjectLabel: string;
  /** Vd "mã đơn gốc" — thứ chờ nhận về. */
  readonly answerLabel: string;
  /** Vd "đại lý" — bên phải trả lời. */
  readonly targetLabel: string;
  /** Hạn chờ. Quá hạn → đóng (Expired), thôi nhắc. */
  readonly ttlMs: number;
  /** Khoảng cách giữa hai lần nhắc. 0 = không nhắc, chỉ chờ tới hạn. */
  readonly remindIntervalMs: number;
  /** true = chỉ nhắc trong giờ hành chính VN (xem schedule.ts). */
  readonly officeHoursOnly: boolean;

  /** Khoá thô người/model gõ → khoá chuẩn hoá. undefined = không hợp lệ, không mở việc. */
  normalizeSubject(raw: string): string | undefined;
  /**
   * Đáp án thô → dạng lưu. undefined = không hợp lệ, KHÔNG đóng việc. Nhận thêm khoá việc cho
   * nghiệp vụ nào cần đối chiếu đáp án với khoá; def không cần thì bỏ qua tham số.
   */
  normalizeAnswer(raw: string, subject: string): string | undefined;
  /**
   * Hướng dẫn cho agent khi đáp án bị từ chối — nói rõ đáp án hợp lệ trông ra sao và phải làm gì
   * tiếp (ví dụ: đại lý chỉ cho SĐT khách → tra ra mã vận đơn trước rồi mới trả lời).
   */
  readonly answerHelp?: string;
  /** Tra nhóm phải trả lời. Lỗi hệ ngoài trả `failed`, KHÔNG throw. */
  resolveTarget(subject: string, signal?: AbortSignal): Promise<TargetResolution>;
  /**
   * CHỈ THỊ NỘI BỘ cho agent nhóm đích — không phải câu gửi thẳng cho người. Nó vào history
   * nhóm như một lượt `user`; agent đọc rồi tự soạn câu hỏi bằng giọng của nó.
   */
  askText(request: PendingRequest, isReminder: boolean): string;
  /** Tin báo kết quả về nhóm đã hỏi. Template cố định, KHÔNG qua LLM (xem engine.ts). */
  resultText(request: PendingRequest): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Port — bộ máy cần gì để chạy.
// ─────────────────────────────────────────────────────────────────────────────

/** Tham số mở việc. Mốc thời gian do engine tính từ `WorkflowDef`, store không tự quyết. */
export interface OpenPendingInput {
  readonly workflow: string;
  readonly subject?: string;
  readonly target: RoomRef;
  readonly origin: RoomRef;
  readonly requesterId: string;
  readonly state: Readonly<Record<string, unknown>>;
  /** undefined = không nhắc. */
  readonly nextRemindAt?: Date;
  readonly expiresAt: Date;
}

/** Tham số CAS claim lượt nhắc: chỉ đổi khi `expected` còn đúng giá trị vừa đọc. */
export interface ClaimRemindInput {
  readonly id: string;
  readonly expected: Date;
  readonly next: Date;
}

/** Đóng việc bằng câu trả lời. `resolvedBy` = senderId người trả lời (audit). */
export interface ResolvePendingInput {
  readonly id: string;
  readonly answer: string;
  readonly resolvedBy: string;
}

/**
 * Cổng đọc/ghi việc treo (bảng `pending_actions`). Postgres lúc chạy thật, in-mem lúc test.
 *
 * FIRE-ONCE nằm ở store, không ở lock ngoài: `open` dựa unique partial index (một việc treo cho
 * mỗi workflow+subject), `claimRemind` dựa CAS trên `next_remind_at`.
 */
export interface PendingStore {
  /** null = đã có việc treo cùng (workflow, subject) → caller báo "đang chờ rồi", KHÔNG hỏi lại. */
  open(input: OpenPendingInput): Promise<PendingRequest | null>;
  findOpen(workflow: string, subject: string): Promise<PendingRequest | undefined>;
  /** Việc ĐÃ có đáp án gần nhất — hỏi lại thứ đã xong thì trả luôn, không phiền nhóm kia. */
  findAnswered(workflow: string, subject: string): Promise<PendingRequest | undefined>;
  /** Việc treo mà nhóm NÀY phải trả lời — nạp vào ngữ cảnh lượt của họ. */
  openForTarget(room: RoomRef): Promise<PendingRequest[]>;
  /** Việc treo do nhóm NÀY hỏi — để nhóm đó tự soát cái còn chờ. */
  openForOrigin(room: RoomRef): Promise<PendingRequest[]>;
  dueForRemind(now: Date): Promise<PendingRequest[]>;
  /** false = instance khác đã giành lượt nhắc này → tick này im lặng rút. */
  claimRemind(input: ClaimRemindInput): Promise<boolean>;
  /**
   * undefined = việc không còn treo (đã trả lời / đã hết hạn ở instance khác) → caller KHÔNG
   * được báo kết quả lần hai.
   */
  resolve(input: ResolvePendingInput): Promise<PendingRequest | undefined>;
  /** Đóng mọi việc treo đã quá hạn. Trả số row đóng (để log). */
  expireDue(now: Date): Promise<number>;
}

/** Đầu publish của broker — tầng workflows là producer, không consume. */
export interface EnvelopePublisher {
  publish(envelope: Envelope): Promise<void>;
}

/** Ghi lượt vào history nhóm TRƯỚC khi publish (cùng thứ tự với ingest/scheduler). */
export interface HistoryAppender {
  append(entry: HistoryEntry): Promise<void>;
}

/** Chặn bắn trùng theo msgId (cùng cửa sổ dedupe với ingest). */
export interface DedupeGate {
  firstSee(channel: string, msgId: string): Promise<boolean>;
}

/** Bó port bộ máy cần. Bootstrap cấp implementation thật. */
export interface WorkflowDeps {
  readonly store: PendingStore;
  readonly broker: EnvelopePublisher;
  readonly history: HistoryAppender;
  readonly dedupe: DedupeGate;
  /** Báo kết quả về nhóm đã hỏi. Bắt buộc: mất tin này là bên hỏi không bao giờ biết đáp án. */
  readonly broadcaster: Broadcaster;
}
