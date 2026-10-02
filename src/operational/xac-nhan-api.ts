// xac-nhan-api.ts — OrderConfirmPort chạy trên API hệ vận hành (dilim-system):
//   - GHI:  `POST /agent/expert-verifications`  (expert-verification-agent.controller.ts)
//   - TRA:  `GET  /agent/dealers/lookup?code=`  (agent-lookup.controller.ts)
//   - KIỂM: `GET  /agent/expert-verifications/purchase-check`  (khách "đang dùng" có đơn thật không)
//
// Cả hai chỉ service token, KHÔNG `x-dealer-id`: lúc sale gửi, việc của mình chính là TRA RA đại
// lý từ mã cạnh STT. Không gửi `x-staff-id`: sale phần lớn chưa bind định danh hệ vận hành.
//
// Backend bật `forbidNonWhitelisted` → body PHẢI đúng 5 khoá của CreateExpertVerificationDto, dư
// một khoá là 400. Mọi trường nghiệp vụ không có cột riêng (tình trạng, sản phẩm, lý do, khung,
// STT, theo dõi) gộp vào `note` cho người đại diện đọc.

import { AgentApiError, readEnvelopeData, type AgentApiClient } from "./agent-api.ts";
import { asRecord, numberAsString, readBoolean, readNumber, readString } from "./read.ts";
import type {
  DealerRef,
  NewRegistration,
  OrderConfirmPort,
  PurchaseCheck,
  Registration,
  RegistrationStatus,
} from "./types.ts";

const REGISTER_PATH = "/agent/expert-verifications";
const PURCHASE_CHECK_PATH = `${REGISTER_PATH}/purchase-check`;
/** Trần `note` của DTO backend (`@MaxLength(2000)`). Vượt là 400, cắt ở đây cho chắc. */
const MAX_NOTE_CHARS = 2000;
/** Nhãn khung giờ trong note — người đại diện đọc, không phải máy. */
const SLOT_TEXT = { trua: "11h–12h", chieu: "16h–17h" } as const;
/**
 * Tra đại lý theo mã — endpoint SẴN CÓ của backend (`agent-lookup.controller.ts`), khớp đúng mã
 * không phân biệt hoa thường, chỉ đại lý đang hoạt động. Token cần scope `Dealer:read:all`.
 */
const DEALER_LOOKUP_PATH = "/agent/dealers/lookup";

export class AgentApiOrderConfirmPort implements OrderConfirmPort {
  constructor(private readonly api: AgentApiClient) {}

  async findDealer(code: string, signal?: AbortSignal): Promise<DealerRef | null> {
    let body: unknown;
    try {
      body = await this.api.getUnscoped(DEALER_LOOKUP_PATH, { signal, query: { code } });
    } catch (err) {
      // 404 = không có đại lý mang mã này. 400 chỉ xảy ra khi mã rỗng/quá 64 ký tự — tool đã chặn
      // trước, nhưng nếu lọt thì cũng đúng nghĩa "không có mã này", không phải lỗi hạ tầng.
      if (err instanceof AgentApiError && (err.status === 404 || err.status === 400)) return null;
      throw err;
    }
    const record = asRecord(readEnvelopeData(body, DEALER_LOOKUP_PATH));
    if (record === undefined) return null;
    const id = readString(record, "id") ?? numberAsString(record, "id");
    const found = readString(record, "code");
    // Thiếu id hay mã = không nối được dòng sổ với đại lý nào → coi như không có, không đoán.
    if (id === undefined || found === undefined) return null;
    const name = readString(record, "name");
    return { id, code: found, ...(name === undefined ? {} : { name }) };
  }

  async purchaseCheck(
    input: { readonly dealerId: string; readonly phone: string },
    signal?: AbortSignal,
  ): Promise<PurchaseCheck> {
    const body = await this.api.getUnscoped(PURCHASE_CHECK_PATH, {
      signal,
      query: { dealer_id: input.dealerId, phone: input.phone },
    });
    const record = asRecord(readEnvelopeData(body, PURCHASE_CHECK_PATH)) ?? {};
    const orderCount = readNumber(record, "order_count") ?? 0;
    const lastOrderAt = readString(record, "last_order_at");
    return {
      // Suy từ số đơn chứ không tin riêng cờ: thiếu cờ mà có đơn thì vẫn là đã mua.
      purchased: readBoolean(record, "purchased") ?? orderCount > 0,
      orderCount,
      ...(lastOrderAt === undefined ? {} : { lastOrderAt }),
    };
  }

