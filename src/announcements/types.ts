// types.ts — hợp đồng tầng announcements: PHÁT MỘT TIN TỚI MỌI NHÓM ĐẠI LÝ.
//
// Khác workflows/ (§6) ở HÌNH DẠNG, không chỉ ở quy mô: ở đó là hỏi MỘT nhóm rồi chờ MỘT đáp án;
// ở đây là bắn cùng một tin tới N nhóm và không chờ ai. Ba chỗ không dùng lại được:
//   - `dispatchAsk` đẩy Envelope → mỗi nhóm chạy một lượt LLM, tin sẽ KHÁC NHAU giữa các nhóm.
//   - `findAnswered` chặn mở lại cùng khoá → sản phẩm hết lần hai sẽ không gửi được.
//   - unique (workflow, subject) buộc ghép sản phẩm + đại lý + mốc thời gian vào một chuỗi khoá.
// Nên: bảng riêng, poller riêng, và phía nhận đi đường broadcast (như `notifyOrigin`) — 0 LLM.
//
// BỀN THEO TỪNG NHÓM: chốt gửi = ghi N row `pending`, poller mới thật sự gửi. Worker chết giữa
// đợt thì row chưa gửi vẫn còn, tick sau chạy tiếp. Đây là lý do tồn tại của bảng.
//
// HAI CHỮ KÝ mới phát được — quy tắc cứng của hệ thống, không phải tuỳ chọn:
//   1. Thủ kho soạn nháp rồi CHỐT (nháp Redis, TTL 10 phút — người thật đọc lại trước khi chốt).
//   2. NGƯỜI DUYỆT ĐÍCH DANH gật (`CONFIG.announce.approverUserId`) qua flash command.
// Trước chữ ký thứ hai, mọi row nhận có `next_attempt_at = NULL` nên không tick nào nhặt. Cửa
// duyệt nằm ở DỮ LIỆU, không ở prompt: model không có đường nào bỏ qua nó, kể cả bị lái.
//
// Người duyệt nhận diện bằng `user_id` hệ vận hành, KHÔNG bằng senderId (đổi thiết bị là mất) và
// KHÔNG bằng role_slug (quy tắc chỉ đích danh một người, không phải một chức danh).
//
// File LÁ: không import config.ts (fail-fast env), không import tầng agents/tools.

import type { AnnouncementStatus as AnnouncementStatusCode, DeliveryStatus } from "../db/schema.ts";
import type { Broadcaster } from "../broadcast/types.ts";
import type { HistoryEntry } from "../types/index.ts";

/** Loại tin phát chung. Không đổi cách gửi — chỉ để soát và thống kê. */
export const AnnouncementKind = {
  HetHang: "het_hang",
} as const;
export type AnnouncementKind = (typeof AnnouncementKind)[keyof typeof AnnouncementKind];

/**
 * Số lần thử một nhóm trước khi chịu thua. Nhóm bị xoá / bot bị kick thì thử mãi cũng vậy.
 *
 * Đặt ở FILE LÁ này chứ không ở poller.ts vì tool cần đọc nó để nói với người dùng "hệ thống tự
 * thử lại tối đa N lần". Tool mà import poller (hay barrel index.ts) là kéo `db/client.ts` →
 * `config.ts` vào cả tầng tools → mọi test import tools chết ngay lúc import khi thiếu env.
 */
export const MAX_ATTEMPTS = 4;

/** Một nhóm đại lý sẽ nhận tin. `customerId` để dedupe: một đại lý có thể có nhiều nhóm. */
export interface DealerRoom {
  readonly channel: string;
  readonly groupId: string;
  readonly customerId: string;
}

/**
 * Danh sách nhóm đại lý đang nhận được tin của hệ thống.
 *
 * TÁCH khỏi `CustomerRoomLookup` (auth/) dù cùng đọc `group_map`: chiều kia tra MỘT khách để hỏi
 * riêng họ, chiều này quét TOÀN BỘ để phát chung. Hai tập điều kiện khác nhau (chiều này còn phải
 * loại nhóm đã `/block`) và hai nhóm người gọi khác nhau.
 */
