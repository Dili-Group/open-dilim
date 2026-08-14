// service.ts — pipeline digest một ngày + cửa duyệt đề xuất KB.
//
// KbDigestService.runDay: group có nhân viên nhắn trong ngày → claim (day, group) → load tin →
// extract → lưu đề xuất → gửi MỘT digest/group về group kiểm duyệt. Lỗi cô lập theo group;
// gửi fail = failed TERMINAL (không tự chạy lại — digest đôi phiền hơn digest thiếu).
//
// KbReviewService: duyệt/từ chối đề xuất. Approve mới chạm embedder + bảng memory (ORG_KB_SCOPE);
// thiếu memory store → fail-closed "no_memory", KHÔNG âm thầm approve mà không ghi.

import { capForChannel } from "../broadcast/limits.ts";
import type { Broadcaster } from "../broadcast/types.ts";
import { KbDigestRunStatus, KbProposalStatus } from "../db/schema.ts";
import { captureError } from "../observability/sentry.ts";
import { MemoryType, ORG_KB_SCOPE, type MemoryStore } from "../state/types.ts";
import { AGENT_SENDER_ID } from "../types/index.ts";
import { KB_SHORT_ID_LENGTH } from "./store.ts";
import { vnDayBounds } from "./time.ts";
import type {
  KbDecision,
  KbDigestExtraction,
  KbDigestStore,
  KbLoggedMessage,
  KbPendingProposal,
  KbReviewConfig,
  KbReviewPort,
} from "./types.ts";
import { KB_SCAN_CHANNEL } from "./types.ts";

/** Fact duyệt tay = tin cậy tối đa (người thật đã đọc), khác fact distill tự động (0.5). */
const APPROVED_CONFIDENCE = 1;

export interface KbExtractorPort {
  extract(
    messages: readonly KbLoggedMessage[],
    signal?: AbortSignal,
  ): Promise<KbDigestExtraction | undefined>;
}

export interface KbDigestDeps {
  readonly store: KbDigestStore;
  readonly extractor: KbExtractorPort;
  readonly broadcaster: Broadcaster;
}

export class KbDigestService {
  constructor(private readonly deps: KbDigestDeps) {}

  /**
   * Chạy digest cho một ngày VN ('YYYY-MM-DD'). Idempotent theo (day, group) nhờ claim —
   * gọi lại bao nhiêu lần cũng chỉ group CHƯA claim được xử lý. Tuần tự từng group: mỗi group
   * một call LLM, chạy đêm không ai chờ, song song chỉ tổ giành rate limit với lượt chat thật.
   */
  async runDay(day: string, signal?: AbortSignal): Promise<void> {
    const config = await this.deps.store.getConfig();
    if (config === undefined || !config.enabled) return;

    const { startMs, endMs } = vnDayBounds(day);
    const groups = await this.deps.store.staffActiveGroups({
      channel: KB_SCAN_CHANNEL,
      startMs,
      endMs,
      excludeConversationId: config.conversationId,
    });

    for (const conversationId of groups) {
      const claimed = await this.deps.store.claimRun(day, conversationId);
      if (!claimed) continue;
      try {
        await this.digestGroup(config, day, conversationId, startMs, endMs, signal);
        await this.deps.store.finishRun(day, conversationId, KbDigestRunStatus.Done);
      } catch (err) {
        // Cô lập theo group: một group hỏng (LLM, bridge Zalo) không giết các group còn lại.
        console.error(`[kb-digest] group ${conversationId} ngày ${day} lỗi:`, err);
        captureError(err, "kb-digest.group", { conversationId, day });
        await this.finishFailedQuietly(day, conversationId);
      }
    }
  }

  private async digestGroup(
    config: KbReviewConfig,
    day: string,
    conversationId: string,
    startMs: number,
    endMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const messages = await this.deps.store.messagesForDay({
      channel: KB_SCAN_CHANNEL,
      conversationId,
      startMs,
      endMs,
    });

    const extraction = await this.deps.extractor.extract(messages, signal);
    // undefined = model hỏng/JSON vỡ — khác extraction rỗng (ngày yên ổn). Throw để lượt này
    // thành failed có vết, thay vì "done" giả trên dữ liệu chưa hề được đọc.
    if (extraction === undefined) {
      throw new Error("extractor không trả được kết quả (model hỏng hoặc JSON vỡ)");
    }

    const hasContent =
      extraction.vanDe.length > 0 || extraction.giaiPhap.length > 0 || extraction.kb.length > 0;
    if (!hasContent) return; // yên ổn: không gửi digest rác, lượt vẫn Done.

    const proposalIds = await this.deps.store.insertProposals({
      day,
      channel: KB_SCAN_CHANNEL,
      conversationId,
      facts: extraction.kb,
    });

    await this.deps.broadcaster.send(
      {
        channel: config.channel,
        conversationId: config.conversationId,
        isGroup: true,
        // Digest không trả lời riêng ai — cùng nghĩa với announcements poller.
        replyToSenderId: AGENT_SENDER_ID,
      },
      capForChannel(config.channel, renderDigest(day, conversationId, extraction, proposalIds)),
    );
  }