  async register(input: NewRegistration, signal?: AbortSignal): Promise<Registration> {
    const body = await this.api.postUnscoped(REGISTER_PATH, {
      signal,
      // ĐÚNG 5 khoá — xem đầu file.
      body: {
        customer_phone: input.phone,
        customer_name: input.customerName,
        note: composeNote(input),
        zalo_thread_id: input.threadId,
        dealer_id: input.dealerId,
      },
    });
    return readRegistration(readEnvelopeData(body, REGISTER_PATH), input);
  }
}

/**
 * Mục 3 cho người đại diện: món MỚI tư vấn/chốt và món khách ĐANG dùng tách hai dòng — tin thật có
 * ca "Đã tư vấn: men + nghệ. cô đang uống Rich + DHA", gộp một dòng là bác sĩ tưởng khách đã uống
 * men + nghệ. Khách chỉ đang dùng (không tư vấn món mới) thì hai món trùng nhau → một dòng.
 */
function productLines(input: NewRegistration): readonly string[] {
  const offered = `${input.closed ? "Đã chốt" : "Đã tư vấn"}: ${input.product}`;
  const inUse = input.inUse;
  if (inUse === undefined) return [offered];
  const evidence = inUse.verified
    ? `đã có ${inUse.orderCount} đơn ở đại lý${inUse.lastOrderAt === undefined ? "" : `, gần nhất ${inUse.lastOrderAt.slice(0, 10)}`}`
    : "hệ thống CHƯA thấy đơn — sale khẳng định đã mua";
  const using = `Đang dùng: ${inUse.products} (${evidence})`;
  return sameText(inUse.products, input.product) ? [using] : [offered, using];
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Gộp các trường không có cột riêng thành ghi chú cho người đại diện. Mỗi mục một dòng, nhãn
 * tiếng Việt — đây là thứ bác sĩ đọc trước cuộc gọi, không phải dữ liệu máy đọc lại.
 */
export function composeNote(input: NewRegistration): string {
  const lines = [
    `STT: ${input.stt ?? "?"} · Đại lý: ${input.dealerCode}${input.saleName === undefined ? "" : ` · Sale: ${input.saleName}`}`,
    `Tình trạng: ${input.condition}`,
    ...productLines(input),
    `Lý do xác nhận: ${input.reason}`,
    `Khung giờ: ${SLOT_TEXT[input.slot]} ngày ${input.day}${input.onTime ? "" : " (đăng ký muộn — xếp sau)"}`,
  ];
  const followUp = input.followUp;
  if (followUp !== undefined) {
    lines.push(
      "Đã dùng mà chưa hiệu quả:",
      `- Trước khi dùng: ${followUp.conditionBefore}`,
      `- Hiện tại: ${followUp.conditionNow}`,
      `- Liệu trình đã dùng: ${followUp.courseUsed}`,
      `- Thời gian dùng: ${followUp.duration}`,
      `- Số lần chăm sóc: ${followUp.careCount}`,
    );
  }
  return lines.join("\n").slice(0, MAX_NOTE_CHARS);
}

/**
 * Yêu cầu backend trả (`data` = ExpertVerificationRow + `created`). `fallback` = thứ vừa gửi lên:
 * backend thiếu field nào thì giữ giá trị agent đã biết. `created` vắng → true: backend luôn trả
 * field này, vắng nghĩa là backend đổi shape, mà HTTP 200 thì "đã ghi" vẫn đúng.
 */
function readRegistration(raw: unknown, fallback: NewRegistration): Registration {
  const record = asRecord(raw) ?? {};
  const customerName = readString(record, "customer_name") ?? fallback.customerName;
  const dealerCode = readString(record, "dealer_code") ?? fallback.dealerCode;
  const phone = readString(record, "customer_phone") ?? fallback.phone;
  return {
    id: readString(record, "uuid") ?? "",
    created: readBoolean(record, "created") ?? true,
    status: readStatus(readNumber(record, "status")),
    phoneLast5: phone.replace(/\D/g, "").slice(-5),
    customerName,
    dealerCode,
  };
}

/** 0 chờ duyệt · 1 đã xác nhận · 2 từ chối. Số lạ → chờ duyệt (không khẳng định gì thêm). */
function readStatus(raw: number | undefined): RegistrationStatus {
  if (raw === 1) return "da_xac_nhan";
  if (raw === 2) return "tu_choi";
  return "cho_duyet";
}
