// validate-paid.ts — tool GHI `duyet_don_da_thanh_toan`: duyệt lô đơn qua bước kho ngay trong
// nhóm đại lý, theo một trong HAI cửa của skill `duyet-don-0d`:
//   1. Đơn khách lẻ đã thanh toán cho đại lý — đại lý gửi bill khách chuyển khoản kèm mã vận
//      đơn; bill BẮT BUỘC (kể cả COD 0đ). Dòng tiền là khách cuối → đại lý, KHÔNG phải đại lý →
//      công ty; COD hệ thống của đơn khách lẻ hay nhập sai nên chỉ tham khảo, không phải điều kiện.
//   2. Đơn kẹt ở "đơn hàng mới" vì COD lệch bảng giá (`kiem_tra_gia_cod` INVALID) và đại lý yêu
//      cầu cho đơn đi — giá đang giai đoạn chưa thống nhất, công ty chấp nhận lệch; không cần
//      bill nhưng phải báo mức lệch và được đại lý xác nhận trước.
//
// Khác `duyet_don_qua_kho` (nội bộ, chỉ nhân viên, mọi đơn): tool này cho ĐẠI LÝ tự kích hoạt,
// nên hàng rào đổi từ VAI sang PHẠM VI — trước khi ghi, từng mã được tra qua cổng đọc đơn scoped
// theo đại lý CHỦ PHÒNG (server-side, model không truyền đại lý được). Mã không phải đơn của
// đại lý phòng này → loại khỏi lô, KHÔNG gửi đi duyệt. Guest không có cửa.
//
// Điều kiện nghiệp vụ (đã có bill khách chuyển khoản) do skill `duyet-don-0d` hướng dẫn model
// kiểm TRƯỚC khi gọi — tool không chặn, đúng chủ trương giai đoạn này: gom đủ thông tin để
// duyệt, chưa dựng gate đối chiếu.
//
// Đây là lệnh GHI → client KHÔNG retry. Lỗi transport/5xx nghĩa là KHÔNG BIẾT đã ghi hay chưa —
// phải nói đúng như vậy, đừng bảo người dùng "gửi lại đi" như thể chắc chắn chưa ghi.

