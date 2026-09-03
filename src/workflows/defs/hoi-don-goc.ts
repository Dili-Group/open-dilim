// hoi-don-goc.ts — KHAI BÁO nghiệp vụ: kho nhận đơn hoàn `*DH` → hỏi đại lý xem nó là đơn nào.
//
// Đây là DATA cho bộ máy workflows/, không phải code chạy lượt. Toàn bộ thứ riêng của nghiệp vụ
// gói ở đây: mã nào cần hỏi, hỏi ai, câu chữ ra sao, chờ bao lâu. Nghiệp vụ khác = file khác
// cùng thư mục, KHÔNG đụng engine/poller/store.
//
// TẠI SAO phải hỏi người: mã hoàn thường trùng mã đơn gốc nên tra thẳng được; riêng loại `*DH` là
// mã bên vận chuyển sinh khi hoàn — phần thân mã tra ra được ĐẠI LÝ chủ đơn, nhưng đơn gốc cụ thể
// thì chỉ đại lý mới biết. Nên: bỏ đuôi `DH` để tìm nhóm đại lý, rồi hỏi họ mã đơn gốc.

import type { CustomerRoomLookup } from "../../auth/types.ts";
import type { OrderOwnerPort } from "../../operational/types.ts";
import type { PendingRequest, TargetResolution, WorkflowDef } from "../types.ts";

/** Slug — cũng là giá trị cột `workflow`. ĐỔI TÊN = mồ côi mọi việc đang treo. */
export const ASK_ORIGIN_ORDER = "hoi-don-goc";

/** Hậu tố mã hoàn cần hỏi lại. Mã không có hậu tố này thì tra thẳng được, không mở việc treo. */
const RETURN_SUFFIX = "DH";

/** Ký tự hợp lệ trong mã vận đơn: chữ và số. Khoảng trắng/gạch/chấm bị loại khi chuẩn hoá. */
const NON_ALNUM = /[^A-Z0-9]/g;

/** Mã đơn ngắn hơn ngần này chắc chắn không phải mã vận đơn — chặn model gửi bừa "OK", "co". */
const MIN_CODE_LENGTH = 5;

/**
 * Toàn số = gần như chắc chắn SĐT khách, không phải mã vận đơn (mã vận đơn luôn có tiền tố chữ
 * của hãng: PKE, VTP...). SĐT là ĐẦU MỐI tra cứu, không phải đáp án — agent phải tra ra mã trước.
 */
const DIGITS_ONLY = /^[0-9]+$/;

/** Đại lý làm việc chậm, nhưng 8 tiếng một lần là đủ rát. Thực tế rơi vào ~08:00 và ~16:00 giờ VN. */
const REMIND_INTERVAL_MS = 8 * 3_600_000;
/** Nghiệp vụ chạy 1-2 ngày → 2 ngày là biên. Quá đó đại lý sẽ không trả lời nữa. */
const TTL_MS = 2 * 24 * 3_600_000;

/** HOA hết + bỏ ký tự không phải chữ/số. Chuỗi rỗng sau chuẩn hoá → undefined. */
function normalizeCode(raw: string): string | undefined {
  const normalized = raw.toUpperCase().replace(NON_ALNUM, "");
  return normalized === "" ? undefined : normalized;
}

/** Mã hoàn loại `*DH` — loại DUY NHẤT phải hỏi đại lý. Nhận mã ĐÃ chuẩn hoá. */
export function needsOriginOrder(normalizedCode: string): boolean {
  return normalizedCode.endsWith(RETURN_SUFFIX);
}

/**
 * Bỏ đuôi `DH` để lấy phần thân mã — thứ hệ vận hành tra được ra đại lý chủ đơn. Mã `*DH` nguyên
 * văn KHÔNG có trong hệ vận hành nên tra thẳng luôn ra rỗng. Mã không có đuôi thì giữ nguyên.
 */
