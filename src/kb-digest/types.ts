// types.ts — hợp đồng tầng kb-digest: tổng kết cuối ngày theo group + đề xuất knowledge base
// có kiểm duyệt. Port only, không import config/db — impl inject lúc wiring (cùng convention
// announcements/types.ts).

import type { KbDigestRunStatus, KbProposalStatus } from "../db/schema.ts";

/**
 * Kênh được quét digest: chỉ nhóm ĐẠI LÝ. Kênh nội bộ (van-hanh, kho, sếp) toàn nhân viên —
 * "có nhân viên nhắn" đúng với mọi tin, digest chỉ ra nhiễu.
 */
export const KB_SCAN_CHANNEL = "zalo";

/** Binding group kiểm duyệt + giờ chạy (row 'main' của kb_review_config). */
export interface KbReviewConfig {
  readonly channel: string;
  readonly conversationId: string;
  /** 'HH:MM' giờ VN. */
  readonly runTime: string;
  readonly enabled: boolean;
}

/** Một tin trong message_log đưa vào transcript digest. */
export interface KbLoggedMessage {
  readonly senderId: string;
  readonly senderName?: string;
  readonly text: string;
  readonly ts: number;
}

/** Kết quả rút từ một group một ngày. Mảng rỗng cả ba = ngày yên ổn, không gửi digest. */
export interface KbDigestExtraction {
  readonly vanDe: readonly string[];
  readonly giaiPhap: readonly string[];
  readonly kb: readonly string[];
}

/** Đề xuất KB đang chờ duyệt (liệt kê cho /kb-pending). */
export interface KbPendingProposal {
  readonly id: string;
  readonly day: string;
  readonly factText: string;
  readonly createdAt: Date;
}

/** Cổng Postgres của tầng này. Impl: store.ts (SqlExecutor inject). */
export interface KbDigestStore {
  getConfig(): Promise<KbReviewConfig | undefined>;
  upsertConfig(p: {
    channel: string;
    conversationId: string;
    runTime: string;
    createdBy: string;
  }): Promise<void>;
  /** Group (channel quét) có ÍT NHẤT một tin của nhân viên active trong [startMs, endMs). */
  staffActiveGroups(p: {
    channel: string;
    startMs: number;
    endMs: number;
    excludeConversationId: string;
  }): Promise<string[]>;
  /** Toàn bộ tin một group trong [startMs, endMs), theo thứ tự thời gian. */
  messagesForDay(p: {
    channel: string;
    conversationId: string;
    startMs: number;
    endMs: number;
  }): Promise<KbLoggedMessage[]>;
  /** true = giành được lượt (day, group) — INSERT ON CONFLICT DO NOTHING. */
  claimRun(day: string, conversationId: string): Promise<boolean>;
  finishRun(day: string, conversationId: string, status: KbDigestRunStatus): Promise<void>;
  /** Ghi đề xuất, trả id (uuid) theo đúng thứ tự fact đưa vào. */
  insertProposals(p: {
    day: string;
    channel: string;
    conversationId: string;
    facts: readonly string[];
  }): Promise<string[]>;
  listPending(): Promise<KbPendingProposal[]>;
  /**
   * Tra pending theo mã ngắn (8 ký tự đầu uuid). "ambiguous" = >1 pending trùng prefix —
   * xác suất không đáng kể nhưng ghi nhầm vào KB thì đắt, nên bắt người duyệt dùng mã dài hơn.
   */
  findPendingByShortId(
    shortId: string,
  ): Promise<{ kind: "found"; id: string; factText: string } | { kind: "not_found" } | { kind: "ambiguous" }>;
  /** Đánh dấu quyết định. false = row không còn pending (đã quyết ở lượt khác). */
  decide(id: string, status: KbProposalStatus, decidedBy: string): Promise<boolean>;
}

/** Kết quả duyệt/từ chối một đề xuất — flash command narrow union này để trả lời đúng câu. */
export type KbDecision =
  | { kind: "approved"; written: boolean } // written=false: fact gần trùng KB đã có, dedup bỏ
  | { kind: "rejected" }
  | { kind: "not_found" }
  | { kind: "ambiguous" }
  | { kind: "no_memory" }; // thiếu embedder → không ghi được KB, fail-closed

/**
 * Cửa cho flash command (/kiemduyet-kb, /duyet-kb, /tuchoi-kb, /kb-pending). CHỈ flash-command cầm —
 * quyết định ghi KB không nằm trong tầm với của LLM (cùng nguyên tắc AnnounceApprovalPort).
 */
export interface KbReviewPort {
  getConfig(): Promise<KbReviewConfig | undefined>;
  bindReviewGroup(p: {
    channel: string;
    conversationId: string;
    runTime: string;
    createdBy: string;
  }): Promise<void>;
  listPending(): Promise<KbPendingProposal[]>;
  approve(p: { shortId: string; decidedBy: string }): Promise<KbDecision>;
  reject(p: { shortId: string; decidedBy: string }): Promise<KbDecision>;
}