import { ActorRole } from "../../../flash-command/types.ts";
import { AgentApiError } from "../../../operational/agent-api.ts";
import type {
  InternalValidateResult,
  OrderDetail,
  OrderPrincipal,
} from "../../../operational/types.ts";
import { readStringListField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import { render } from "../internal/validate-orders.ts";
import { NO_CUSTOMER, NO_PORT, formatMoney } from "./scope.ts";

/** Một bill che vài đơn là cùng; mỗi mã tốn một lượt tra chủ đơn nên trần thấp hơn lô nội bộ. */
const MAX_TRACKING_NUMBERS = 20;

/**
 * `orders.status` = 2 (chờ đại lý chuyển tiền): đơn này KHÔNG duyệt qua cửa nào của tool —
 * đường đi đúng là đại lý tạo phiếu thanh toán gộp (`tao_phieu_thanh_toan`), webhook SePay
 * tự mở khoá khi tiền về. Duyệt hộ ở đây là cho đơn đi mà công ty chưa nhận tiền hàng.
 */
const STATUS_CHO_DAI_LY_CHUYEN_TIEN = 2;

const NO_GUEST: ToolResult = {
  content:
    "Người gửi chưa được nhận diện là đại lý hay nhân viên — không duyệt đơn theo yêu cầu này. " +
    "Bảo họ liên hệ nhân viên phụ trách nhóm.",
  isError: true,
};

const INVALID_LIST: ToolResult = {
  content:
    'Danh sách mã vận đơn không hợp lệ. Truyền "ma_van_don" là mảng 1–' +
    `${MAX_TRACKING_NUMBERS} chuỗi mã, mỗi mã một phần tử, không để phần tử rỗng.`,
  isError: true,
};

const TOO_MANY: ToolResult = {
  content:
    `Một lần duyệt tối đa ${MAX_TRACKING_NUMBERS} mã. Chia nhỏ danh sách rồi gọi lại từng lô — ` +
    "báo người gửi biết là đang chia lô.",
  isError: true,
};

/** Lỗi ở bước TRA chủ đơn (chỉ đọc) — chưa ghi gì, nói thẳng là thử lại được. */
const LOOKUP_FAILED: ToolResult = {
  content:
    "Chưa duyệt được: hệ thống đơn hàng đang không phản hồi ở bước kiểm tra đơn. " +
    "Chưa có gì được ghi — đợi chút rồi thử lại.",
  isError: true,
};

/**
 * Lệnh ghi không retry nên lỗi hệ thống là trạng thái LỬNG: có thể đã ghi, có thể chưa.
 * Câu báo phải giữ đúng sự lửng đó — người thật soát sổ rồi mới quyết gửi lại.
 */
const WRITE_FAILED: ToolResult = {
  content:
    "Hệ thống vận hành đang không phản hồi nên KHÔNG RÕ lô này đã được ghi hay chưa. " +
    "Nói rõ như vậy và bảo người gửi đợi kiểm tra lại — ĐỪNG tự gửi lại lô, có thể ghi trùng.",
  isError: true,
};

export function buildValidatePaidOrdersTool(ctx: ToolContext): Tool {
  return {
    name: "duyet_don_da_thanh_toan",
    description:
      "Duyệt qua bước kho các đơn CỦA ĐẠI LÝ TRONG PHÒNG NÀY, theo một trong hai cửa của skill " +
      "`duyet-don-0d`: (1) khách lẻ đã thanh toán cho đại lý — đại lý gửi bill khách chuyển " +
      "khoản kèm mã vận đơn, bill bắt buộc kể cả đơn COD 0đ; (2) đơn kẹt vì COD lệch bảng giá " +
      "(kiem_tra_gia_cod trả KHÔNG khớp) và đại lý yêu cầu cho đơn đi — không cần bill, nhưng " +
      "phải đã báo mức lệch và được đại lý xác nhận. Nhận danh sách mã vận đơn " +
      `(1–${MAX_TRACKING_NUMBERS} mã); từng mã được kiểm tra là đơn của đúng đại lý phòng trước ` +
      "khi duyệt, mã lạ bị loại. Đơn đang CHỜ ĐẠI LÝ CHUYỂN TIỀN cũng bị tự loại — đơn đó phải " +
      "đi đường phiếu thanh toán gộp (tao_phieu_thanh_toan), không duyệt hộ được. Đây là lệnh " +
      "GHI — chỉ gọi khi đủ điều kiện theo skill `duyet-don-0d`, không tự gom mã từ chỗ khác.",
    inputSchema: {
      type: "object",
      properties: {
        ma_van_don: {
          type: "array",
          items: { type: "string" },
          description:
            `Danh sách mã vận đơn cần duyệt, 1–${MAX_TRACKING_NUMBERS} mã, đúng nguyên văn ` +
            "người gửi đưa (trong tin nhắn hoặc đọc từ ảnh bill).",
        },
      },
      required: ["ma_van_don"],
    },
    announce: "Đang kiểm tra.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> =>
      run(ctx, input, signal),
  };
}

async function run(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const { internal, orders } = ctx;
  if (internal === undefined || orders === undefined) return NO_PORT;
  if (ctx.identity.role === ActorRole.Guest) return NO_GUEST;

  const principal = resolveDealerPrincipal(ctx);
  if (principal === undefined) return NO_CUSTOMER;

  const trackingNumbers = readStringListField(input, "ma_van_don");
  if (trackingNumbers === undefined || trackingNumbers.length === 0)
    return INVALID_LIST;
  if (trackingNumbers.length > MAX_TRACKING_NUMBERS) return TOO_MANY;

  // Hàng rào phạm vi: chỉ mã tra ra đơn của đại lý phòng mới được vào lô ghi.
  let details: (OrderDetail | null)[];
  try {
    details = await Promise.all(
      trackingNumbers.map((trackingNumber) =>
        orders.detail({ ...principal, trackingNumber, signal }),
      ),
    );
  } catch (err) {
    if (err instanceof AgentApiError) {
      console.error("[duyet_don_da_thanh_toan] tra chủ đơn lỗi:", err.message);
      return LOOKUP_FAILED;
    }
    throw err;
  }

  const owned: OrderDetail[] = [];
  const skipped: string[] = [];
  trackingNumbers.forEach((code, i) => {
    const detail = details[i];
    if (detail === null || detail === undefined) skipped.push(code);
    else owned.push(detail);
  });

  if (owned.length === 0) {
    return {
      content:
        "Không mã nào là đơn của đại lý phòng này (trong 30 ngày gần nhất) — chưa duyệt gì. " +
        "Đọc lại mã trên bill/tin nhắn và hỏi lại người gửi từng mã một.",
      isError: true,
    };
  }

  // Hàng rào trạng thái: đơn "chờ đại lý chuyển tiền" bị loại khỏi lô — đường đi của nó là
  // phiếu thanh toán gộp, không phải duyệt kho.
  const awaitingPayment = owned.filter((o) => o.status === STATUS_CHO_DAI_LY_CHUYEN_TIEN);
  const eligible = owned.filter((o) => o.status !== STATUS_CHO_DAI_LY_CHUYEN_TIEN);

  if (eligible.length === 0) {
    return {
      content:
        "Chưa duyệt gì: các đơn này đang ở trạng thái CHỜ ĐẠI LÝ CHUYỂN TIỀN — không duyệt qua " +
        "kho được (kể cả có bill khách CK hay đại lý yêu cầu). Hướng dẫn đại lý tạo phiếu thanh " +
        "toán gộp (tao_phieu_thanh_toan) và chuyển khoản; tiền về là đơn tự đi tiếp.\n" +
        awaitingPayment.map((o) => `- ${o.trackingNumber}`).join("\n"),
      isError: true,
    };
  }

  try {
    const result = await internal.validateOrders({
      staffId: resolveStaffId(ctx),
      trackingNumbers: eligible.map((o) => o.trackingNumber),
      signal,
    });
    return { content: renderPaid(result, eligible, skipped, awaitingPayment) };
  } catch (err) {
    if (err instanceof AgentApiError) {
      // message chỉ có method/path/status/code — KHÔNG có service token.
      console.error("[duyet_don_da_thanh_toan] API vận hành lỗi:", err.message);
      return WRITE_FAILED;
    }
    throw err;
  }
}

/**
 * Đại lý chủ phòng — ưu tiên phòng đã /ketnoi-daily; đại lý gõ trong chat 1-1 thì lấy chính họ.
 * Giống resolvePrincipal (scope.ts) nhưng KHÔNG cho nhân viên mượn quyền ngoài phòng đại lý:
 * lệnh ghi phải neo vào một đại lý cụ thể.
 */
function resolveDealerPrincipal(ctx: ToolContext): OrderPrincipal | undefined {
  const dealerId =
    ctx.roomCustomerId ??
    (ctx.identity.role === ActorRole.DaiLy ? ctx.identity.customerId : undefined);
  if (dealerId === undefined) return undefined;
  return {
    dealerId,
    staffId: ctx.identity.role === ActorRole.NhanVien ? ctx.identity.userId : undefined,
  };
}

/** Audit người ghi — chỉ khi người gõ là nhân viên và bind ra `accounts.id` dạng số. */
function resolveStaffId(ctx: ToolContext): string | undefined {
  if (ctx.identity.role !== ActorRole.NhanVien) return undefined;
  return /^\d+$/.test(ctx.identity.userId) ? ctx.identity.userId : undefined;
}

/**
 * Kết quả duyệt + COD hệ thống từng đơn + mã bị loại vì không phải đơn phòng này.
 * COD ghi rõ là "trên hệ thống" vì đơn bán khách lẻ hay bị nhập sai COD — số này chỉ để
 * tham khảo/đối chiếu sau, model không được dùng nó khẳng định khách còn nợ.
 */
function renderPaid(
  result: InternalValidateResult,
  owned: readonly OrderDetail[],
  skipped: readonly string[],
  awaitingPayment: readonly OrderDetail[],
): string {
  const lines: string[] = [render(result)];
  lines.push("COD trên hệ thống của từng đơn (tham khảo — đơn khách lẻ có thể ghi sai COD):");
  lines.push(
    ...owned.map(
      (o) => `- ${o.trackingNumber} · COD ${formatMoney(o.codAmount) ?? "hệ thống không trả số"}`,
    ),
  );
  if (awaitingPayment.length > 0) {
    lines.push(
      "Đang CHỜ ĐẠI LÝ CHUYỂN TIỀN (đã loại, không duyệt qua kho — hướng dẫn tạo phiếu thanh " +
        "toán gộp tao_phieu_thanh_toan, tiền về là đơn tự đi tiếp):",
    );
    lines.push(...awaitingPayment.map((o) => `- ${o.trackingNumber}`));
  }
  if (skipped.length > 0) {
    lines.push("KHÔNG PHẢI đơn của đại lý phòng này (đã loại, không duyệt):");
    lines.push(...skipped.map((code) => `- ${code}`));
  }
  return lines.join("\n");
}
