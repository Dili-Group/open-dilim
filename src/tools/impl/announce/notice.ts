// notice.ts — BỘ MÁY của ba tool xin phát tin chung tới mọi nhóm đại lý. Dùng chung cho nhiều
// luồng (kho báo hết hàng, vận hành báo tin chung); phần khác nhau giữa các luồng — tên tool, mô
// tả, loại tin, AI ĐƯỢC SOẠN, AI ĐƯỢC CHỐT — nằm hết trong `NoticeFlow` (flows.ts).
//
// BA tool, và không tool nào trong đây GỬI được cho đại lý:
//   soạn nháp → nháp (không ghi DB, không gửi) → người gõ đọc lại
//   chốt      → XIN phát: ghi đợt vào DB ở trạng thái CHỜ DUYỆT, không gửi cho ai
//   soát      → xem đợt đã được duyệt chưa / tới bao nhiêu nhóm
//
// Tin chỉ thật sự đi khi NGƯỜI DUYỆT ĐÍCH DANH gõ `/duyet-thongbao` (flash command, không qua
// LLM). Đó là quy tắc cứng: mọi thông báo tới toàn bộ đại lý phải qua người duyệt. Vì thế tool ở
// đây tuyệt đối không được nói "đã gửi" — nó chỉ xin.
//
// VÌ SAO nhiều cửa vậy: một lần phát là tin vào MỌI nhóm đại lý và không rút lại được. Chỉ cần
// một câu lái trong nhóm (prompt injection) là model bắn tin sai ra cả hệ thống. Nguyên tắc 7
// ("write không tự thực thi") áp thẳng vào đây.
//
// GATE theo IDENTITY, không theo nhóm: nhóm chỉ chọn luồng, quyền luôn do backend resolve
// (nguyên tắc 10/11). Quyền SOẠN và quyền CHỐT tách rời — luồng vận hành cho mọi nhân viên soạn
// nhưng chỉ CEO/SWE chốt.