export interface DealerRoomLookup {
  /** Nhóm `enabled` và KHÔNG bị `/block`, mỗi đại lý đúng một nhóm (nhóm cập nhật gần nhất). */
  allEnabled(): Promise<readonly DealerRoom[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Nháp — sống giữa lượt soạn và lượt chốt
// ─────────────────────────────────────────────────────────────────────────────

/** Bản nháp đang chờ người xác nhận. Ở Redis, hết hạn thì phải soạn lại. */
export interface AnnouncementDraft {
  readonly id: string;
  /** Text sẽ gửi NGUYÊN VĂN tới mọi nhóm — sinh một lần, không sinh lại lúc gửi. */
  readonly text: string;
  /** senderId người soạn. Chỉ CHÍNH họ được chốt (chống người khác chốt hộ). */
  readonly authorSenderId: string;
}

/**
 * Kho bản nháp. TTL ngắn: nháp để đọc lại rồi chốt ngay, không phải để dành sang hôm sau — tin
 * tồn kho cũ đi rất nhanh.
 */
export interface DraftStore {
  put(draft: AnnouncementDraft, ttlSec: number): Promise<void>;
  /**
   * Lấy VÀ XOÁ trong một lệnh (GETDEL). Atomic vì hai lượt chốt chạy song song mà cả hai đọc được
   * thì sinh hai đợt phát. undefined = không có / đã hết hạn / đã chốt rồi.
   */
  take(id: string): Promise<AnnouncementDraft | undefined>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Đợt phát + từng lượt giao
// ─────────────────────────────────────────────────────────────────────────────

/** Một lượt giao tin tới một nhóm — đúng phần code đọc, cột audit không có ở đây. */
export interface Delivery {
  readonly id: string;
  readonly announcementId: string;
  readonly channel: string;
  readonly groupId: string;
  readonly customerId: string;
  /** Text của đợt phát (store join sẵn) — poller không phải tra bảng gốc từng row. */
  readonly text: string;
  readonly attempts: number;
  /** Mốc thử kế — cũng là ô CAS claim. undefined = thôi thử (đã Sent/Failed). */
  readonly nextAttemptAt?: Date;
}

/** Số liệu một đợt phát, cho người phát soát lại. */
export interface AnnouncementStatus {
  readonly announcementId: string;
  /** Chưa duyệt thì `sent`/`pending` đều vô nghĩa — người đọc phải thấy trạng thái này trước. */
  readonly state: AnnouncementStatusCode;
  readonly total: number;
  readonly sent: number;
  readonly pending: number;
  /** Nhóm đã chịu thua (hết lượt thử) kèm lý do — người phát tự quyết làm gì tiếp. */
  readonly failed: readonly FailedDelivery[];
  /** Lý do bị từ chối, nếu có. */
  readonly rejectReason?: string;
}

/** Một đợt đang chờ duyệt — người duyệt cần thấy đủ để quyết mà không phải hỏi lại. */
export interface AwaitingApproval {
  readonly announcementId: string;
  readonly kind: string;
  readonly text: string;
  /** senderId thủ kho đã chốt. */
  readonly createdBy: string;
  readonly roomCount: number;
  readonly createdAt: Date;
}

/** Phòng để nhắn cho một người theo `user_id` hệ vận hành (chiều ngược `user_binding`). */
export interface ApproverRoom {
  readonly channel: string;
  readonly conversationId: string;
}

/**
 * Tra phòng của người duyệt để gửi yêu cầu duyệt. undefined = người đó chưa `/ketnoi-hethong`
 * trên kênh nào → KHÔNG có đường hỏi → service từ chối chốt (không đẻ đợt phát không ai duyệt được).
 */
export interface ApproverRoomLookup {
  roomOf(userId: string): Promise<ApproverRoom | undefined>;
}

export interface FailedDelivery {
  readonly groupId: string;
  readonly customerId: string;
  readonly reason: string;
}

/**
 * Tham số mở một đợt phát. KHÔNG có mốc gửi: row nhận sinh ra với `next_attempt_at = NULL` và
 * chỉ được `approve` mở khoá. Không truyền mốc vào đây là để không ai lỡ tay bỏ qua cửa duyệt.
 */
export interface CreateAnnouncementInput {
  readonly kind: AnnouncementKind;
  readonly text: string;
  readonly createdBy: string;
  /** Phòng thủ kho đã chốt — đích báo ngược kết quả duyệt. */
  readonly origin: ApproverRoom;
  readonly rooms: readonly DealerRoom[];
}

/** Tham số CAS claim một lượt gửi: chỉ đổi khi `expected` còn đúng giá trị vừa đọc. */
export interface ClaimDeliveryInput {
  readonly id: string;
  readonly expected: Date;
  /** Mốc thử kế nếu lần này hỏng. */
  readonly next: Date;
}

/** Đánh dấu một lượt giao đã chịu thua. `reason` đi vào `last_error` cho người phát đọc. */
export interface FailDeliveryInput {
  readonly id: string;
  readonly reason: string;
  /** true = hết lượt thử → Failed (thôi gửi). false = còn thử → giữ Pending. */
  readonly giveUp: boolean;
}

/**
 * Cổng đọc/ghi đợt phát (bảng `announcements` + `announcement_deliveries`).
 *
 * FIRE-ONCE nằm ở store: `create` dựa unique index (announcement, channel, group), `claim` dựa
 * CAS trên `next_attempt_at` — hai instance cùng tick không gửi cho một nhóm hai lần.
 */
export interface AnnouncementStore {
  /** Ghi bản gốc (AwaitingApproval) + N row nhận CHƯA tới hạn, một câu lệnh. Trả id đợt phát. */
  create(input: CreateAnnouncementInput): Promise<string>;
  /** Bản gốc để người duyệt đọc. undefined = id sai. */
  find(announcementId: string): Promise<AwaitingApproval | undefined>;
  /**
   * Gật: AwaitingApproval → Approved VÀ mở khoá row nhận (đặt `next_attempt_at`).
   * `undefined` = đợt không còn ở trạng thái chờ duyệt (đã duyệt/từ chối/id sai) → caller KHÔNG
   * được báo "đã duyệt" lần hai. Trả số nhóm thật sự được mở khoá.
   */
  approve(input: ApproveInput): Promise<number | undefined>;
  /** Lắc: AwaitingApproval → Rejected. false = không còn ở trạng thái chờ duyệt. */
  reject(input: RejectInput): Promise<boolean>;
  /** Đợt đang chờ duyệt, cũ nhất trước. */
  listAwaiting(limit: number): Promise<readonly AwaitingApproval[]>;
  /** Lượt tới hạn gửi, có trần mỗi tick để một tick dồn không chiếm egress quá lâu. */
  dueForSend(now: Date): Promise<readonly Delivery[]>;
  /** false = instance khác đã giành lượt này → tick này im lặng rút. */
  claim(input: ClaimDeliveryInput): Promise<boolean>;
  markSent(id: string, sentAt: Date): Promise<void>;
  markFailed(input: FailDeliveryInput): Promise<void>;
  status(announcementId: string): Promise<AnnouncementStatus | undefined>;
  /** Đợt phát gần nhất của một người — để họ gõ "xem thông báo vừa gửi" khỏi phải nhớ id. */
  latestBy(createdBy: string): Promise<string | undefined>;
  /** Phòng thủ kho đã chốt, để báo ngược kết quả duyệt. undefined = id sai. */
  originOf(announcementId: string): Promise<ApproverRoom | undefined>;
}

export interface ApproveInput {
  readonly announcementId: string;
  /** user_id người duyệt (audit). Quyền đã verify ở service, store chỉ ghi vết. */
  readonly approvedBy: string;
  /** Mốc gửi đầu cho mọi row nhận của đợt này. */
  readonly firstAttemptAt: Date;
}

export interface RejectInput {
  readonly announcementId: string;
  readonly rejectedBy: string;
  readonly reason: string;
}

/** Ghi tin vừa phát vào history nhóm — nguồn để agent đại lý trích lại sau này. */
export interface HistoryAppender {
  append(entry: HistoryEntry): Promise<void>;
}

/** Bó port bộ máy phát tin cần. Bootstrap cấp implementation thật. */
export interface AnnouncementDeps {
  readonly store: AnnouncementStore;
  readonly rooms: DealerRoomLookup;
  readonly drafts: DraftStore;
  readonly broadcaster: Broadcaster;
  readonly history: HistoryAppender;
  /** Tra phòng người duyệt để gửi yêu cầu duyệt. */
  readonly approverRooms: ApproverRoomLookup;
  /**
   * `user_id` hệ vận hành của người DUY NHẤT được duyệt phát tin. undefined = chưa cấu hình
   * `ANNOUNCE_APPROVER_USER_ID` → service từ chối mọi lượt chốt. Fail-closed: không có người
   * duyệt thì không ai phát được, chứ KHÔNG phải ai cũng phát được.
   */
  readonly approverUserId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kết cục — GIÁ TRỊ, không phải exception (mọi ngã rẽ là kết cục nghiệp vụ tool phải diễn đạt)
// ─────────────────────────────────────────────────────────────────────────────

/**
 *  - drafted  : đã có nháp, kèm số nhóm sẽ nhận để người soạn cân nhắc trước khi chốt.
 *  - no_room  : chưa nhóm đại lý nào được nối → không có ai để phát, KHÔNG tạo nháp.
 *  - too_long : vượt trần một tin của kênh → cắt là mất thông tin ở mọi nhóm, bắt soạn lại.
 */
export type DraftOutcome =
  | { readonly kind: "drafted"; readonly draft: AnnouncementDraft; readonly roomCount: number }
  | { readonly kind: "no_room" }
  | { readonly kind: "too_long"; readonly limit: number; readonly length: number };

/**
 *  - awaiting_approval : đã ghi bản gốc + N row KHÓA, và đã gửi yêu cầu duyệt. CHƯA GỬI CHO AI.
 *  - expired           : nháp hết hạn / đã chốt rồi / id sai → không xếp hàng gì, phải soạn lại.
 *  - not_author        : người chốt không phải người soạn → không xếp hàng.
 *  - no_room           : danh sách nhóm rỗng đúng lúc chốt (vừa gỡ hết binding).
 *  - no_approver       : chưa cấu hình người duyệt, hoặc người duyệt chưa `/ketnoi-hethong` nên
 *                        không có đường hỏi → KHÔNG tạo đợt phát nào (fail-closed).
 */
export type QueueOutcome =
  | {
      readonly kind: "awaiting_approval";
      readonly announcementId: string;
      readonly roomCount: number;
    }
  | { readonly kind: "expired" }
  | { readonly kind: "not_author" }
  | { readonly kind: "no_room" }
  | { readonly kind: "no_approver"; readonly detail: string };

/**
 *  - approved  : đã mở khoá `roomCount` nhóm, poller bắt đầu gửi từ tick kế.
 *  - rejected  : đã đánh dấu từ chối, không nhóm nào nhận.
 *  - not_found : id sai, hoặc đợt đã được duyệt/từ chối rồi (không xử lý lần hai).
 *  - forbidden : người gõ không phải người duyệt đích danh.
 */
export type DecisionOutcome =
  | { readonly kind: "approved"; readonly roomCount: number }
  | { readonly kind: "rejected" }
  | { readonly kind: "not_found" }
  | { readonly kind: "forbidden" };

/** Cổng cho tool (agent). Cùng khuôn `WorkflowPort`: tool chỉ thấy một interface. */
export interface AnnouncePort {
  draft(input: { readonly text: string; readonly authorSenderId: string }): Promise<DraftOutcome>;
  queue(input: {
    readonly draftId: string;
    readonly kind: AnnouncementKind;
    readonly senderId: string;
    readonly origin: ApproverRoom;
    readonly nowMs: number;
  }): Promise<QueueOutcome>;
  /** Soát đợt phát. `announcementId` bỏ trống = đợt gần nhất của chính người hỏi. */
  status(input: {
    readonly senderId: string;
    readonly announcementId?: string;
  }): Promise<AnnouncementStatus | undefined>;
}

/**
 * Cổng cho FLASH COMMAND (người duyệt gõ `/duyet-thongbao`). Tách khỏi `AnnouncePort` có chủ đích:
 * quyết định duyệt KHÔNG được nằm trong tầm với của LLM. Agent không cầm interface này.
 */
export interface AnnounceApprovalPort {
  /** Verify `approverUserId` bên trong — caller không tự gate được (và không được phép). */
  approve(input: { readonly announcementId: string; readonly userId: string; readonly nowMs: number }): Promise<DecisionOutcome>;
  reject(input: {
    readonly announcementId: string;
    readonly userId: string;
    readonly reason: string;
  }): Promise<DecisionOutcome>;
  /** Đợt đang chờ CHÍNH người này duyệt. Không phải người duyệt → mảng rỗng. */
  awaiting(userId: string): Promise<readonly AwaitingApproval[]>;
}

/** Re-export để store/poller khỏi phải import chéo sang db/schema chỉ vì một enum. */
export type { AnnouncementStatusCode, DeliveryStatus };
