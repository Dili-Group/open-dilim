// ghi-nhan-khach.ts — `ghi_nhan_khach` GHI: gắn zalo user id của người đang nhắn Official Account
// vào hồ sơ khách hàng theo số điện thoại họ vừa để lại.
//
// Đây là ĐƯỜNG GHI DUY NHẤT của agent khách lẻ, và là mục tiêu thật của kênh OA: agent không chốt
// đơn, chỉ giải đáp đủ để khách yên tâm rồi bàn giao. Luật hội thoại ở skill `xin-so-dien-thoai`.
//
// `zalo_user_id` KHÔNG nằm trong schema: nó lấy từ `ctx.identity.senderId` (server-side). Cho model
// tự khai người nhắn là mở đường gắn hội thoại này vào hồ sơ khách khác.
//
// Tool KHÔNG đọc lại hồ sơ khách vừa gắn (backend có trả tên + đại lý): người nhắn chưa xác thực
// được là ai, đọc ngược ra là rò dữ liệu của người trùng số. Chỉ giữ SỐ DÒNG khớp.

import { AgentApiError } from "../../operational/agent-api.ts";
import type { CustomerZaloLinkResult } from "../../operational/types.ts";
import { readStringField } from "../input.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";

/** Số Việt Nam sau chuẩn hoá: 10 chữ số, bắt đầu bằng 0. Chặn ở đây để khỏi tốn round-trip nhận 400. */
const PHONE_PATTERN = /^0\d{9}$/;

const NO_PORT: ToolResult = {
  content:
    "Chưa ghi nhận được số điện thoại vì hệ thống chưa sẵn sàng. Nói với khách là em đã nhận thông " +
    "tin và sẽ có bạn phụ trách liên hệ lại — KHÔNG hứa mốc giờ, và KHÔNG nói là đã ghi vào hệ thống.",
  isError: true,
};

export function buildCustomerLeadTool(ctx: ToolContext): Tool {
  return {
    name: "ghi_nhan_khach",
    description:
      "GHI: gắn số điện thoại khách vừa để lại vào hệ thống, để bạn sale đang phụ trách khách đó " +
      "nắm được và gọi lại tư vấn. Gọi NGAY trong lượt khách đưa số — KHÔNG hỏi lại khách để " +
      "xác nhận số. Chỉ chép đúng số khách gõ — KHÔNG tự bịa, KHÔNG lấy số khác trong lịch sử chat " +
      "nếu khách không nhắc tới. Khách chưa cho số thì đừng gọi tool, xin số trước (skill " +
      "xin-so-dien-thoai).",
    inputSchema: {
      type: "object",
      properties: {
        so_dien_thoai: {
          type: "string",
          description:
            "Số điện thoại khách vừa đưa, chép nguyên văn. Nhận cả dạng có dấu cách, dấu chấm, " +
            "đầu +84 — tool tự chuẩn hoá.",
        },
      },
      required: ["so_dien_thoai"],
    },
    announce: "Em ghi nhận thông tin để bạn phụ trách liên hệ lại, chờ em chút ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> => run(ctx, input, signal),
  };
}

