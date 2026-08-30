// video.ts — tool lấy LINK video camera của đơn (quay lúc quét/đóng gói), để đại lý đối chiếu khi
// tranh chấp thiếu hàng.
//
// LINK SỐNG 15 PHÚT. Vì vậy tool KHÔNG cache và prompt phải bắt model gọi lại tool ngay lúc gửi:
// link dán lại từ lịch sử chat là link đã chết, khách bấm vào chỉ thấy lỗi rồi mất niềm tin.
//
// Rỗng KHÔNG phải lỗi: đơn chưa quét/chưa đóng gói thì chưa có gì để xem.

import { AgentApiError } from "../../../operational/agent-api.ts";
import type { OrderCameraLink } from "../../../operational/types.ts";
import { readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import {
  LOOKUP_FAILED,
  NEED_TRACKING_NUMBER,
  NO_CUSTOMER,
  NO_PORT,
  type Row,
  cell,
  formatDateTime,
  resolvePrincipal,
  table,
} from "./scope.ts";

/** Câu bắt buộc kèm mọi link — khách phải biết nó sống được bao lâu. */
const TTL_NOTE = "Mỗi link chỉ có hiệu lực 15 phút — nói rõ câu này khi gửi cho khách.";

/**
 * session_type từ API: 0 = quét xuất kho (đóng gói), 1 = quét nhập hàng hoàn (khui hàng hoàn).
 * Backend cũ chưa trả field này → nhãn rỗng, model coi như không rõ loại.
 */
const SESSION_TYPE_LABELS: Readonly<Record<number, string>> = {
  0: "đóng gói",
  1: "khui hàng hoàn",
};

export function buildOrderVideoTool(ctx: ToolContext): Tool {
  return {
    name: "video_don_hang",
    description:
      "Lấy link video camera của một đơn. Có 2 loại (cột `loai`): video ĐÓNG GÓI (quét xuất kho) " +
      "và video KHUI HÀNG HOÀN (quét nhập hàng hoàn) — gửi đúng loại khách xin, xin chung chung " +
      "thì gửi cả hai. Bắt buộc `ma_van_don`. Link hết hạn sau 15 phút: gọi tool NGAY lúc chuẩn " +
      "bị gửi cho khách, KHÔNG gửi lại link cũ đã có trong lịch sử chat. CHỈ ĐỌC.",
    inputSchema: {
      type: "object",
      properties: {
        ma_van_don: { type: "string", description: 'Mã vận đơn, ví dụ "VTP0093412".' },
      },
      required: ["ma_van_don"],
    },
    announce: "Em lấy video của đơn chút ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> => runLookup(ctx, input, signal),
  };
}

async function runLookup(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const orders = ctx.orders;
  if (orders === undefined) return NO_PORT;

  const principal = resolvePrincipal(ctx);
  if (principal === undefined) return NO_CUSTOMER;

  const trackingNumber = readStringField(input, "ma_van_don");
  if (trackingNumber === undefined) return NEED_TRACKING_NUMBER;

  let links: readonly OrderCameraLink[];
  try {
    links = await orders.cameraLinks({ ...principal, trackingNumber, signal });
  } catch (err) {
    if (err instanceof AgentApiError) {
      // message chỉ có method/path/status/code — KHÔNG có service token.
      console.error("[video_don_hang] API vận hành lỗi:", err.message);
      return LOOKUP_FAILED;
    }
    throw err;
  }

  if (links.length === 0) return { content: renderEmpty(trackingNumber) };
  return {
    content: [
      `Video đơn ${trackingNumber}:`,
      table("video", links.map(linkRow)),
      TTL_NOTE,
    ].join("\n"),
  };
}

/**
 * Rỗng = chưa có lần quét nào gắn camera (chưa đóng gói / không quay), hoặc đơn không thuộc đại lý
 * này. Nói rõ "chưa có" để model không diễn dịch thành "hệ thống lỗi" rồi hứa gửi sau.
 */
function renderEmpty(trackingNumber: string): string {
  return (
    `Đơn "${trackingNumber}" chưa có video camera nào (chưa tới bước đóng gói, không quay, hoặc mã ` +
    "đơn không thuộc đại lý này). Không hứa gửi sau khi chưa có."
  );
}

function linkRow(link: OrderCameraLink): Row {
  return {
    lan_quet: cell(link.sessionCode),
    loai: cell(link.sessionType === undefined ? undefined : SESSION_TYPE_LABELS[link.sessionType]),
    luc_quet: cell(formatDateTime(link.scannedAt)),
    so_camera: link.cameraCount ?? "",
    link: link.url,
    het_han_luc: cell(formatDateTime(link.expiresAt)),
  };
}
