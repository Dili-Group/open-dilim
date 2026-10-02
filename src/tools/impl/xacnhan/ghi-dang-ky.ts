// ghi-dang-ky.ts — `ghi_dang_ky` GHI: một dòng sổ khi sale đăng ký khách cần BS Sơn xác nhận.
//
// Tool là HÀNG RÀO, không phải prompt: đủ trường, 5 số cuối đúng, lý do không chung chung
// (quy trình §6), và case "uống chưa hiệu quả" phải đủ 5 trường (§7). Prompt nói lệch thì tool
// vẫn chặn.
//
// `zalo_thread_id` KHÔNG nằm trong schema — lấy từ `ctx.room` (server-side). Cho model tự khai là
// mở đường ghi yêu cầu sang nhóm khác.
//
// Mã đại lý cạnh STT (NVH, VDD, TQT…) phải KHỚP hệ vận hành trước khi ghi: sai mã thì dòng sổ
// không nối được với đại lý nào, leader đối soát hụt. Đối chiếu ở TOOL, sau mọi kiểm tra tại chỗ
// (rẻ trước, gọi mạng sau), và ghi đúng mã HỆ THỐNG lưu chứ không phải chữ sale gõ.
//
// Sale ghi khách "đang dùng / đã dùng" (kể cả chung tin với "đã tư vấn" món khác) → kiểm khách CÓ ĐƠN THẬT ở đại lý đó
// không (5 số cuối + dealer_id). Không thấy đơn = rất có thể gửi nhầm khách / nhầm đại lý → CHƯA
// ghi, hỏi lại sale. Sale được hỏi rồi vẫn khẳng định → ghi, đánh dấu "chưa thấy đơn" trong note.
//
// Ngoài khung giờ thì VẪN GHI, chỉ đánh dấu xếp sau (quy trình §5: "xác nhận sau các trường hợp
// đăng ký đúng"). Từ chối thẳng là làm mất dòng sổ — sale gõ xong tưởng đã đăng ký.

import type {
  DealerRef,
  FollowUpDetail,
  InUseEvidence,
  NewRegistration,
  OrderConfirmPort,
  PurchaseCheck,
  Registration,
} from "../../../operational/types.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import { cleanText, isVagueReason, MAX_LEN, normalizePhoneDigits, normalizeStt } from "./chuan-hoa.ts";
import { BAD_DAY, NO_PORT, NO_ROOM, lookupFailure, readDay, sundayNote, writeFailure } from "./chung.ts";
import { isOnTime, normalizeSlot, SLOT_LABEL } from "./khung-gio.ts";

