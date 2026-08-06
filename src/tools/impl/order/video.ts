// video.ts — tool lấy LINK video quay đơn: lúc đóng hàng (`dong_goi`) và lúc khui kiện hàng đại
// lý trả về (`khui_hoan`). Hai loại phục vụ hai tranh chấp khác nhau — thiếu hàng lúc nhận, và
// thiếu hàng lúc hoàn.
//
// Link LUÔN có hạn (OrderVideo.expiresAt) và tool luôn in hạn ra: link gửi vào nhóm chat là link
// đi xa hơn nhóm chat, khách phải biết nó sống được bao lâu.
//
// `loai` do model sinh = untrusted → whitelist đúng 2 giá trị, giá trị lạ trả isError để model tự
// sửa (KHÔNG im lặng bỏ filter, vì bỏ filter là trả nhầm loại video cho một vụ tranh chấp).

import { OrderVideoKind, type OrderVideo } from "../../../operational/types.ts";
import { readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import {
  NEED_ORDER_CODE,
  NO_CUSTOMER,
  NO_PORT,
  formatDate,
  resolveCustomer,
} from "./scope.ts";

const KIND_LABEL: Record<OrderVideoKind, string> = {
  [OrderVideoKind.DongGoi]: "video đóng gói (lúc gửi hàng đi)",
  [OrderVideoKind.KhuiHoan]: "video khui hàng hoàn (lúc nhận hàng trả về)",
};

const KINDS: readonly string[] = Object.values(OrderVideoKind);

export function buildOrderVideoTool(ctx: ToolContext): Tool {
  return {
    name: "video_don_hang",
    description:
      "Lấy link video quay đơn hàng: `dong_goi` (lúc đóng gói gửi đi) hoặc `khui_hoan` (lúc khui " +
      "kiện hàng đại lý trả về). Bắt buộc `ma_don`; bỏ trống `loai` để lấy mọi video có của đơn. " +
      "Link có hạn — gửi kèm hạn cho khách. CHỈ ĐỌC.",
    inputSchema: {
      type: "object",
      properties: {
        ma_don: { type: "string", description: 'Mã đơn, ví dụ "DH-1042".' },
        loai: {
          type: "string",
          enum: [...KINDS],
          description: "dong_goi = quay lúc đóng hàng đi; khui_hoan = quay lúc khui hàng hoàn về.",
        },
      },
      required: ["ma_don"],
    },
    announce: "Dạ để em lấy video của đơn giúp anh/chị ạ.",
    run: (input: unknown): Promise<ToolResult> => runLookup(ctx, input),
  };
}

async function runLookup(ctx: ToolContext, input: unknown): Promise<ToolResult> {
  const orders = ctx.orders;
  if (orders === undefined) return NO_PORT;

  const customerId = resolveCustomer(ctx);
  if (customerId === undefined) return NO_CUSTOMER;

  const code = readStringField(input, "ma_don");
  if (code === undefined) return NEED_ORDER_CODE;

  const rawKind = readStringField(input, "loai");
  if (rawKind !== undefined && !isKind(rawKind)) {
    return { content: `Giá trị "loai" không hợp lệ: ${rawKind}. Chỉ nhận: ${KINDS.join(", ")}.`, isError: true };
  }

  const clips = await orders.videos({ customerId, code, kind: rawKind });
  if (clips.length === 0) return { content: renderEmpty(code, rawKind) };
  return { content: [`Video đơn ${code}:`, ...clips.map(renderClip)].join("\n") };
}

function isKind(value: string): value is OrderVideoKind {
  return KINDS.includes(value);
}

/**
 * Rỗng KHÔNG phải lỗi: đơn chưa tới bước đóng gói, hoặc chưa có hàng hoàn nào. Nói rõ "chưa có"
 * để model không diễn dịch thành "hệ thống lỗi" rồi hứa gửi sau.
 */
function renderEmpty(code: string, kind: OrderVideoKind | undefined): string {
  const what = kind === undefined ? "video nào" : KIND_LABEL[kind];
  return `Đơn "${code}" chưa có ${what} (hoặc mã đơn không thuộc đại lý này). Không hứa gửi sau khi chưa có.`;
}

function renderClip(clip: OrderVideo): string {
  return [
    `- ${KIND_LABEL[clip.kind]}`,
    `  Quay ngày: ${formatDate(clip.recordedAt)}`,
    `  Link: ${clip.url}`,
    `  Link hết hạn: ${formatDate(clip.expiresAt)}`,
  ].join("\n");
}
