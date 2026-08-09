// het-hang.ts — thủ kho báo hết hàng → phát MỘT tin tới mọi nhóm đại lý đã nối.
//
// BA tool, và không tool nào trong đây GỬI được cho đại lý:
//   soan_thong_bao_het_hang → nháp (không ghi DB, không gửi) → thủ kho đọc lại
//   gui_thong_bao_het_hang  → XIN phát: ghi đợt vào DB ở trạng thái CHỜ DUYỆT, không gửi cho ai
//   soat_thong_bao          → xem đợt đã được duyệt chưa / tới bao nhiêu nhóm
//
// Tin chỉ thật sự đi khi NGƯỜI DUYỆT ĐÍCH DANH gõ `/duyet-thongbao` (flash command, không qua
// LLM). Đó là quy tắc cứng: mọi thông báo tới toàn bộ đại lý phải qua người duyệt. Vì thế tool ở
// đây tuyệt đối không được nói "đã gửi" — nó chỉ xin.
//
// VÌ SAO nhiều cửa vậy: một lần phát là tin vào MỌI nhóm đại lý và không rút lại được. Chỉ cần
// một câu lái trong nhóm kho (prompt injection) là model bắn tin sai ra cả hệ thống. Nguyên tắc 7
// ("write không tự thực thi") áp thẳng vào đây.
//
// GATE: chỉ NHÂN VIÊN có `role_slug = warehouse` (Quản lý kho) mới xin được. Không gate theo
// nhóm — nhóm chỉ chọn luồng, quyền luôn theo identity backend resolve (nguyên tắc 10/11).