export function buildRegisterConfirmTool(ctx: ToolContext): Tool {
  return {
    name: "ghi_dang_ky",
    description:
      "GHI một dòng vào sổ xác nhận khi sale đăng ký khách cần bác sĩ xác nhận. Gọi NGAY khi đọc " +
      "được tin đăng ký (thường mở đầu bằng STT, có người gõ lệch mẫu) — bóc từng trường từ tin đó, KHÔNG hỏi lại những gì " +
      "sale đã ghi. Thiếu trường hoặc lý do chung chung thì tool báo lại, lúc đó mới hỏi sale. " +
      "Khách đã dùng sản phẩm DiLiM mà chưa thấy hiệu quả thì bật chua_hieu_qua và điền đủ 5 " +
      "trường kèm theo.",
    inputSchema: {
      type: "object",
      properties: {
        ten_khach: { type: "string", description: "Tên khách như sale ghi, vd 'chị Trang'." },
        so_cuoi: {
          type: "string",
          description: "5 số cuối SĐT khách. Sale hay ghi dính vào tên — chép cụm số đó vào đây.",
        },
        tinh_trang: {
          type: "string",
          description: "Tình trạng khách sale mô tả (bệnh, triệu chứng, đã dùng gì).",
        },
        san_pham: {
          type: "string",
          description:
            "Sản phẩm / liệu trình sale tư vấn hoặc chốt LẦN NÀY, vd 'men, nghệ', '2TCC'. Mục 3 chỉ " +
            "ghi 'Đang dùng: X' (không tư vấn món mới) thì điền X.",
        },
        da_chot: {
          type: "boolean",
          description: "true = sale đã chốt đơn; false = mới tư vấn, chưa chốt.",
        },
        dang_dung: {
          type: "string",
          description:
            "Sản phẩm DiLiM khách ĐANG / ĐÃ uống (đã mua từ trước), nếu tin có nhắc — kể cả khi " +
            "nằm chung với 'Đã tư vấn': 'Đã tư vấn: men + nghệ. cô đang uống Rich + DHA' → " +
            "san_pham='men + nghệ', dang_dung='Rich + DHA'. 'Đang dùng: natto và sụn' → cả hai = " +
            "'natto và sụn'. Thuốc tây / hàng ngoài KHÔNG điền. Có giá trị thì tool kiểm khách " +
            "có đơn thật ở đại lý đó không.",
        },
        sale_khang_dinh_da_mua: {
          type: "boolean",
          description:
            "CHỈ bật khi tool đã báo không thấy đơn, mình đã hỏi lại, và sale trả lời khẳng định " +
            "khách đúng là đã mua. KHÔNG tự bật ở lượt đầu.",
        },
        ly_do: {
          type: "string",
          description:
            "Khách cần bác sĩ giải đáp điều gì, vd 'sợ hàng giả', 'đang dùng thuốc huyết áp'. " +
            "KHÔNG được ghi chung chung kiểu 'tư vấn thêm' — tool sẽ từ chối.",
        },
        khung_gio: {
          type: "string",
          description: "Khung sale xin: '11-12h' hoặc '16-17h' (chép nguyên, tool tự quy về khung).",
        },
        ngay: {
          type: "string",
          description: "Ngày xác nhận dạng 2026-09-18. Bỏ trống = hôm nay.",
        },
        stt: { type: "number", description: "Số thứ tự sale tự đánh trong tin (STT: 8 → 8)." },
        ma_dai_ly: {
          type: "string",
          description:
            "Mã đại lý ngay sau số STT, vd 'STT 05 VĐĐ' → 'VĐĐ', 'Stt 05 nvh(đã kí rule)' → 'nvh'. " +
            "CHÉP NGUYÊN VĂN như sale gõ — KHÔNG tự sửa dấu, không đoán mã đúng: tool tự đối chiếu " +
            "với hệ thống và báo lại nếu sai.",
        },
        ten_sale: {
          type: "string",
          description:
            "Tên hiển thị của sale đăng ký, để leader đọc bảng. Chỉ là nhãn — dòng sổ vẫn gắn " +
            "vào đúng người đang gõ, không gắn theo tên này.",
        },
        chua_hieu_qua: {
          type: "boolean",
          description:
            "true khi khách ĐÃ DÙNG sản phẩm DiLiM mà chưa thấy hiệu quả. Khách kể bệnh sử trước " +
            "khi dùng ('uống thuốc tây nhiều năm không đỡ') KHÔNG phải case này.",
        },
        tinh_trang_truoc: { type: "string", description: "Chỉ khi chua_hieu_qua: trước khi dùng." },
        tinh_trang_hien_tai: { type: "string", description: "Chỉ khi chua_hieu_qua: hiện tại." },
        lieu_trinh_da_dung: { type: "string", description: "Chỉ khi chua_hieu_qua: đã dùng gì." },
        thoi_gian_su_dung: { type: "string", description: "Chỉ khi chua_hieu_qua: dùng bao lâu." },
        so_lan_cham_soc: { type: "string", description: "Chỉ khi chua_hieu_qua: đã chăm sóc mấy lần." },
      },
      required: ["ma_dai_ly", "ten_khach", "so_cuoi", "tinh_trang", "san_pham", "ly_do", "khung_gio"],
    },
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> => run(ctx, input, signal),
  };
}

