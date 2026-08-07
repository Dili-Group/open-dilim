// types.ts — hợp đồng dữ liệu đơn hàng đọc từ API vận hành `/agent/*`. File LÁ: KHÔNG import
// config.ts (fail-fast env) nên tool/test import thoải mái; impl HTTP mới chạm agent-api.ts.
//
// OrderPort là PORT: tool tra đơn phụ thuộc interface này, không phụ thuộc HTTP.
//
// PHẠM VI ĐẠI LÝ do SERVER ép: mọi lời gọi mang `dealerId` lên header `x-dealer-id`, backend tự
// resolve và lọc theo đại lý đó. Đơn của đại lý khác trả 404 → port map về null/[] (xem order-api.ts).
//
// TIỀN LÀ CHUỖI (NUMERIC(15,2) từ Postgres). KHÔNG parseFloat để cộng trừ — sai số nhị phân trên
// tiền là sai số khách phải chuyển khoản. Chỉ hiển thị (formatMoney ở tools/impl/order/scope.ts).

/** Ai đang tra: đại lý (bắt buộc) + nhân viên gõ (tuỳ chọn, chỉ để backend audit). */
export interface OrderPrincipal {
  /** `dealers.id` dạng chuỗi (bigint), KHÔNG phải uuid. Server cấp, không do LLM sinh. */
  readonly dealerId: string;
  /** `accounts.id` dạng chuỗi. undefined = không biết ai gõ (đại lý tự hỏi). */
  readonly staffId?: string;
}

/** Một dòng hàng trong đơn. `unitPrice`/`lineTotal` là chuỗi tiền. */
export interface OrderItem {
  readonly name: string;
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: string;
  readonly lineTotal: string;
}

/**
 * Đơn ở mức danh sách. `status`/`carrier` là MÃ SỐ của hệ vận hành — nhãn tra ở ORDER_STATUS_LABEL/
 * CARRIER_LABEL, mã lạ vẫn giữ nguyên số (backend thêm trạng thái mới không được làm tool vỡ).
 */
export interface OrderSummary {
  readonly trackingNumber: string;
  /** undefined = backend không trả (hoặc trả kiểu lạ) — render "chưa rõ", KHÔNG đoán một trạng thái. */
  readonly status?: number;
  readonly carrier?: number;
  readonly totalAmount?: string;
  readonly codAmount?: string;
  readonly shippingFee?: string;
  readonly customerName?: string;
  readonly customerPhone?: string;
  readonly isNewCustomer?: boolean;
  /** ISO 8601 từ backend. Giữ nguyên chuỗi, format lúc render. */
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly items?: readonly OrderItem[];
}

/** Một lần chuyển trạng thái. `fromState`/`toState` = mã OrderStatus; thiếu/không phải số → undefined. */
export interface OrderTransition {
  readonly event?: string;
  readonly fromState?: number;
  readonly toState?: number;
  readonly actorName?: string;
  readonly reason?: string;
  readonly createdAt?: string;
}

/** Chi tiết đơn = summary + địa chỉ, tiền chi tiết, lịch sử trạng thái. */
export interface OrderDetail extends OrderSummary {
  readonly source?: string;
  readonly shippingAddress?: string;
  readonly province?: string;
  readonly district?: string;
  readonly ward?: string;
  readonly subtotal?: string;
  readonly discount?: string;
  readonly notes?: string;
  readonly staffName?: string;
  readonly transitions: readonly OrderTransition[];
}

/** Trang kết quả tìm đơn. `total` = tổng đơn khớp, không phải số phần tử trả về. */
export interface OrderSearchPage {
  readonly orders: readonly OrderSummary[];
  readonly total: number;
}

/**
 * Link xem video camera của một lần quét. HẠN 15 PHÚT do backend cấp — tool phải gọi mới ngay lúc
 * gửi, KHÔNG cache, không phát lại link cũ trong lịch sử chat.
 */
export interface OrderCameraLink {
  readonly sessionCode?: string;
  readonly scannedAt?: string;
  readonly cameraCount?: number;
  readonly url: string;
  readonly expiresAt?: string;
}

/**
 * Một dòng hàng trong bảng giá đại lý. Endpoint thanh toán CHỈ trả id dòng — KHÔNG có tên hàng/SKU,
 * đừng cố in tên sản phẩm từ đây. Quà tặng và hàng ngoài danh mục không có giá bậc nên không xuất
 * hiện trong danh sách này; `baseAmount` vẫn là tổng đúng.
 */
export interface OrderPaymentItem {
  readonly orderItemId: string;
  readonly unitPrice?: string;
  readonly lineTotal?: string;
}