import { MAX_ATTEMPTS } from "../../../announcements/index.ts";
import { AnnouncementKind } from "../../../announcements/types.ts";
import type { AnnouncementStatus } from "../../../announcements/types.ts";
import { AnnouncementStatus as AnnouncementState } from "../../../db/schema.ts";
import { readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";

/**
 * Chức danh hệ vận hành được phát tin toàn hệ. Khớp `user_binding.role_slug` do API vận hành trả
 * lúc `/ketnoi-hethong`. Nhân viên bind TRƯỚC khi API trả field này có `role_slug` NULL → bị từ
 * chối; họ phải chạy lại `/ketnoi-hethong`. Fail-closed là đúng: thà mất quyền còn hơn cấp thừa.
 */
const WAREHOUSE_ROLE_SLUG = "warehouse";

const NO_PORT: ToolResult = {
  content:
    "Chưa nối được hệ phát thông báo. Báo người dùng là em chưa gửi được, cần bên kỹ thuật kiểm tra.",
  isError: true,
};

const NOT_WAREHOUSE: ToolResult = {
  content:
    "Người đang nói KHÔNG phải quản lý kho nên không được phát thông báo cho đại lý. Nói thẳng là " +
    "việc này cần quản lý kho gõ, đừng hứa gửi. Nếu họ khẳng định mình là quản lý kho thì nhắc họ " +
    "chạy lại /ketnoi-hethong để hệ thống nhận đúng chức danh.",
  isError: true,
};

/** true = người gõ là quản lý kho. Mọi vai khác (đại lý, guest, nhân viên khác) đều false. */
function isWarehouseManager(ctx: ToolContext): boolean {
  const identity = ctx.identity;
  return (
    identity.role === "nhan_vien" &&
    (identity?.roleSlug === WAREHOUSE_ROLE_SLUG || identity?.roleSlug === "swe")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bước 1 — soạn nháp
// ─────────────────────────────────────────────────────────────────────────────

export function buildStockNoticeDraftTool(ctx: ToolContext): Tool {
  return {
    name: "soan_thong_bao_het_hang",
    description:
      "Soạn NHÁP thông báo hết hàng để gửi cho TẤT CẢ nhóm đại lý. Tool này KHÔNG gửi gì — nó chỉ " +
      "cất bản nháp và trả lại mã nháp. Chỉ quản lý kho dùng được. Gọi khi quản lý kho báo một " +
      "sản phẩm hết hàng và muốn báo cho các đại lý. Sau khi gọi: đọc nguyên văn bản nháp cho " +
      "quản lý kho nghe, hỏi họ duyệt, rồi mới gọi gui_thong_bao_het_hang với mã nháp đó.",
    inputSchema: {
      type: "object",
      properties: {
        noi_dung: {
          type: "string",
          description:
            "Nội dung thông báo GỬI THẲNG cho đại lý, viết đầy đủ thành tin nhắn hoàn chỉnh — mọi " +
            "nhóm sẽ nhận ĐÚNG chuỗi này, không nhóm nào được viết lại. Phải có: tên sản phẩm hết " +
            "hàng (nguyên văn như quản lý kho nói), và ngày dự kiến có hàng NẾU quản lý kho đã " +
            "nói ngày. Quản lý kho chưa nói ngày thì KHÔNG tự đoán ngày, không hứa 'vài hôm nữa'.",
        },
      },
      required: ["noi_dung"],
    },
    run: (input: unknown): Promise<ToolResult> => runDraft(ctx, input),
  };
}

async function runDraft(ctx: ToolContext, input: unknown): Promise<ToolResult> {
  const port = ctx.announce;
  if (port === undefined) return NO_PORT;
  if (!isWarehouseManager(ctx)) return NOT_WAREHOUSE;

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
          `CHƯA GỬI GÌ CẢ. Việc tiếp theo: đọc NGUYÊN VĂN nội dung trên cho quản lý kho, nói rõ ` +
          `sẽ gửi tới ${outcome.roomCount} nhóm, và hỏi họ có chốt không. Họ đồng ý thì gọi ` +
          `gui_thong_bao_het_hang với ma_ban_nhap = ${outcome.draft.id}. Họ muốn sửa thì gọi lại ` +
          `soan_thong_bao_het_hang với nội dung mới.\n\n` +
          `Nhắc trước cho quản lý kho biết: chốt xong tin VẪN CHƯA gửi — còn phải qua người duyệt ` +
          `của công ty đồng ý thì hệ thống mới phát.`,
      };
    case "no_room":
      return {
        content:
          "Chưa có nhóm đại lý nào được nối nên không có ai để gửi. Báo quản lý kho là hệ thống " +
          "chưa nối nhóm đại lý nào, cần bên vận hành nối trước.",
        isError: true,
      };
    case "too_long":
      return {
        content:
          `Nội dung dài ${outcome.length} ký tự, vượt trần ${outcome.limit} của kênh. Rút gọn rồi ` +
          `gọi lại — KHÔNG cắt bớt tuỳ tiện, giữ đủ tên sản phẩm và ngày dự kiến (nếu có).`,
        isError: true,
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bước 2 — chốt gửi
// ─────────────────────────────────────────────────────────────────────────────

export function buildStockNoticeSendTool(ctx: ToolContext): Tool {
  return {
    name: "gui_thong_bao_het_hang",
    description:
      "CHỐT một bản nháp thông báo hết hàng và GỬI ĐI DUYỆT. Tool này KHÔNG gửi cho đại lý — nó " +
      "đưa tin sang người duyệt của công ty; chỉ khi người đó đồng ý thì hệ thống mới phát. Chỉ " +
      "gọi khi quản lý kho ĐÃ nghe nguyên văn bản nháp và ĐÃ nói chốt — không suy ra sự đồng ý " +
      "từ câu chung chung. Chỉ chính người đã soạn nháp mới chốt được.",
    inputSchema: {
      type: "object",
      properties: {
        ma_ban_nhap: {
          type: "string",
          description:
            "Mã nháp mà soan_thong_bao_het_hang vừa trả về. Chép nguyên văn, không tự bịa mã.",
        },
      },
      required: ["ma_ban_nhap"],
    },
    announce: "Dạ em chuyển thông báo này đi duyệt ngay ạ.",
    run: (input: unknown): Promise<ToolResult> => runSend(ctx, input),
  };
}

async function runSend(ctx: ToolContext, input: unknown): Promise<ToolResult> {
  const port = ctx.announce;
  if (port === undefined) return NO_PORT;
  if (!isWarehouseManager(ctx)) return NOT_WAREHOUSE;

  // Việc treo neo vào PHÒNG, và kết quả duyệt cũng báo về phòng — chat 1-1 thì không có phòng
  // kho nào để báo về. Chặn ở đây thay vì đẻ một đợt phát không ai nhận được kết quả.
  const room = ctx.room;
  if (room === undefined) {
    return {
      content:
        "Thông báo hết hàng phải chốt trong NHÓM kho, không chốt được ở chat riêng — kết quả duyệt " +
        "cần một phòng để báo về. Bảo quản lý kho gõ lại trong nhóm kho.",
      isError: true,
    };
  }

  const draftId = readStringField(input, "ma_ban_nhap");
  if (draftId === undefined) {
    return { content: "Thiếu `ma_ban_nhap`.", isError: true };
  }

  const outcome = await port.queue({
    draftId,
    kind: AnnouncementKind.HetHang,
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
          `Nói với quản lý kho ĐÚNG như vậy: đã chuyển đi duyệt, đang chờ duyệt. TUYỆT ĐỐI không ` +
          `nói "đã gửi cho đại lý". Muốn xem tiến độ thì gọi soat_thong_bao.`,
      };
    case "no_approver":
      return {
        content:
          `Chưa chuyển đi duyệt được: ${outcome.detail}. KHÔNG có tin nào được gửi và cũng chưa ` +
          `có đợt nào được tạo — bản nháp vẫn còn, chốt lại sau khi bên kỹ thuật xử lý. Báo quản ` +
          `lý kho đúng như vậy.`,
        isError: true,
      };
    case "expired":
      return {
        content:
          "Mã nháp không còn hiệu lực (quá 10 phút, hoặc đã chốt rồi, hoặc mã sai). KHÔNG có tin " +
          "nào được gửi. Soạn lại bằng soan_thong_bao_het_hang rồi xin duyệt lần nữa.",
        isError: true,
      };
    case "not_author":
      return {
        content:
          "Bản nháp này do người khác soạn nên người đang nói không chốt được, và nháp đã bị huỷ. " +
          "Không có tin nào được gửi. Nói rõ là người soạn phải tự chốt.",
        isError: true,
      };
    case "no_room":
      return {
        content:
          "Không còn nhóm đại lý nào đang nối nên không gửi cho ai cả. Nháp đã huỷ. Báo quản lý " +
          "kho là chưa gửi được, cần bên vận hành kiểm tra việc nối nhóm.",
        isError: true,
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Soát kết quả
// ─────────────────────────────────────────────────────────────────────────────

export function buildStockNoticeStatusTool(ctx: ToolContext): Tool {
  return {
    name: "soat_thong_bao",
    description:
      "Xem một đợt thông báo đang chờ duyệt hay đã được duyệt, đã tới bao nhiêu nhóm, nhóm nào " +
      "gửi hỏng và vì sao. Gọi khi quản lý kho hỏi 'duyệt chưa', 'gửi xong chưa', 'đại lý nhận " +
      "chưa'. Bỏ trống ma_dot để xem đợt gần nhất của chính người đang hỏi.",
    inputSchema: {
      type: "object",
      properties: {
        ma_dot: {
          type: "string",
          description:
            "Mã đợt phát mà gui_thong_bao_het_hang đã trả về. Bỏ trống = đợt gần nhất.",
        },
      },
      required: [],
    },
    run: (input: unknown): Promise<ToolResult> => runStatus(ctx, input),
  };
}

async function runStatus(
  ctx: ToolContext,
  input: unknown,
): Promise<ToolResult> {
  const port = ctx.announce;
  if (port === undefined) return NO_PORT;
  if (!isWarehouseManager(ctx)) return NOT_WAREHOUSE;

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
  return { content: renderStatus(status) };
}

function renderStatus(status: AnnouncementStatus): string {
  // Chưa duyệt / bị từ chối thì con số nhóm là vô nghĩa — trả lời thẳng trạng thái, đừng để model
  // đọc "0/45 đã nhận" rồi tưởng đang gửi dở.
  if (status.state === AnnouncementState.AwaitingApproval) {
    return (
      `Đợt ${status.announcementId} ĐANG CHỜ DUYỆT — chưa nhóm nào nhận được gì. Sẽ tới ` +
      `${status.total} nhóm khi được duyệt. Nói với quản lý kho là đang chờ người duyệt của công ` +
      `ty, KHÔNG hứa thời điểm.`
    );
  }
  if (status.state === AnnouncementState.Rejected) {
    return (
      `Đợt ${status.announcementId} KHÔNG được duyệt` +
      `${status.rejectReason === undefined ? "" : ` — lý do: ${status.rejectReason}`}. ` +
      `Không nhóm nào nhận tin này. Báo quản lý kho lý do, hỏi họ có sửa nội dung rồi xin lại không.`
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
      "Mấy nhóm này KHÔNG nhận được tin. Báo quản lý kho biết để họ nhắn tay hoặc nhờ vận hành " +
        "kiểm tra nhóm, đừng coi như đã gửi đủ.",
    );
  }
  if (status.pending > 0) {
    lines.push(
      "Còn nhóm đang chờ → chưa xong, đừng nói 'đã gửi hết'. Vài phút nữa soát lại.",
    );
  }
  return lines.join("\n");
}