async function run(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  if (ctx.room === undefined) return NO_ROOM;
  const port = ctx.orderConfirm;
  if (port === undefined) return NO_PORT;

  const raw = input as Record<string, unknown>;

  const day = readDay(raw.ngay);
  if (day === undefined) return BAD_DAY;

  const fields = readFields(raw);
  if ("missing" in fields) {
    return {
      content:
        `Chưa ghi được, tin đăng ký còn thiếu: ${fields.missing.join(", ")}. Nhắn lại đúng những ` +
        "mục thiếu này cho sale, ngắn gọn một dòng. KHÔNG hỏi lại các mục sale đã ghi đủ.",
      isError: true,
    };
  }

  if (isVagueReason(fields.reason)) {
    return {
      content:
        "Lý do đang chung chung nên chưa ghi được (quy trình cấm ghi kiểu 'tư vấn thêm', 'hỏi " +
        "thêm'). Nhờ sale ghi rõ khách vướng gì: sợ hàng giả, đang dùng thuốc, có bệnh nền, chưa " +
        "tin liệu trình… Nói đúng một câu, không giải thích dài.",
      isError: true,
    };
  }

  const followUp = readFollowUp(raw);
  if (followUp === "thieu") {
    return {
      content:
        "Khách đã dùng mà chưa hiệu quả thì phải đủ 5 mục: tình trạng trước, tình trạng hiện tại, " +
        "liệu trình đã dùng, thời gian sử dụng, số lần đã chăm sóc. Xin sale bổ sung những mục " +
        "còn thiếu rồi ghi lại.",
      isError: true,
    };
  }

  const dealer = await verifyDealer(port, raw.ma_dai_ly, signal);
  if ("reply" in dealer) return dealer.reply;

  // "Chưa hiệu quả" cũng là khách đã dùng hàng → cùng phải có đơn thật, món lấy từ liệu trình đã dùng.
  const usedProducts =
    cleanText(raw.dang_dung, MAX_LEN.product) ??
    (followUp === undefined ? undefined : followUp.courseUsed);
  let inUse: InUseEvidence | undefined;
  if (usedProducts !== undefined) {
    const checked = await verifyPurchase(port, {
      products: usedProducts,
      dealer,
      phone: fields.phone,
      saleInsists: raw.sale_khang_dinh_da_mua === true,
      signal,
    });
    if ("reply" in checked) return checked.reply;
    inUse = checked;
  }

  const stt = normalizeStt(raw.stt);
  const saleName = cleanText(raw.ten_sale, MAX_LEN.name);

  const registration: NewRegistration = {
    ...fields,
    day,
    onTime: isOnTime({ slot: fields.slot, day }),
    // Thread lấy từ phòng ĐANG GÕ (server-side), không phải tham số model: kết quả duyệt nhắn về
    // đúng nhóm này.
    threadId: ctx.room.groupId,
    closed: raw.da_chot === true,
    dealerCode: dealer.code,
    dealerId: dealer.id,
    ...(stt === undefined ? {} : { stt }),
    ...(saleName === undefined ? {} : { saleName }),
    ...(followUp === undefined ? {} : { followUp }),
    ...(inUse === undefined ? {} : { inUse }),
  };

  let row: Registration;
  try {
    row = await port.register(registration, signal);
  } catch (err) {
    return writeFailure(err, "ghi_dang_ky");
  }

  const who = `${row.customerName ?? registration.customerName} (${row.phoneLast5}), đại lý ${row.dealerCode ?? dealer.code}`;
  // Backend đã có yêu cầu ĐANG CHỜ cho khách này → trả yêu cầu cũ, KHÔNG cập nhật theo tin mới.
  if (!row.created) {
    return {
      content:
        `Ca ${who} ĐÃ CÓ yêu cầu xác nhận đang chờ bác sĩ duyệt từ trước — hệ thống KHÔNG tạo thêm ` +
        "và KHÔNG cập nhật nội dung theo tin vừa gửi. Báo sale đúng một dòng: ca này đã đăng ký " +
        "rồi, đang chờ duyệt; nếu cần sửa nội dung thì nhờ leader sửa trên hệ thống.",
    };
  }
  const late = registration.onTime
    ? ""
    : " Đăng ký ngoài khung nên xếp sau các ca đúng giờ — báo sale biết, đừng hứa gọi sớm.";
  return {
    content:
      `Đã ghi yêu cầu xác nhận: ${who}, khung ${SLOT_LABEL[registration.slot]} ngày ` +
      `${registration.day}, đang chờ bác sĩ duyệt.${late}${sundayNote(registration.day)} ` +
      "Trả lời sale đúng một dòng: đã ghi, đang chờ bác sĩ duyệt. KHÔNG báo số thứ tự (hệ thống " +
      "không cấp), KHÔNG hứa mốc giờ bác sĩ gọi.",
  };
}

