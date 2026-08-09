// service.ts — cổng nghiệp vụ của tầng phát tin. Hai interface, tách có chủ đích:
//
//   AnnouncePort         → tool của agent dùng (soạn nháp, chốt, soát).
//   AnnounceApprovalPort → flash command của NGƯỜI DUYỆT dùng (duyệt, từ chối, xem hàng chờ).
//
// Tách vì quyết định duyệt KHÔNG được nằm trong tầm với của LLM (nguyên tắc 6/10/11: quyền theo
// identity backend resolve, không theo thứ model sinh ra). Agent không cầm `AnnounceApprovalPort`;
// đường duy nhất tới nó là flash command — text bắt đầu bằng `/`, parse bằng code, không qua LLM.
//
// Service KHÔNG gửi tin. Duyệt xong chỉ mở khoá row nhận rồi trả về ngay — poller mới thật sự
// gửi. Nhờ vậy lượt agent không giữ worker slot suốt N lần gọi bridge, và worker chết giữa chừng
// cũng không mất nhóm nào.

import { limitForChannel } from "../broadcast/limits.ts";
import type {
  AnnouncePort,
  AnnounceApprovalPort,
  AnnouncementDeps,
  AnnouncementKind,
  AnnouncementStatus,
  ApproverRoom,
  AwaitingApproval,
  DealerRoom,
  DecisionOutcome,
  DraftOutcome,
  QueueOutcome,
} from "./types.ts";

/** Nháp sống bao lâu. Đủ để đọc lại và chốt; không đủ để quên rồi chốt nhầm tin của hôm trước. */
export const DRAFT_TTL_SEC = 10 * 60;

/** Độ dài id nháp. Model phải chép lại được, nên ngắn — va chạm trong 10 phút là không đáng lo. */
const DRAFT_ID_LENGTH = 8;

/** Trần đợt liệt kê cho người duyệt. Chờ nhiều hơn ngần này là quy trình đang tắc, không phải UI. */
const AWAITING_LIMIT = 10;

export class AnnouncementService implements AnnouncePort, AnnounceApprovalPort {
  constructor(private readonly deps: AnnouncementDeps) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Phía thủ kho (agent gọi)
  // ───────────────────────────────────────────────────────────────────────────

  async draft(input: { text: string; authorSenderId: string }): Promise<DraftOutcome> {
    const rooms = await this.deps.rooms.allEnabled();
    if (rooms.length === 0) return { kind: "no_room" };

    // Trần theo kênh CHẶT NHẤT trong danh sách: một text cho mọi nhóm, nên chỉ cần một kênh từ
    // chối là cả đợt phát lệch nhau (nhóm bị cắt đọc thiếu). Từ chối trước còn hơn cắt sau.
    const limit = strictestLimit(rooms);
    if (input.text.length > limit) {
      return { kind: "too_long", limit, length: input.text.length };
    }

    const draft = {
      id: crypto.randomUUID().replaceAll("-", "").slice(0, DRAFT_ID_LENGTH),
      text: input.text,
      authorSenderId: input.authorSenderId,
    };
    await this.deps.drafts.put(draft, DRAFT_TTL_SEC);
    return { kind: "drafted", draft, roomCount: rooms.length };
  }

  async queue(input: {
    draftId: string;
    kind: AnnouncementKind;
    senderId: string;
    origin: ApproverRoom;
    nowMs: number;
  }): Promise<QueueOutcome> {
    // Tra người duyệt TRƯỚC KHI nuốt nháp: không có người duyệt thì không tạo gì cả, và thủ kho
    // vẫn còn nháp để chốt lại sau khi kỹ thuật sửa cấu hình.
    const approver = await this.resolveApprover();
    if (approver.kind === "missing") return { kind: "no_approver", detail: approver.detail };

    // `take` xoá luôn (GETDEL) → một nháp chỉ chốt được một lần, kể cả khi hai lượt gọi song song.
    const draft = await this.deps.drafts.take(input.draftId);
    if (draft === undefined) return { kind: "expired" };

    if (draft.authorSenderId !== input.senderId) {
      // Nháp đã bị GETDEL nuốt mất rồi. Ghi lại để người soạn thật soạn lần nữa — và để thấy được
      // ca người khác cố chốt hộ, vì đó là dấu hiệu tin nhắn trong nhóm đang lái agent.
      console.warn(
        `[announcements] nháp ${input.draftId} do ${draft.authorSenderId} soạn nhưng ${input.senderId} chốt — từ chối.`,
      );
      return { kind: "not_author" };
    }

    // Tra lại danh sách nhóm ở BƯỚC CHỐT, không dùng lại danh sách lúc soạn: giữa hai lượt có thể
    // vừa `/block` một nhóm, và số nhóm báo cho người chốt phải là số thật sự được ghi.
    const rooms = await this.deps.rooms.allEnabled();
    if (rooms.length === 0) return { kind: "no_room" };

    const announcementId = await this.deps.store.create({
      kind: input.kind,
      text: draft.text,
      createdBy: input.senderId,
      origin: input.origin,
      rooms,
    });

    // Yêu cầu duyệt hỏng thì đợt phát vẫn nằm chờ duyệt trong DB — KHÔNG mất, người duyệt gõ
    // `/thongbao-cho` là thấy. Nên chỉ log, không ném: ném ra thì thủ kho tưởng chưa chốt được
    // và chốt lại, đẻ đợt thứ hai cùng nội dung.
    try {
      await this.notifyApprover(approver.room, announcementId, draft.text, rooms.length);
    } catch (err) {
      console.error(`[announcements] gửi yêu cầu duyệt ${announcementId} lỗi:`, err);
    }

    return { kind: "awaiting_approval", announcementId, roomCount: rooms.length };
  }

