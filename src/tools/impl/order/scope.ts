// scope.ts — thứ dùng chung của MỌI tool đơn hàng: ai được tra, và cách in mã/số/ngày cho model đọc.
//
// Đặt riêng vì phần "ai được tra" là hàng rào bảo mật: sửa một chỗ, các tool cùng theo. Tool đơn
// hàng không được tự nghĩ ra cách resolve đại lý của riêng mình.

import { encode } from "@toon-format/toon";

import { ActorRole } from "../../../flash-command/types.ts";
import {
  CARRIER_LABEL,
  ORDER_STATUS_LABEL,
  type OrderPrincipal,
} from "../../../operational/types.ts";
import type { ToolContext, ToolResult } from "../../types.ts";

const TIME_ZONE = "Asia/Ho_Chi_Minh";
// Định dạng người Việt đọc quen: `dd/mm/YYYY`, có giờ thì `HH:mm dd/mm/YYYY`. Locale en-GB cho
// đúng thứ tự ngày/tháng/năm; `hourCycle: "h23"` để nửa đêm ra `00:xx`, không phải `24:xx`.
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Đại lý được phép tra trong lượt này: CHỦ PHÒNG trước (nhân viên gõ trong nhóm đại lý X vẫn tra
 * đơn của X), rồi tới identity đại lý (chat 1-1). Không ra ai → undefined, KHÔNG đoán.
 *
 * `staffId` chỉ để backend audit — nhân viên gõ thì kèm, đại lý tự hỏi thì không có.
 */
export function resolvePrincipal(ctx: ToolContext): OrderPrincipal | undefined {
  const dealerId = ctx.roomCustomerId ?? dealerIdOf(ctx);
  if (dealerId === undefined) return undefined;
  return {
    dealerId,
    staffId: ctx.identity.role === ActorRole.NhanVien ? ctx.identity.userId : undefined,
  };
}

function dealerIdOf(ctx: ToolContext): string | undefined {
  return ctx.identity.role === ActorRole.DaiLy ? ctx.identity.customerId : undefined;
}

/** Lỗi nghiệp vụ chung: chưa nối cổng / chưa biết đại lý. Trả structured để model tự xoay, không throw. */
export const NO_PORT: ToolResult = {
  content: "Hệ thống đơn hàng chưa sẵn sàng — báo khách là em kiểm tra lại sau.",
  isError: true,
};

export const NO_CUSTOMER: ToolResult = {
  content:
    "Chưa xác định được đại lý của cuộc trò chuyện này (nhóm chưa /ketnoi-daily). " +
    "Không tra được — báo khách cần nhân viên kết nối nhóm trước.",
  isError: true,
};

/** Thiếu mã vận đơn cho tool BẮT BUỘC có mã: chỉ model biết cách chốt mã (gọi tra_don_hang trước). */
export const NEED_TRACKING_NUMBER: ToolResult = {
  content:
    'Thiếu "ma_van_don". Gọi tra_don_hang để chốt đơn nào với khách trước, rồi gọi lại tool này.',
  isError: true,
};

/**
 * API vận hành trục trặc (5xx/timeout/shape lạ). Nói RÕ là trục trặc hệ thống, không để model
 * diễn dịch thành "không có đơn" — hai câu trả lời đó dẫn khách đi hai hướng khác hẳn nhau.
 */
export const LOOKUP_FAILED: ToolResult = {
  content:
    "Hệ thống vận hành đang không phản hồi nên chưa tra được. Báo khách là em kiểm tra lại và " +
    "trả lời sau, KHÔNG nói là không tìm thấy đơn.",
  isError: true,
};

/** Nhắc mọi câu trả lời "không thấy": cửa sổ tra cứu là 30 ngày, không phải toàn bộ lịch sử. */
export const WINDOW_NOTE = "Hệ thống chỉ tra được đơn trong 30 ngày gần nhất.";

/**
 * Câu trả lời cho "mã này không ra đơn nào của đại lý đang hỏi". Dùng CHUNG cho mọi tool tra theo mã:
 * 404 của backend cũng xảy ra khi đơn thuộc đại lý KHÁC, nên không tool nào được nói "đơn không tồn tại".
 */
