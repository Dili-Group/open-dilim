// status.ts — tool ĐỌC đơn của ĐÚNG đại lý trong phòng này: tra 1 đơn theo mã vận đơn, hoặc tìm
// danh sách đơn theo tên/SĐT khách/trạng thái.
//
// Chống confused-deputy (tools/types.ts): schema KHÔNG có trường đại lý. Đại lý lấy server-side
// (scope.ts) rồi đi lên header `x-dealer-id` — model KHÔNG có đường khai đại lý khác.
//
// Gộp "tra 1 đơn" và "tìm đơn" vào MỘT tool vì đó là một việc của khách ("đơn của chị tới đâu
// rồi") chỉ khác ở chỗ khách có nhớ mã hay không: có mã → chi tiết, không mã → danh sách để hỏi lại.
//
// Backend chỉ quét 30 NGÀY gần nhất (orders partition theo created_at). Không thấy ≠ không tồn tại.

import { AgentApiError } from "../../../operational/agent-api.ts";
import type {
  OrderDetail,
  OrderItem,
  OrderPort,
  OrderPrincipal,
  OrderSummary,
  OrderTransition,
} from "../../../operational/types.ts";
import { readIntegerField, readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import {
  LOOKUP_FAILED,
  NO_CUSTOMER,
  NO_PORT,
  WINDOW_NOTE,
  carrierLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  line,
  orderNotFound,
  resolvePrincipal,
  statusLabel,
} from "./scope.ts";

/** Số đơn liệt kê khi tìm — đủ để khách nhận ra đơn mình hỏi, không nhồi cả tháng vào context. */
const SEARCH_LIMIT = 10;
/** Số lần chuyển trạng thái in ra (mới nhất trước). Đủ kể "hàng đang ở đâu", không dán cả nhật ký. */
const TRANSITION_LIMIT = 8;

export function buildOrderStatusTool(ctx: ToolContext): Tool {
  return {
    name: "tra_don_hang",
    description:
      "Tra đơn hàng của đại lý trong cuộc trò chuyện này. Có mã vận đơn thì truyền `ma_van_don` để " +
      "lấy chi tiết + lịch sử trạng thái; chưa có mã thì truyền `tim_kiem` (tên khách / SĐT khách) " +
      "hoặc gọi trống để lấy đơn gần đây rồi hỏi lại khách đơn nào. CHỈ ĐỌC.",
    inputSchema: {
      type: "object",
      properties: {
        ma_van_don: {
          type: "string",
          description: "Mã vận đơn khách đọc, ví dụ \"VTP0093412\". Bỏ trống nếu khách chưa nói mã.",
        },
        tim_kiem: {
          type: "string",
          description:
            "Từ khoá tìm đơn khi chưa có mã vận đơn: tên khách hoặc số điện thoại khách nhận hàng.",
        },
        trang_thai: {
          type: "integer",
          description:
            "Lọc theo mã trạng thái nếu khách hỏi riêng một nhóm đơn (6 = giao thành công, " +
            "5 = đang vận chuyển, 14 = đã huỷ, 11 = đang hoàn hàng). Bỏ trống = mọi trạng thái.",
        },
      },
      required: [],
    },
    // Gọi hệ vận hành mất vài giây → báo khách trước, đừng để khách nhìn màn hình trống.
    announce: "Dạ để em kiểm tra đơn hàng giúp anh/chị ạ.",
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
  try {
    if (trackingNumber !== undefined) {
      return await lookupOne(orders, principal, trackingNumber, signal);
    }
    return await lookupMany(orders, principal, input, signal);
  } catch (err) {
    if (err instanceof AgentApiError) {
      // Log để trực hệ thống thấy; message chỉ có method/path/status/code, KHÔNG có token.
      console.error("[tra_don_hang] API vận hành lỗi:", err.message);
      return LOOKUP_FAILED;
    }
    throw err;
  }
}

async function lookupOne(
  orders: OrderPort,
  principal: OrderPrincipal,
  trackingNumber: string,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const order = await orders.detail({ ...principal, trackingNumber, signal });
  if (order === null) return { content: orderNotFound(trackingNumber) };
  return { content: renderDetail(order) };
}

async function lookupMany(
  orders: OrderPort,
  principal: OrderPrincipal,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const search = readStringField(input, "tim_kiem");
  const status = readIntegerField(input, "trang_thai");
  const page = await orders.search({ ...principal, search, status, pageSize: SEARCH_LIMIT, signal });

  if (page.orders.length === 0) {
    const what = search === undefined ? "đơn nào" : `đơn nào khớp "${search}"`;
    return { content: `Không thấy ${what} của đại lý này. ${WINDOW_NOTE} Hỏi lại khách mã vận đơn.` };
  }

  const header =
    search === undefined
      ? `${page.orders.length} đơn gần nhất của đại lý này (tổng ${page.total} đơn trong 30 ngày):`
      : `${page.orders.length}/${page.total} đơn khớp "${search}":`;
  return {
    content: [
      header,
      ...page.orders.map(renderLine),
      "Chốt với khách đơn nào rồi gọi lại tool với `ma_van_don` để lấy chi tiết.",
    ].join("\n"),
  };
}

/** 1 dòng/đơn — đủ nhận diện (mã, trạng thái, ngày, tiền, khách), không nhồi chi tiết. */
function renderLine(order: OrderSummary): string {
  const parts = [
    order.trackingNumber,
    statusLabel(order.status),
    formatDate(order.createdAt),
    formatMoney(order.totalAmount),
    order.customerName,
  ].filter((part): part is string => part !== undefined);
  return `- ${parts.join(" · ")}`;
}

function renderDetail(order: OrderDetail): string {
  const lines = [
    `Đơn ${order.trackingNumber}`,
    line("Trạng thái", statusLabel(order.status)),
    line("Ngày tạo", formatDateTime(order.createdAt)),
    line("Cập nhật", formatDateTime(order.updatedAt)),
    line("Đơn vị vận chuyển", carrierLabel(order.carrier)),
    line("Khách nhận", joinParts(order.customerName, order.customerPhone)),
    line("Địa chỉ", joinParts(order.shippingAddress, order.ward, order.district, order.province)),
    line("Tạm tính", formatMoney(order.subtotal)),
    line("Giảm giá", formatMoney(order.discount)),
    line("Phí ship", formatMoney(order.shippingFee)),
    line("Tổng tiền", formatMoney(order.totalAmount)),
    line("Thu hộ COD", formatMoney(order.codAmount)),
    line("Nhân viên phụ trách", order.staffName),
    line("Ghi chú", order.notes),
  ].filter(isLine);

  if (order.items !== undefined) {
    lines.push("Hàng trong đơn:", ...order.items.map(renderItem));
  }
  const history = order.transitions.slice(0, TRANSITION_LIMIT).map(renderTransition).filter(isLine);
  if (history.length > 0) lines.push("Lịch sử trạng thái:", ...history);
  return lines.join("\n");
}

function renderItem(item: OrderItem): string {
  const parts = [
    `${item.name}${item.sku === "" ? "" : ` (${item.sku})`}`,
    `SL ${item.quantity}`,
    formatMoney(item.lineTotal),
  ].filter((part): part is string => part !== undefined);
  return `- ${parts.join(" · ")}`;
}

/** Dòng lịch sử rỗng hoàn toàn (backend trả object trống) → undefined để bỏ, không in gạch đầu dòng suông. */
function renderTransition(transition: OrderTransition): string | undefined {
  const when = formatDateTime(transition.createdAt);
  const change =
    transition.toState === undefined
      ? transition.event
      : `${statusLabel(transition.fromState)} → ${statusLabel(transition.toState)}`;
  const parts = [when, change, transition.actorName, transition.reason].filter(
    (part): part is string => part !== undefined,
  );
  return parts.length === 0 ? undefined : `- ${parts.join(" · ")}`;
}

function joinParts(...parts: readonly (string | undefined)[]): string | undefined {
  const kept = parts.filter((part): part is string => part !== undefined);
  return kept.length === 0 ? undefined : kept.join(" · ");
}

function isLine(value: string | undefined): value is string {
  return value !== undefined;
}