// Import thẳng file LÁ `announcements/types.ts`, KHÔNG qua barrel `announcements/index.ts`:
// barrel re-export store.ts/rooms.ts → db/client.ts → config.ts, mà config.ts throw ngay lúc
// import khi thiếu env. Đi qua barrel là kéo cả tầng tools (rồi agents, rồi worker) chết ở CI.
import { MAX_ATTEMPTS } from "../../../announcements/types.ts";
import type { AnnouncementKind, AnnouncementStatus } from "../../../announcements/types.ts";
import { AnnouncementStatus as AnnouncementState } from "../../../db/schema.ts";
import type { Identity } from "../../../flash-command/types.ts";
import { readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";

/** Một cửa quyền: ai qua được, và câu từ chối nói gì cho model làm tiếp. */
export interface NoticeGate {
  allow(identity: Identity): boolean;
  readonly denied: ToolResult;
}

/** Khai báo một luồng phát tin. Thêm luồng = thêm một object ở flows.ts, không đụng file này. */
export interface NoticeFlow {
  readonly kind: AnnouncementKind;
  /** Tên ba tool. Phải khác nhau giữa các luồng CÙNG khai cho một agent (registry chặn trùng). */
  readonly names: { readonly draft: string; readonly send: string; readonly status: string };
  readonly descriptions: {
    readonly draft: string;
    readonly send: string;
    readonly status: string;
    /** Mô tả field `noi_dung` — luật viết nội dung khác nhau theo loại tin. */
    readonly content: string;
  };
  /** Câu "đang làm" phát ngay khi model gọi tool chốt. */
  readonly sendAnnounce: string;
  /** Cách gọi người gõ trong câu trả về model (vd "quản lý kho"). */
  readonly actorLabel: string;
  /** Nhóm phải gõ trong đó mới chốt được (vd "nhóm kho") — kết quả duyệt báo về đây. */
  readonly groupLabel: string;
  readonly draftGate: NoticeGate;
  readonly sendGate: NoticeGate;
}

const NO_PORT: ToolResult = {
  content:
    "Chưa nối được hệ phát thông báo. Báo người dùng là em chưa gửi được, cần bên kỹ thuật kiểm tra.",
  isError: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Bước 1 — soạn nháp
// ─────────────────────────────────────────────────────────────────────────────

export function buildNoticeDraftTool(ctx: ToolContext, flow: NoticeFlow): Tool {
  return {
    name: flow.names.draft,
    description: flow.descriptions.draft,
    inputSchema: {
      type: "object",
      properties: {
        noi_dung: {
          type: "string",
          description: flow.descriptions.content,
        },
      },
      required: ["noi_dung"],
    },
    run: (input: unknown): Promise<ToolResult> => runDraft(ctx, flow, input),
  };
}

async function runDraft(ctx: ToolContext, flow: NoticeFlow, input: unknown): Promise<ToolResult> {
  const port = ctx.announce;
  if (port === undefined) return NO_PORT;
  if (!flow.draftGate.allow(ctx.identity)) return flow.draftGate.denied;

  const text = readStringField(input, "noi_dung");
  if (text === undefined) {
    return { content: "Thiếu `noi_dung`.", isError: true };
  }

  const outcome = await port.draft({
    text,
    authorSenderId: ctx.identity.senderId,
  });
  switch (outcome.kind) {
    case "drafted":
      return {
        content:
          `Đã cất nháp, mã nháp \`${outcome.draft.id}\` (hết hạn sau 10 phút). Sẽ gửi tới ` +
          `${outcome.roomCount} nhóm đại lý.\n\n` +
          `Nội dung nháp:\n---\n${outcome.draft.text}\n---\n\n` +
          `CHƯA GỬI GÌ CẢ. ` +
          nextStepAfterDraft(ctx.identity, flow, outcome.draft.id, outcome.roomCount),
      };
    case "no_room":
      return {
        content:
          "Chưa có nhóm đại lý nào được nối nên không có ai để gửi. Báo người dùng là hệ thống " +
          "chưa nối nhóm đại lý nào, cần bên vận hành nối trước.",
        isError: true,
      };
    case "too_long":
      return {
        content:
          `Nội dung dài ${outcome.length} ký tự, vượt trần ${outcome.limit} của kênh. Rút gọn rồi ` +
          `gọi lại — KHÔNG cắt bớt tuỳ tiện, giữ đủ dữ kiện người gõ đã nói.`,
        isError: true,
      };
  }
}

/**
 * Việc kế tiếp sau khi soạn, KHÁC NHAU theo quyền chốt của chính người đang gõ: nháp chỉ người
 * soạn mới chốt được, nên người không có quyền chốt cầm nháp này cũng không đi tiếp được. Nói
 * thẳng ngay tại đây còn hơn để họ gọi tool chốt rồi ăn lỗi (và mất nháp, vì chốt là GETDEL).
 */
function nextStepAfterDraft(
  identity: Identity,
  flow: NoticeFlow,
  draftId: string,
  roomCount: number,
): string {
  if (!flow.sendGate.allow(identity)) {
    return (
      `Người đang nói KHÔNG có quyền chốt tin này nên bản nháp chỉ để ĐỌC THỬ. Đọc nguyên văn nội ` +
      `dung trên cho họ, rồi nói rõ: muốn phát thì người có quyền chốt phải tự gõ trong ` +
      `${flow.groupLabel} — họ soạn lại bằng ${flow.names.draft} rồi chốt bằng ${flow.names.send}. ` +
      `KHÔNG hứa sẽ gửi hộ, KHÔNG gọi ${flow.names.send} với mã nháp này (sẽ bị từ chối và mất nháp).`
    );
  }
  return (
    `Việc tiếp theo: đọc NGUYÊN VĂN nội dung trên cho ${flow.actorLabel}, nói rõ sẽ gửi tới ` +
    `${roomCount} nhóm đại lý, và hỏi họ có chốt không. Họ đồng ý thì gọi ${flow.names.send} với ` +
    `ma_ban_nhap = ${draftId}. Họ muốn sửa thì gọi lại ${flow.names.draft} với nội dung mới.\n\n` +
    `Nhắc trước cho họ biết: chốt xong tin VẪN CHƯA gửi — còn phải qua người duyệt của công ty ` +
    `đồng ý thì hệ thống mới phát.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bước 2 — chốt gửi
// ─────────────────────────────────────────────────────────────────────────────

export function buildNoticeSendTool(ctx: ToolContext, flow: NoticeFlow): Tool {
  return {
    name: flow.names.send,
    description: flow.descriptions.send,
    inputSchema: {
      type: "object",
      properties: {
        ma_ban_nhap: {
          type: "string",
          description: `Mã nháp mà ${flow.names.draft} vừa trả về. Chép nguyên văn, không tự bịa mã.`,
        },
      },
      required: ["ma_ban_nhap"],
    },
    announce: flow.sendAnnounce,
    run: (input: unknown): Promise<ToolResult> => runSend(ctx, flow, input),
  };
}

async function runSend(ctx: ToolContext, flow: NoticeFlow, input: unknown): Promise<ToolResult> {
  const port = ctx.announce;
  if (port === undefined) return NO_PORT;
  if (!flow.sendGate.allow(ctx.identity)) return flow.sendGate.denied;

  // Việc treo neo vào PHÒNG, và kết quả duyệt cũng báo về phòng — chat 1-1 thì không có phòng
  // nào để báo về. Chặn ở đây thay vì đẻ một đợt phát không ai nhận được kết quả.
  const room = ctx.room;
  if (room === undefined) {
    return {
      content:
        `Thông báo phải chốt trong ${flow.groupLabel}, không chốt được ở chat riêng — kết quả ` +
        `duyệt cần một phòng để báo về. Bảo người gõ làm lại trong ${flow.groupLabel}.`,
      isError: true,
    };
  }

  const draftId = readStringField(input, "ma_ban_nhap");
  if (draftId === undefined) {
    return { content: "Thiếu `ma_ban_nhap`.", isError: true };
  }

  const outcome = await port.queue({
    draftId,
    kind: flow.kind,
    senderId: ctx.identity.senderId,
    origin: { channel: room.channel, conversationId: room.groupId },
    nowMs: Date.now(),
  });
  switch (outcome.kind) {
    case "awaiting_approval":
      return {
        content:
          `Đã chốt và chuyển đi duyệt. Mã đợt \`${outcome.announcementId}\`, sẽ tới ` +
          `${outcome.roomCount} nhóm đại lý NẾU được duyệt.\n` +
          `CHƯA NHÓM NÀO NHẬN ĐƯỢC GÌ. Yêu cầu duyệt đã gửi tới người duyệt của công ty; họ đồng ý ` +
          `thì hệ thống tự phát và tự thử lại nhóm nào lỗi (tối đa ${MAX_ATTEMPTS} lần), rồi báo ` +
          `kết quả về nhóm này.\n` +
          `Nói với ${flow.actorLabel} ĐÚNG như vậy: đã chuyển đi duyệt, đang chờ duyệt. TUYỆT ĐỐI ` +
          `không nói "đã gửi cho đại lý". Muốn xem tiến độ thì gọi ${flow.names.status}.`,
      };
    case "no_approver":
      return {
        content:
          `Chưa chuyển đi duyệt được: ${outcome.detail}. KHÔNG có tin nào được gửi và cũng chưa ` +
          `có đợt nào được tạo — bản nháp vẫn còn, chốt lại sau khi bên kỹ thuật xử lý. Báo ` +
          `${flow.actorLabel} đúng như vậy.`,
        isError: true,
      };
    case "expired":
      return {
        content:
          `Mã nháp không còn hiệu lực (quá 10 phút, hoặc đã chốt rồi, hoặc mã sai). KHÔNG có tin ` +
          `nào được gửi. Soạn lại bằng ${flow.names.draft} rồi xin duyệt lần nữa.`,
        isError: true,
      };
    case "not_author":
      return {
        content:
          "Bản nháp này do người khác soạn nên người đang nói không chốt được, và nháp đã bị huỷ. " +
          "Không có tin nào được gửi. Nói rõ là người chốt phải TỰ soạn bản của mình rồi chốt.",
        isError: true,
      };
    case "no_room":
      return {
        content:
          `Không còn nhóm đại lý nào đang nối nên không gửi cho ai cả. Nháp đã huỷ. Báo ` +
          `${flow.actorLabel} là chưa gửi được, cần bên vận hành kiểm tra việc nối nhóm.`,
        isError: true,
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Soát kết quả
// ─────────────────────────────────────────────────────────────────────────────

export function buildNoticeStatusTool(ctx: ToolContext, flow: NoticeFlow): Tool {
  return {
    name: flow.names.status,
    description: flow.descriptions.status,
    inputSchema: {
      type: "object",
      properties: {
        ma_dot: {
          type: "string",
          description: `Mã đợt phát mà ${flow.names.send} đã trả về. Bỏ trống = đợt gần nhất.`,
        },
      },
      required: [],
    },
    run: (input: unknown): Promise<ToolResult> => runStatus(ctx, flow, input),
  };
}

async function runStatus(ctx: ToolContext, flow: NoticeFlow, input: unknown): Promise<ToolResult> {
  const port = ctx.announce;
  if (port === undefined) return NO_PORT;
  // Soát dùng cửa SOẠN: ai xin phát được thì cũng được biết đợt của chính mình tới đâu. Tool chỉ
  // trả đợt của chính người hỏi (`senderId`), nên không lộ đợt của người khác.
  if (!flow.draftGate.allow(ctx.identity)) return flow.draftGate.denied;

  const status = await port.status({
    senderId: ctx.identity.senderId,
    announcementId: readStringField(input, "ma_dot"),
  });
  if (status === undefined) {
    return {
      content:
        "Không tìm thấy đợt phát nào. Kiểm tra lại mã đợt; nếu người đang hỏi chưa từng gửi " +
        "thông báo nào thì nói thẳng như vậy.",
      isError: true,
    };
  }
  return { content: renderStatus(status, flow) };
}

function renderStatus(status: AnnouncementStatus, flow: NoticeFlow): string {
  // Chưa duyệt / bị từ chối thì con số nhóm là vô nghĩa — trả lời thẳng trạng thái, đừng để model
  // đọc "0/45 đã nhận" rồi tưởng đang gửi dở.
  if (status.state === AnnouncementState.AwaitingApproval) {
    return (
      `Đợt ${status.announcementId} ĐANG CHỜ DUYỆT — chưa nhóm nào nhận được gì. Sẽ tới ` +
      `${status.total} nhóm khi được duyệt. Nói với ${flow.actorLabel} là đang chờ người duyệt ` +
      `của công ty, KHÔNG hứa thời điểm.`
    );
  }
  if (status.state === AnnouncementState.Rejected) {
    return (
      `Đợt ${status.announcementId} KHÔNG được duyệt` +
      `${status.rejectReason === undefined ? "" : ` — lý do: ${status.rejectReason}`}. ` +
      `Không nhóm nào nhận tin này. Báo ${flow.actorLabel} lý do, hỏi họ có sửa nội dung rồi xin ` +
      `lại không.`
    );
  }

  const lines = [
    `Đợt ${status.announcementId} đã được duyệt: ${status.sent}/${status.total} nhóm đã nhận, ` +
      `${status.pending} nhóm đang chờ gửi, ${status.failed.length} nhóm hỏng.`,
  ];
  if (status.failed.length > 0) {
    lines.push("Nhóm hỏng (hệ thống đã thôi thử):");
    for (const item of status.failed) {
      lines.push(
        `- đại lý ${item.customerId} (nhóm ${item.groupId}): ${item.reason}`,
      );
    }
    lines.push(
      `Mấy nhóm này KHÔNG nhận được tin. Báo ${flow.actorLabel} biết để họ nhắn tay hoặc nhờ vận ` +
        `hành kiểm tra nhóm, đừng coi như đã gửi đủ.`,
    );
  }
  if (status.pending > 0) {
    lines.push(
      "Còn nhóm đang chờ → chưa xong, đừng nói 'đã gửi hết'. Vài phút nữa soát lại.",
    );
  }
  return lines.join("\n");
}