async function run(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const customerZalo = ctx.customerZalo;
  if (customerZalo === undefined) return NO_PORT;

  const phone = normalizePhone(readStringField(input, "so_dien_thoai"));
  if (phone === undefined) {
    return {
      content:
        "Số điện thoại chưa hợp lệ. Số Việt Nam có 10 chữ số và bắt đầu bằng 0 (vd 0912345678). " +
        "Đọc lại số cho khách nghe rồi nhờ khách gửi lại — nói nhẹ nhàng là số còn thiếu, " +
        "đừng nói khách gõ sai. KHÔNG tự sửa số, KHÔNG tự thêm chữ số.",
      isError: true,
    };
  }

  // senderId = id người nhắn trên kênh (Zalo OA user id). Có ở mọi vai, kể cả guest.
  const zaloUserId = ctx.identity.senderId;

  let result: CustomerZaloLinkResult;
  try {
    result = await customerZalo.link({ phone, zaloUserId }, signal);
  } catch (err) {
    if (err instanceof AgentApiError) return failure(err);
    throw err;
  }

  console.info(`[ghi_nhan_khach] matched=${result.matched}`);

  // Không có hồ sơ nào mang số này: hoặc khách chưa từng mua, hoặc số đang nhắn khác số lúc đặt
  // hàng. Hệ thống KHÔNG lưu số của khách mới (quyết định nghiệp vụ) → không có ai được báo, nên
  // tuyệt đối không hứa gọi lại ở nhánh này. Hứa hụt còn tệ hơn nói thẳng là chưa tra ra.
  if (result.matched === 0) {
    return {
      content:
        "Chưa tìm thấy hồ sơ khách nào mang số này, và số chưa được lưu lại. KHÔNG hứa là sẽ có " +
        "người gọi lại. Nếu khách nói mình đã từng mua thì hỏi nhẹ nhàng xem lúc đặt hàng có dùng " +
        "số nào khác không, rồi ghi lại bằng số đó. Nếu khách mua lần đầu thì cứ tiếp tục hỗ trợ " +
        "khách ngay trong cuộc trò chuyện này và mời khách nhắn tiếp khi cần.",
    };
  }

  return {
    content:
      "Đã gắn số điện thoại vào hồ sơ khách, bạn phụ trách sẽ nắm được. Báo khách là em đã nhận " +
      "thông tin, sẽ có bạn phụ trách gọi lại tư vấn, nhờ khách để ý điện thoại. KHÔNG hứa mốc giờ " +
      "cụ thể, KHÔNG đọc ra tên hay thông tin nào của hồ sơ.",
  };
}

/**
 * Chuẩn hoá số Việt Nam về `0` + 9 chữ số. Cô chú hay gõ có dấu cách/dấu chấm, hoặc chép từ danh
 * bạ ra dạng +84 — chuẩn hoá ở đây thay vì bắt model tự sửa (model sửa số là model đoán số).
 *
 * Backend khớp theo 9 chữ số cuối nên dạng nào cũng nhận; kiểm ở đây CHẶT HƠN backend là cố ý:
 * cô chú gõ hụt một số thì phải hỏi lại ngay, đừng để gắn nhầm vào hồ sơ người khác.
 *
 * KHÔNG đoán phần thiếu: 9 chữ số hay 11 chữ số đều trả undefined để tool hỏi lại khách.
 */
function normalizePhone(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  // Bỏ mọi thứ không phải chữ số (dấu cách, chấm, gạch, ngoặc) — giữ riêng dấu + ở đầu để nhận 84.
  const digits = raw.replace(/[^\d+]/g, "");
  const national = digits.startsWith("+84")
    ? `0${digits.slice(3)}`
    : digits.startsWith("84") && digits.length === 11
      ? `0${digits.slice(2)}`
      : digits;
  return PHONE_PATTERN.test(national) ? national : undefined;
}

/**
 * 4xx = hệ vận hành TỪ CHỐI (số dưới 9 chữ số, body sai) → chưa ghi gì, hỏi lại khách.
 * 5xx/mạng = KHÔNG BIẾT đã ghi hay chưa → không được xin lại số lần nữa, cũng không được khẳng
 * định đã ghi. Đường ghi không retry (xem AgentApiClient.postUnscoped).
 *
 * KHÔNG in `err.message`: message mang body backend trả, trong đó có thể có lại số điện thoại.
 */
function failure(err: AgentApiError): ToolResult {
  console.error(`[ghi_nhan_khach] API vận hành lỗi: ${err.status} ${err.code} ${err.path}`);

  if (err.status >= 400 && err.status < 500) {
    return {
      content:
        "Hệ thống không nhận số này. Đọc lại số cho khách nghe và nhờ khách xác nhận giúp, rồi thử " +
        "ghi lại một lần nữa. KHÔNG nói là đã ghi xong.",
      isError: true,
    };
  }

  return {
    content:
      "Hệ thống đang trục trặc nên chưa chắc đã ghi được. KHÔNG xin lại số của khách lần nữa và " +
      "KHÔNG nói là đã ghi xong — báo khách là em đã nhận thông tin, sẽ có bạn phụ trách liên hệ lại.",
    isError: true,
  };
}