export function baseCodeOf(normalizedCode: string): string {
  return needsOriginOrder(normalizedCode)
    ? normalizedCode.slice(0, -RETURN_SUFFIX.length)
    : normalizedCode;
}

export interface AskOriginOrderDeps {
  /** Tra đại lý chủ đơn từ mã vận đơn (không cần biết trước đại lý nào). */
  readonly owners: OrderOwnerPort;
  /** Đại lý → nhóm chat của họ (chiều ngược group_map). */
  readonly rooms: CustomerRoomLookup;
}

export function buildAskOriginOrderWorkflow(deps: AskOriginOrderDeps): WorkflowDef {
  return {
    name: ASK_ORIGIN_ORDER,
    subjectLabel: "mã đơn hoàn",
    answerLabel: "mã đơn gốc",
    targetLabel: "đại lý",
    ttlMs: TTL_MS,
    remindIntervalMs: REMIND_INTERVAL_MS,
    officeHoursOnly: true,

    /** Chỉ mã `*DH` mới là khoá hợp lệ: mã hoàn thường tra thẳng được, không phiền đại lý. */
    normalizeSubject(raw: string): string | undefined {
      const code = normalizeCode(raw);
      if (code === undefined || !needsOriginOrder(code)) return undefined;
      // Chỉ mỗi chữ "DH" thì không còn thân mã nào để tra đại lý.
      if (baseCodeOf(code) === "") return undefined;
      return code;
    },

    /**
     * Đáp án phải là một MÃ VẬN ĐƠN thật sự — không phải câu nói, không phải SĐT khách. Ba kiểu
     * sai bị chặn:
     *  - chuỗi quá ngắn ("ok", "đơn chị" mà model tưởng là mã);
     *  - mã đuôi DH (mã HOÀN, không phải đơn gốc);
     *  - toàn số (SĐT khách — phải tra ra mã vận đơn trước, xem answerHelp).
     *
     * KHÔNG chặn đáp án trùng thân mã hoàn (bỏ đuôi DH). Từng chặn (vụ PKE1487782361DH: model tự
     * cắt đuôi rồi báo "đại lý xác nhận" khi chưa ai xác nhận) nhưng vụ PKE1505725134DH cho thấy
     * thân mã NHIỀU KHI chính là đơn gốc — đại lý xác nhận, SĐT khách tra ra đúng mã đó — và chặn
     * ở tầng data khiến việc treo không bao giờ đóng được. Tầng data không biết đại lý đã xác nhận
     * hay chưa; chống model tự suy là việc của askText.
     */
    normalizeAnswer(raw: string): string | undefined {
      const code = normalizeCode(raw);
      if (code === undefined || code.length < MIN_CODE_LENGTH) return undefined;
      if (needsOriginOrder(code)) return undefined;
      if (DIGITS_ONLY.test(code)) return undefined;
      return code;
    },

    answerHelp: [
      "Đáp án hợp lệ là MÃ VẬN ĐƠN GỐC do đại lý xác nhận (có tiền tố chữ, ví dụ PKE..., VTP...).",
      "KHÔNG hợp lệ: mã hoàn (đuôi DH), SĐT hay tên khách.",
      "Nếu đại lý chỉ cho tên/SĐT khách: gọi tra_don_hang với tim_kiem = tên/SĐT đó để tìm mã vận " +
        "đơn gốc, xác nhận lại với đại lý đúng đơn, rồi mới gọi tra_loi_viec với mã tìm được.",
    ].join(" "),

    async resolveTarget(subject: string, signal?: AbortSignal): Promise<TargetResolution> {
      let owner;
      try {
        // Tra bằng phần thân mã: bản thân mã `*DH` không tồn tại trong hệ vận hành.
        owner = await deps.owners.ownerOf(baseCodeOf(subject), signal);
      } catch (err) {
        // Hỏng khi GỌI ≠ không có dữ liệu: cái đầu thử lại được, cái sau thì không.
        return { kind: "failed", reason: err instanceof Error ? err.message : String(err) };
      }
      if (owner === null) return { kind: "unknown_subject" };

      const room = await deps.rooms.roomOf(owner.dealerId);
      if (room === undefined) {
        return {
          kind: "no_room",
          detail: `đại lý ${owner.dealerName ?? owner.dealerCode ?? owner.dealerId} chưa có nhóm chat nào được nối`,
        };
      }
      // Giữ lại định danh đại lý: lúc báo kết quả (2 ngày sau) không phải gọi lại hệ vận hành.
      return {
        kind: "room",
        room,
        state: { dealerId: owner.dealerId, dealerName: owner.dealerName ?? null },
      };
    },

    /**
     * CHỈ THỊ NỘI BỘ cho agent đại lý — KHÔNG phải câu gửi thẳng cho đại lý. Agent đọc rồi tự soạn
     * câu hỏi bằng giọng của nó.
     *
     * Mã bọc trong nháy + câu cấm sửa mã: agent viết lại CÂU thì được, viết lại MÃ thì đại lý trả
     * lời về một mã không khớp việc treo nào và câu trả lời rơi vào khoảng không.
     */
    askText(request: PendingRequest, isReminder: boolean): string {
      const code = request.subject ?? "";
      const lead = isReminder
        ? `Đại lý vẫn chưa trả lời về mã đơn hoàn "${code}" — hỏi lại một lần nữa, nhẹ nhàng.`
        : `Kho vừa nhận một đơn đổi hàng hoàn về với mã "${code}" nhưng không biết nó là đơn nào.`;
      return [
        "[Việc nội bộ — không đọc nguyên văn đoạn này cho đại lý]",
        lead,
        `Hỏi đại lý trong nhóm này: mã hoàn "${code}" ứng với ĐƠN GỐC nào (mã vận đơn gốc, ` +
          `hoặc tên/số điện thoại khách nhận để tra ra đơn).`,
        `Nhắc lại mã hoàn NGUYÊN VĂN "${code}" trong câu hỏi — không rút gọn, không bỏ đuôi.`,
        `Được phép hỏi gợi ý: "có phải đơn gốc là ${baseCodeOf(code)} không?" — nhiều khi đơn gốc ` +
          `chính là thân mã. Đại lý xác nhận đúng thì ghi mã đó; đại lý nói khác thì ghi mã đại lý đọc.`,
        `Khi đại lý cho mã đơn gốc, gọi tool tra_loi_viec với ma_viec = "${ASK_ORIGIN_ORDER}", ` +
          `khoa = "${code}", tra_loi = mã đơn gốc đại lý vừa đọc.`,
        `Nếu đại lý chỉ cho TÊN hoặc SĐT khách: gọi tra_don_hang với tim_kiem = tên/SĐT đó để tìm ` +
          `mã vận đơn gốc, đọc lại cho đại lý xác nhận đúng đơn, rồi mới gọi tra_loi_viec với mã đó.`,
        `TUYỆT ĐỐI không tự cắt đuôi DH rồi ghi luôn khi đại lý chưa xác nhận, và không truyền ` +
          `SĐT/tên khách vào tra_loi_viec. Chưa có đại lý xác nhận thì chưa trả lời.`,
        `Lượt này là hệ thống hỏi, chưa ai trả lời — KHÔNG gọi tra_loi_viec trong lượt này. ` +
          `Đại lý hoặc nhân viên trong nhóm trả lời thì ai cũng được, ghi ở lượt đó.`,
      ].join("\n");
    },

    /** Tin báo về nhóm kho. Chỉ dữ kiện — mã nào ứng mã nào. */
    resultText(request: PendingRequest): string {
      return [
        `✅ Đơn hoàn ${request.subject ?? "(không rõ mã)"}`,
        `Đại lý xác nhận đơn gốc: ${request.answer ?? "(chưa có)"}`,
      ].join("\n");
    },
  };
}