export function orderNotFound(trackingNumber: string): string {
  return (
    `Không thấy đơn "${trackingNumber}" thuộc đại lý này. ${WINDOW_NOTE} ` +
    "Hỏi lại khách mã vận đơn — ĐỪNG nói là đơn không tồn tại (có thể là đơn của đại lý khác " +
    "hoặc đơn đã quá 30 ngày)."
  );
}

/** Nhãn trạng thái. Mã lạ (backend thêm trạng thái mới) → in số, không bịa nhãn. */
export function statusLabel(status: number | undefined): string {
  if (status === undefined) return "chưa rõ";
  return ORDER_STATUS_LABEL[status] ?? `mã ${status}`;
}

export function carrierLabel(carrier: number | undefined): string | undefined {
  if (carrier === undefined) return undefined;
  return CARRIER_LABEL[carrier] ?? `mã ${carrier}`;
}

/** ISO 8601 → `dd/mm/YYYY` giờ VN. Chuỗi không parse được → in nguyên (đừng nuốt dữ kiện). */
export function formatDate(iso: string | undefined): string | undefined {
  return formatWith((date) => dateFormat.format(date), iso);
}

/** ISO 8601 → `HH:mm dd/mm/YYYY` giờ VN. Dùng cho mốc cần giờ: hạn link, lịch sử trạng thái. */
export function formatDateTime(iso: string | undefined): string | undefined {
  return formatWith((date) => `${timeFormat.format(date)} ${dateFormat.format(date)}`, iso);
}

function formatWith(render: (date: Date) => string, iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined;
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? iso : render(new Date(ts));
}

/**
 * Tiền là CHUỖI NUMERIC(15,2) từ backend. Nhóm hàng nghìn bằng thao tác CHUỖI — không parseFloat:
 * số tiền đi qua float 64-bit là số tiền có thể lệch đúng lúc không nên lệch.
 * Shape lạ → in nguyên chuỗi, không đoán.
 */
export function formatMoney(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(trimmed);
  if (match === null) return trimmed;
  const sign = match[1] ?? "";
  const whole = match[2] ?? "0";
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped}${fraction === "" ? "" : `,${fraction}`} ₫`;
}

/** `- Nhãn: giá trị`, giá trị trống → undefined để nơi gọi BỎ HẲN dòng: model thấy "chưa có" sẽ bịa thành "đang cập nhật". */
export function line(label: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `- ${label}: ${value}`;
}

/**
 * Một hàng bảng. Ô chữ phải format sẵn (tiền/ngày format trước khi vào đây); ô số giữ nguyên
 * `number` để TOON in trần `2` thay vì `"2"` — chuỗi trông giống số bị bọc nháy để giữ kiểu.
 */
export type Row = Readonly<Record<string, string | number>>;

/**
 * In khối lặp dạng bảng TOON — nhãn cột khai MỘT lần ở header, mỗi bản ghi là một hàng:
 *
 *     video[2]{lan_quet,luc_quet,link}:
 *       SS-1,"10:30 05/08/2026",https://...
 *       SS-2,"10:41 05/08/2026",https://...
 *
 * CHỈ dùng khi format cũ lặp NHÃN ở mỗi bản ghi (video: 5 nhãn × N lần quét → -27% token đo thật).
 * ĐỪNG áp cho khối đã in giá trị trần kiểu `- a · b · c` (danh sách đơn, hàng trong đơn, lịch sử
 * trạng thái): ở đó không có nhãn nào để gom, mà header + nháy quanh chuỗi có dấu cách + ô `""`
 * lại ĐẮT HƠN format cũ 6–12% — đã đo, đừng đổi lại.
 *
 * KHÁC `line()`: ô trống in `""` chứ KHÔNG bỏ cột — bảng phải đều cột thì model mới đọc đúng ô nào
 * thuộc cột nào.
 */
export function table(name: string, rows: readonly Row[]): string {
  return encode({ [name]: rows });
}

/** Ô bảng: thiếu dữ kiện → chuỗi rỗng (TOON in `""`), không để `undefined` lọt vào bảng. */
export function cell(value: string | undefined): string {
  return value ?? "";
}