/** Tài khoản nhận tiền. Field thiếu → undefined: thà bỏ dòng còn hơn in một số tài khoản đoán. */
export interface OrderPaymentBank {
  readonly bankCode?: string;
  readonly bankName?: string;
  readonly accountNumber?: string;
  readonly accountName?: string;
}

/**
 * Số tiền ĐẠI LÝ chuyển cho CÔNG TY để đơn được đi: giá đại lý theo bậc chiết khấu + phí hộp giấy.
 * KHÔNG phải COD khách trả — trả nhầm con số này cho câu "khách phải trả bao nhiêu" là sai tiền.
 */
export interface OrderPayment {
  readonly trackingNumber: string;
  /** SỐ CẦN CHUYỂN = baseAmount + packagingFee, do BACKEND cộng. Tool chỉ in lại, không tự cộng. */
  readonly amount: string;
  readonly baseAmount?: string;
  readonly packagingFee?: string;
  readonly dealerCode?: string;
  readonly dealerName?: string;
  readonly carrier?: number;
  readonly items: readonly OrderPaymentItem[];
  readonly bank?: OrderPaymentBank;
  /**
   * Nội dung chuyển khoản NẠP VÍ theo mã đại lý (giống nhau cho mọi đơn của đại lý đó — tiền vào ví
   * rồi hệ thống tự trừ). In NGUYÊN VĂN: sai nội dung là tiền không vào ví.
   */
  readonly transferContent?: string;
  readonly qrUrl?: string;
}

/**
 * Cổng ĐỌC đơn hàng. CHỈ ĐỌC: huỷ/sửa đơn là WRITE, đi qua nhân viên vận hành cho tới khi có
 * approval gate (§6).
 */
export interface OrderPort {
  /** Tìm đơn theo mã vận đơn / tên khách / SĐT khách. Backend chỉ quét 30 ngày gần nhất. */
  search(
    p: OrderPrincipal & {
      readonly search?: string;
      readonly status?: number;
      readonly pageSize?: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<OrderSearchPage>;
  /** null = không có đơn mã đó THUỘC đại lý này (kể cả khi mã tồn tại ở đại lý khác, hoặc quá 30 ngày). */
  detail(
    p: OrderPrincipal & { readonly trackingNumber: string; readonly signal?: AbortSignal },
  ): Promise<OrderDetail | null>;
  /**
   * Số tiền đại lý phải chuyển để đơn được đi. null = không có đơn đó của đại lý này.
   * CHỈ ĐỌC: không có đường xác nhận đã thanh toán.
   */
  payment(
    p: OrderPrincipal & { readonly trackingNumber: string; readonly signal?: AbortSignal },
  ): Promise<OrderPayment | null>;
  /** [] = đơn chưa có lần quét nào gắn camera (chưa đóng gói / không quay), hoặc không phải đơn của đại lý này. */
  cameraLinks(
    p: OrderPrincipal & { readonly trackingNumber: string; readonly signal?: AbortSignal },
  ): Promise<readonly OrderCameraLink[]>;
}

/**
 * Mã trạng thái đơn → nhãn tiếng Việt. Model đọc nhãn, không đọc mã số.
 * Nguồn: enum OrderStatus của hệ vận hành. Mã không có ở đây → in "mã N" (không bịa nhãn).
 */
export const ORDER_STATUS_LABEL: Readonly<Record<number, string>> = {
  [-1]: "bản nháp",
  0: "đơn hàng mới",
  1: "đã quét xuất kho, chờ bàn giao ĐVVC",
  2: "chờ đại lý chuyển tiền",
  3: "đại lý đã chuyển tiền",
  4: "đã bàn giao ĐVVC",
  5: "đang vận chuyển",
  6: "giao thành công",
  7: "giao một phần",
  8: "đang hoàn một phần",
  9: "đã hoàn một phần (chờ kiểm tra)",
  10: "đã kiểm tra hàng hoàn",
  11: "đang hoàn hàng",
  12: "hoàn thành công tại ĐVVC",
  13: "hoàn thành công tại kho",
  14: "đã huỷ",
  15: "đã tạo lại",
  16: "đã kiểm duyệt",
  17: "đang soạn hàng",
  18: "đã soạn xong",
  99: "khác",
};

/** Mã đơn vị vận chuyển → tên. Mã lạ → in "mã N". */
export const CARRIER_LABEL: Readonly<Record<number, string>> = {
  0: "GHTK",
  1: "Viettel Post",
  2: "J&T Express",
  3: "Grab Express",
  4: "nhận tại kho (đại lý lên lấy)",
  99: "khác",
};