/**
 * Đối chiếu mã đại lý với hệ vận hành. Trả đại lý đã tra được, hoặc `reply` = câu tool trả về
 * ngay (không ghi gì). Ba nhánh không ghi phải nói khác nhau: THIẾU mã, mã KHÔNG CÓ trong hệ
 * thống (sale sửa được), và KHÔNG TRA ĐƯỢC (hệ thống hỏng — sale không có gì để sửa).
 */
async function verifyDealer(
  port: OrderConfirmPort,
  raw: unknown,
  signal: AbortSignal | undefined,
): Promise<DealerRef | { readonly reply: ToolResult }> {
  const code = cleanText(raw, MAX_LEN.dealerCode);
  if (code === undefined) {
    return {
      reply: {
        content:
          "Chưa ghi: tin thiếu MÃ ĐẠI LÝ cạnh STT (vd 'STT 04 VDD'). Nhờ gửi lại kèm mã đại " +
          "lý, đúng một dòng.",
        isError: true,
      },
    };
  }
  let dealer: DealerRef | null;
  try {
    dealer = await port.findDealer(code, signal);
  } catch (err) {
    return { reply: lookupFailure(err, "đối chiếu mã đại lý") };
  }
  if (dealer === null) {
    return {
      reply: {
        content:
          `Chưa ghi: mã đại lý "${code}" KHÔNG có trong hệ thống (hoặc đại lý đã ngưng). Báo sale ` +
          "đúng một dòng: kiểm tra lại mã đại lý rồi gửi lại tin đăng ký với mã đúng. KHÔNG suy đoán " +
          "đoán mã đúng, KHÔNG gợi ý mã gần giống, KHÔNG ghi tạm.",
        isError: true,
      },
    };
  }
  return dealer;
}

/**
 * Kiểm câu "khách đang dùng / đã dùng": có đơn ở đại lý này không. Trả bằng chứng để ghi vào note,
 * hoặc `reply` = câu tool trả ngay (KHÔNG ghi). Không thấy đơn mà sale chưa khẳng định lại → hỏi.
 */
async function verifyPurchase(
  port: OrderConfirmPort,
  input: {
    readonly products: string;
    readonly dealer: DealerRef;
    readonly phone: string;
    readonly saleInsists: boolean;
    readonly signal: AbortSignal | undefined;
  },
): Promise<InUseEvidence | { readonly reply: ToolResult }> {
  let check: PurchaseCheck;
  try {
    check = await port.purchaseCheck({ dealerId: input.dealer.id, phone: input.phone }, input.signal);
  } catch (err) {
    return { reply: lookupFailure(err, "kiểm đơn của khách") };
  }
  if (check.purchased) {
    return {
      products: input.products,
      verified: true,
      orderCount: check.orderCount,
      ...(check.lastOrderAt === undefined ? {} : { lastOrderAt: check.lastOrderAt }),
    };
  }
  if (input.saleInsists) return { products: input.products, verified: false };
  const last5 = input.phone.slice(-5);
  return {
    reply: {
      content:
        `Chưa ghi: sale ghi khách ĐANG DÙNG nhưng hệ thống KHÔNG thấy đơn nào của SĐT đuôi ${last5} ` +
        `ở đại lý ${input.dealer.code}. Có thể gửi nhầm số, nhầm mã đại lý, hoặc khách mới được tư ` +
        "vấn chứ chưa mua. Hỏi lại sale đúng một dòng cho chính xác (số đuôi và mã đại lý đúng " +
        "chưa, khách đã mua thật hay mới tư vấn). Sale sửa thì gọi lại với thông tin mới; sale " +
        "khẳng định vẫn đúng là đã mua thì gọi lại với sale_khang_dinh_da_mua = true.",
      isError: true,
    },
  };
}