  async status(input: {
    senderId: string;
    announcementId?: string;
  }): Promise<AnnouncementStatus | undefined> {
    const id = input.announcementId ?? (await this.deps.store.latestBy(input.senderId));
    if (id === undefined) return undefined;
    return this.deps.store.status(id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Phía người duyệt (flash command gọi — KHÔNG qua LLM)
  // ───────────────────────────────────────────────────────────────────────────

  async approve(input: {
    announcementId: string;
    userId: string;
    nowMs: number;
  }): Promise<DecisionOutcome> {
    if (!this.isApprover(input.userId)) return { kind: "forbidden" };

    const roomCount = await this.deps.store.approve({
      announcementId: input.announcementId,
      approvedBy: input.userId,
      firstAttemptAt: new Date(input.nowMs),
    });
    if (roomCount === undefined) return { kind: "not_found" };

    await this.notifyOrigin(
      input.announcementId,
      `Thông báo đã được duyệt. Hệ thống đang gửi tới ${roomCount} nhóm đại lý.`,
    );
    return { kind: "approved", roomCount };
  }

  async reject(input: {
    announcementId: string;
    userId: string;
    reason: string;
  }): Promise<DecisionOutcome> {
    if (!this.isApprover(input.userId)) return { kind: "forbidden" };

    const done = await this.deps.store.reject({
      announcementId: input.announcementId,
      rejectedBy: input.userId,
      reason: input.reason,
    });
    if (!done) return { kind: "not_found" };

    await this.notifyOrigin(
      input.announcementId,
      `Thông báo KHÔNG được duyệt: ${input.reason}. Không nhóm đại lý nào nhận được tin này.`,
    );
    return { kind: "rejected" };
  }

  async awaiting(userId: string): Promise<readonly AwaitingApproval[]> {
    if (!this.isApprover(userId)) return [];
    return this.deps.store.listAwaiting(AWAITING_LIMIT);
  }

  // ───────────────────────────────────────────────────────────────────────────

  /** Người duyệt đích danh. Chưa cấu hình → KHÔNG ai là người duyệt (fail-closed). */
  private isApprover(userId: string): boolean {
    return this.deps.approverUserId !== undefined && this.deps.approverUserId === userId;
  }

  private async resolveApprover(): Promise<
    { kind: "room"; room: ApproverRoom } | { kind: "missing"; detail: string }
  > {
    const userId = this.deps.approverUserId;
    if (userId === undefined) {
      return { kind: "missing", detail: "hệ thống chưa cấu hình người duyệt phát tin" };
    }
    const room = await this.deps.approverRooms.roomOf(userId);
    if (room === undefined) {
      // Có người duyệt nhưng không nhắn được cho họ = đợt phát sẽ nằm chờ mà không ai hay. Từ
      // chối ngay còn hơn đẻ ra một đợt treo im lặng.
      return { kind: "missing", detail: "người duyệt chưa nối tài khoản nên hệ thống không nhắn được" };
    }
    return { kind: "room", room };
  }

  private async notifyApprover(
    room: ApproverRoom,
    announcementId: string,
    text: string,
    roomCount: number,
  ): Promise<void> {
    await this.deps.broadcaster.send(
      { channel: room.channel, conversationId: room.conversationId, isGroup: false, replyToSenderId: room.conversationId },
      [
        `[DUYỆT PHÁT TIN] Kho xin gửi thông báo tới ${roomCount} nhóm đại lý.`,
        "",
        "Nội dung:",
        "---",
        text,
        "---",
        "",
        `Duyệt:   /duyet-thongbao ${announcementId}`,
        `Từ chối: /tuchoi-thongbao ${announcementId} <lý do>`,
        "Chưa gửi cho nhóm nào cho tới khi bạn duyệt.",
      ].join("\n"),
    );
  }

  /**
   * Báo kết quả duyệt về phòng thủ kho đã chốt. Hỏng thì chỉ log: quyết định đã ghi vào DB rồi,
   * và với chiều duyệt thì tin đã bắt đầu đi — ném ở đây sẽ khiến người duyệt gõ lại lệnh.
   */
  private async notifyOrigin(announcementId: string, text: string): Promise<void> {
    try {
      const origin = await this.deps.store.originOf(announcementId);
      if (origin === undefined) return;
      await this.deps.broadcaster.send(
        {
          channel: origin.channel,
          conversationId: origin.conversationId,
          // Phòng kho là nhóm; kể cả là DM thì Zalo bridge cũng chỉ dùng conversationId.
          isGroup: true,
          replyToSenderId: origin.conversationId,
        },
        text,
      );
    } catch (err) {
      console.error(`[announcements] báo kết quả duyệt ${announcementId} về phòng kho lỗi:`, err);
    }
  }
}

/** Trần nhỏ nhất trong các kênh có nhóm nhận. Danh sách rỗng đã bị chặn trước khi gọi. */
function strictestLimit(rooms: readonly DealerRoom[]): number {
  let limit = Number.POSITIVE_INFINITY;
  for (const room of rooms) limit = Math.min(limit, limitForChannel(room.channel));
  return limit;
}