  /** Đánh dấu failed best-effort: Postgres cũng đang hỏng thì đành để row Running mồ côi. */
  private async finishFailedQuietly(day: string, conversationId: string): Promise<void> {
    try {
      await this.deps.store.finishRun(day, conversationId, KbDigestRunStatus.Failed);
    } catch (err) {
      console.error(`[kb-digest] đánh dấu failed ${conversationId} ngày ${day} lỗi:`, err);
    }
  }
}

/** MỘT tin digest cho MỘT group. Đề xuất KB kèm mã ngắn để duyệt ngay trong group kiểm duyệt. */
export function renderDigest(
  day: string,
  conversationId: string,
  extraction: KbDigestExtraction,
  proposalIds: readonly string[],
): string {
  const lines: string[] = [`📋 Tổng kết ${day} — nhóm ${conversationId}`];

  if (extraction.vanDe.length > 0) {
    lines.push("", "Vấn đề trong ngày:");
    extraction.vanDe.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
  }
  if (extraction.giaiPhap.length > 0) {
    lines.push("", "Xử lý / trạng thái:");
    extraction.giaiPhap.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
  }
  if (extraction.kb.length > 0) {
    lines.push("", "Đề xuất ghi knowledge base:");
    extraction.kb.forEach((fact, i) => {
      const shortId = (proposalIds[i] ?? "").slice(0, KB_SHORT_ID_LENGTH);
      lines.push(`[${shortId}] ${fact}`);
    });
    lines.push("", "Duyệt: /duyet-kb <mã> · Từ chối: /tuchoi-kb <mã> · Đang chờ: /kb-pending");
  }
  return lines.join("\n");
}

export interface KbReviewDeps {
  readonly store: KbDigestStore;
  /** undefined = thiếu embedder (GEMINI_API_KEY) → duyệt fail-closed, digest vẫn chạy được. */
  readonly memory?: MemoryStore;
}

export class KbReviewService implements KbReviewPort {
  constructor(private readonly deps: KbReviewDeps) {}

  getConfig(): Promise<KbReviewConfig | undefined> {
    return this.deps.store.getConfig();
  }

  bindReviewGroup(p: {
    channel: string;
    conversationId: string;
    runTime: string;
    createdBy: string;
  }): Promise<void> {
    return this.deps.store.upsertConfig(p);
  }

  listPending(): Promise<KbPendingProposal[]> {
    return this.deps.store.listPending();
  }

  async approve(p: { shortId: string; decidedBy: string }): Promise<KbDecision> {
    if (this.deps.memory === undefined) return { kind: "no_memory" };
    const found = await this.deps.store.findPendingByShortId(p.shortId);
    if (found.kind !== "found") return found;

    // GHI KB TRƯỚC, đánh dấu SAU: hỏng giữa chừng thì đề xuất vẫn pending, duyệt lại chỉ chạm
    // dedup (sourceMsgId = id đề xuất) — chiều ngược lại là "approved" mà KB không có gì.
    const written = await this.deps.memory.write(
      ORG_KB_SCOPE,
      [{ type: MemoryType.Context, text: found.factText, confidence: APPROVED_CONFIDENCE }],
      `kb-proposal:${found.id}`,
    );
    await this.deps.store.decide(found.id, KbProposalStatus.Approved, p.decidedBy);
    return { kind: "approved", written: written > 0 };
  }

  async reject(p: { shortId: string; decidedBy: string }): Promise<KbDecision> {
    const found = await this.deps.store.findPendingByShortId(p.shortId);
    if (found.kind !== "found") return found;
    await this.deps.store.decide(found.id, KbProposalStatus.Rejected, p.decidedBy);
    return { kind: "rejected" };
  }
}