/** Năm trường bắt buộc, đã chuẩn hoá. Thiếu cái nào thì trả danh sách tên tiếng Việt để hỏi lại. */
type RequiredFields = Pick<
  NewRegistration,
  "customerName" | "phone" | "condition" | "product" | "reason" | "slot"
>;

function readFields(
  raw: Record<string, unknown>,
): RequiredFields | { readonly missing: readonly string[] } {
  const customerName = cleanText(raw.ten_khach, MAX_LEN.name);
  const phone = normalizePhoneDigits(raw.so_cuoi);
  const condition = cleanText(raw.tinh_trang, MAX_LEN.condition);
  const product = cleanText(raw.san_pham, MAX_LEN.product);
  const reason = cleanText(raw.ly_do, MAX_LEN.reason);
  const slot = normalizeSlot(cleanText(raw.khung_gio, 40));

  const missing = [
    customerName === undefined ? "tên khách" : undefined,
    phone === undefined ? "5 số cuối SĐT" : undefined,
    condition === undefined ? "tình trạng khách" : undefined,
    product === undefined ? "sản phẩm / liệu trình" : undefined,
    reason === undefined ? "lý do cần bác sĩ xác nhận" : undefined,
    slot === undefined ? "khung giờ (11-12h hay 16-17h)" : undefined,
  ].filter((item): item is string => item !== undefined);
  if (missing.length > 0) return { missing };

  // Sau bộ lọc trên sáu giá trị chắc chắn có; narrow tường minh thay vì ép kiểu.
  if (
    customerName === undefined ||
    phone === undefined ||
    condition === undefined ||
    product === undefined ||
    reason === undefined ||
    slot === undefined
  ) {
    return { missing: ["thông tin đăng ký"] };
  }
  return { customerName, phone, condition, product, reason, slot };
}

/**
 * Năm trường của case "uống chưa hiệu quả" (§7). Trả:
 *   undefined = không phải case này (không bật cờ)
 *   "thieu"   = có bật cờ nhưng thiếu trường → tool bắt bổ sung
 *
 * KHÔNG tự đoán case này theo từ khoá trong tình trạng: tin thật đầy câu "uống thuốc tây nhiều
 * năm không đỡ" — đó là bệnh sử TRƯỚC khi dùng hàng, đoán theo chữ là bắt sale bổ sung oan.
 */
function readFollowUp(raw: Record<string, unknown>): FollowUpDetail | "thieu" | undefined {
  if (raw.chua_hieu_qua !== true) return undefined;
  const conditionBefore = cleanText(raw.tinh_trang_truoc, MAX_LEN.condition);
  const conditionNow = cleanText(raw.tinh_trang_hien_tai, MAX_LEN.condition);
  const courseUsed = cleanText(raw.lieu_trinh_da_dung, MAX_LEN.product);
  const duration = cleanText(raw.thoi_gian_su_dung, MAX_LEN.team);
  const careCount = cleanText(raw.so_lan_cham_soc, MAX_LEN.team);
  if (
    conditionBefore === undefined ||
    conditionNow === undefined ||
    courseUsed === undefined ||
    duration === undefined ||
    careCount === undefined
  ) {
    return "thieu";
  }
  return { conditionBefore, conditionNow, courseUsed, duration, careCount };
}
