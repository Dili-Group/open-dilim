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

/** Trạng thái phiếu thanh toán gộp. Mã lạ → in số, không bịa nhãn. */
export const PAYMENT_BATCH_STATUS_LABEL: Readonly<Record<number, string>> = {
  0: "chờ thanh toán",
  1: "đã thanh toán",
  2: "đã huỷ",
  3: "đã đối soát một phần",
};

/**
 * Phiếu thanh toán GỘP nhiều đơn (`POST /agent/payment-batches`). Khác khoản nạp ví của
 * `OrderPayment`: nội dung chuyển khoản ở đây là `DH` + mã phiếu, webhook SePay khớp theo đúng
 * chuỗi đó để mở khoá đơn — sai nội dung là tiền về nhưng đơn không đi.
 */
export interface PaymentBatch {
  /** Mã phiếu hệ thống sinh — bằng chứng phiếu đã tạo. */
  readonly code: string;
  /** Nội dung CK bắt buộc = `DH` + code. In NGUYÊN VĂN. */
  readonly transferContent: string;
  /** Tổng tiền phiếu, chuỗi NUMERIC(15,2) do backend cộng. Tool chỉ in lại. */
  readonly totalAmount: string;
  /** Đã trả bao nhiêu. Phiếu mới luôn "0.00". */
  readonly paidAmount?: string;
  /** QR SePay — preset SỐ CÒN THIẾU (total − paid), không phải tổng phiếu. */
  readonly qrUrl?: string;
  readonly uuid?: string;
  /** 0 OPEN · 1 PAID · 2 CANCELLED · 3 PARTIALLY_SETTLED. */
  readonly status?: number;
  /** `orders.id` bigint dạng chuỗi — id nội bộ, KHÔNG phải mã vận đơn. */
  readonly orderIds: readonly string[];
  readonly orderCount?: number;
  readonly createdAt?: string;
  readonly bank?: OrderPaymentBank;
}

/**
 * Hồ sơ đại lý đang hỏi (`GET /agent/profile`). Đại lý lấy từ header `x-dealer-id` đã resolve —
 * endpoint KHÔNG nhận param đại lý, nên agent không dò được hồ sơ đại lý khác.
 *
 * CHỈ LẤY TÊN BẬC, KHÔNG LẤY TỈ LỆ: `discount_tiers` là danh mục bậc, tỉ lệ thật nằm ở từng sản
 * phẩm (`product_price_tiers.actual_discount_rate`) nên không có một con số % cho cả bậc — endpoint
 * có trả biên min/max nhưng port cố tình bỏ. Bậc chưa xếp → mọi field `discountTier*` = undefined.
 */
export interface DealerProfile {
  readonly code?: string;
  readonly name?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly address?: string;
  readonly province?: string;
  readonly district?: string;
  readonly ward?: string;
  /** ISO date. Giữ nguyên chuỗi, format lúc render. */
  readonly joinedAt?: string;
  readonly referralLevel?: number;
  readonly isShareholder?: boolean;
  readonly usesBrand?: boolean;
  readonly referrerCode?: string;
  readonly referrerName?: string;
  readonly staffName?: string;
  readonly staffPhone?: string;
  readonly discountTierId?: string;
  readonly discountTierName?: string;
  readonly discountTierLabel?: string;
  readonly discountEffectiveFrom?: string;
}

/**
 * Cổng ĐỌC hồ sơ đại lý. CHỈ ĐỌC: đường GHI bậc chiết khấu nằm ở `DiscountPort` (tách hẳn), để
 * tool đọc hồ sơ không bao giờ cầm được đường ghi.
 */
export interface DealerPort {
  /** null = backend không có hồ sơ cho đại lý này (404). Lỗi khác bubble lên. */
  profile(
    p: OrderPrincipal & { readonly signal?: AbortSignal },
  ): Promise<DealerProfile | null>;
}

/**
 * Một bậc chiết khấu trong hệ thống. `sortOrder` là THỨ TỰ BẬC — bậc cao hơn = số lớn hơn; đây là
 * dữ kiện DUY NHẤT để phân biệt nâng với hạ. KHÔNG có phần trăm ở đây (tỉ lệ khác nhau theo sản
 * phẩm — xem skill `chiet-khau`), đừng dịch tên bậc thành một con số %.
 *
 * `isShareholder` = bậc này thuộc thang dành cho cổ đông. Hai thang song song, không so trực tiếp
 * `sortOrder` giữa hai thang được.
 */
export interface DiscountTier {
  /** `discount_tiers.id` (bigint dạng chuỗi) — cũng là `tier_id` gửi lên khi nâng. */
  readonly id: string;
  readonly tierName: string;
  /** Nhãn hiển thị. Backend trả `null` khi chưa đặt → undefined. */
  readonly displayLabel?: string;
  readonly isShareholder: boolean;
  readonly sortOrder: number;
}

/** Bậc cũ trong kết quả nâng. null ở backend (đại lý chưa từng xếp bậc) → undefined. */
export interface DiscountTierRef {
  readonly id: string;
  readonly tierName: string;
  readonly sortOrder: number;
}

/**
 * Kết quả một lần nâng bậc. `scheduleId` = bản ghi lịch áp dụng backend vừa tạo — bằng chứng lệnh
 * đã ghi, in ra cho người đối chiếu. `changedBy` = nhân viên backend ghi nhận (từ `x-staff-id`).
 */
export interface TierUpgradeResult {
  readonly scheduleId: string;
  readonly dealerCode?: string;
  readonly fromTier?: DiscountTierRef;
  readonly toTier: DiscountTier;
  readonly effectiveFrom?: string;
  readonly reason?: string;
  readonly changedBy?: string;
}

/**
 * Cổng BẬC CHIẾT KHẤU: đọc danh mục bậc + GHI lệnh nâng bậc cho đại lý của phòng.
 *
 * TÁCH khỏi DealerPort vì đây là port DUY NHẤT có đường ghi. Tool nào cầm nó là tool đổi được giá
 * hàng của đại lý — chỉ `nang_bac_chiet_khau` được khai, và chỉ khi người gõ là nhân viên.
 */
export interface DiscountPort {
  /** Danh mục bậc đang có. Mảng rỗng = backend không trả bậc nào (KHÔNG bịa bậc mặc định). */
  tiers(
    p: OrderPrincipal & { readonly signal?: AbortSignal },
  ): Promise<readonly DiscountTier[]>;
  /**
   * Nâng đại lý (theo `dealerId` ở header) lên `tierId`. KHÔNG retry ở tầng HTTP — lỗi bubble lên
   * để người quyết bắn lại, tránh ghi hai lần.
   */
  upgrade(
    p: OrderPrincipal & {
      readonly tierId: string;
      readonly reason: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<TierUpgradeResult>;
}

/**
 * Kết quả nạp tài khoản PosCake của đại lý. `shopId` là BẰNG CHỨNG backend đã ghi — thiếu nó thì
 * không biết đã nạp hay chưa, port báo lỗi shape chứ không dựng kết quả nửa vời (xem poscake-api.ts).
 */
export interface PoscakeShopLink {
  readonly shopId: string;
  readonly dealerCode?: string;
}

/**
 * Cổng NẠP tài khoản PosCake (Pancake POS) của đại lý vào hệ vận hành. Đường GHI, và thứ ghi vào
 * là BÍ MẬT của đại lý (API key PosCake = quyền ngang admin shop).
 *
 * TÁCH port riêng vì lý do đó: tool nào cầm cổng này là tool chạm được credential — chỉ
 * `nap_poscake` được khai. Key đi qua đây MỘT chiều: gửi lên backend rồi thôi, không đọc lại,
 * không log, không nằm trong kết quả trả về LLM.
 */
export interface PoscakePort {
  register(
    p: OrderPrincipal & {
      readonly shopId: string;
      readonly apiKey: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<PoscakeShopLink>;
}

/**
 * Chủ sở hữu một đơn (tra NGƯỢC từ mã vận đơn). Dùng cho đơn hoàn `*DH` ở nhóm kho: lúc đó chưa
 * biết đại lý nào để mà ép phạm vi, chính việc cần làm là tra ra đại lý.
 */
export interface OrderOwner {
  /** `dealers.id` dạng chuỗi — khớp với `OrderPrincipal.dealerId` và `group_map.customer_id`. */
  readonly dealerId: string;
  readonly dealerCode?: string;
  readonly dealerName?: string;
}

/**
 * Cổng tra chủ sở hữu đơn theo mã vận đơn. TÁCH khỏi OrderPort vì đây là endpoint DUY NHẤT không
 * gắn `x-dealer-id` (xem AgentApiClient.getUnscoped) — để chung interface là mở đường cho tool
 * khác lỡ tay gọi nó rồi đọc dữ liệu đơn ngoài phạm vi phòng.
 *
 * CHỈ trả định danh đại lý, KHÔNG trả nội dung đơn. Muốn biết đơn có gì thì gọi OrderPort với
 * đúng đại lý đó.
 */
export interface OrderOwnerPort {
  /** null = hệ vận hành không có đơn nào mang mã này. Lỗi khác bubble lên. */
  ownerOf(trackingNumber: string, signal?: AbortSignal): Promise<OrderOwner | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sổ ngày của đại lý (`GET /agent/daily/*`) — bốn endpoint cùng một hình dạng envelope.
//
// MỐC NGÀY KHÔNG PHẢI NGÀY TẠO ĐƠN: xuất kho tính theo `shipped_out_at`, hoàn tính theo
// `returned_at`, cắt theo 00:00–24:00 giờ Việt Nam. Đơn tạo hôm qua mà xuất hôm nay thuộc HÔM NAY.
// ─────────────────────────────────────────────────────────────────────────────

/** Bốn mục của sổ ngày. Giá trị là khoá nghiệp vụ, KHÔNG phải path (path nằm ở daily-api.ts). */
export const DailySection = {
  /** Đơn xuất kho trong ngày. */
  Shipped: "xuat_kho",
  /** Đơn hoàn về trong ngày. */
  Returned: "hoan_ve",
  /** Tiền đại lý phải chuyển cho công ty. */
  Charges: "tien_phai_tra",
  /** Tiền công ty trả lại đại lý. */
  Refunds: "tien_hoan_lai",
} as const;
export type DailySection = (typeof DailySection)[keyof typeof DailySection];

/**
 * `meta_data` của một mục: TỔNG CẢ NGÀY, không phải tổng của trang đang xem. Tool phải in số từ
 * đây, KHÔNG cộng các dòng trong `lines`.
 *
 * Field thiếu/sai kiểu → undefined (tool nói thiếu mục đó), KHÔNG mặc định 0: "0 đơn" là câu trả
 * lời khác hẳn "chưa tra được".
 */
export interface DailyMeta {
  /** Ngày backend đã chuẩn hoá về ISO `YYYY-MM-DD`. */
  readonly date?: string;
  readonly dealerCode?: string;
  readonly page?: number;
  readonly pageSize?: number;
  /** Số đơn CẢ NGÀY khớp mục này. */
  readonly totalItems?: number;
  readonly totalPages?: number;
  /** Tổng số sản phẩm cả ngày (chỉ mục đơn xuất/hoàn). */
  readonly totalQuantity?: number;
  /** Tổng tiền cả ngày, chuỗi VND nguyên. */
  readonly totalAmount?: string;
  /** Riêng `charges`: phần tiền hàng và phí thùng carton tách khỏi `totalAmount`. */
  readonly goodsAmount?: string;
  readonly cartonFee?: string;
}

/** Một dòng hàng trong đơn của sổ ngày. `isGift` = hàng tặng, `lineAmount` khi đó là "0". */
export interface DailyOrderItem {
  readonly sku?: string;
  readonly productName?: string;
  readonly quantity?: number;
  readonly isGift?: boolean;
  readonly lineAmount?: string;
}

/** Một đơn trong mục xuất kho / hoàn về. `at` = mốc xuất kho hoặc mốc hoàn, tuỳ mục. */
export interface DailyOrderLine {
  readonly trackingNumber: string;
  readonly createdAt?: string;
  readonly at?: string;
  readonly quantity?: number;
  readonly goodsAmount?: string;
  readonly items: readonly DailyOrderItem[];
}

/** Một đơn trong mục tiền phải trả. `amount` = goodsAmount + cartonFee, do BACKEND cộng. */
export interface DailyChargeLine {
  readonly trackingNumber: string;
  readonly shippedAt?: string;
  readonly quantity?: number;
  readonly goodsAmount?: string;
  readonly cartonFee?: string;
  readonly amount?: string;
}

/** Một đơn trong mục tiền hoàn lại. Không có phí thùng ở chiều này. */
export interface DailyRefundLine {
  readonly trackingNumber: string;
  readonly returnedAt?: string;
  readonly quantity?: number;
  readonly amount?: string;
}

export type DailyLine = DailyOrderLine | DailyChargeLine | DailyRefundLine;

/** Một trang của một mục: tổng cả ngày (`meta`) + các dòng của TRANG đang xem (`lines`). */
export interface DailyPage<Line extends DailyLine> {
  readonly meta: DailyMeta;
  readonly lines: readonly Line[];
}

/** Tham số chung của mọi lời gọi sổ ngày. `date` do tool validate trước, không để LLM tự do. */
export type DailyQuery = OrderPrincipal & {
  /** `DD-MM-YYYY` hoặc `YYYY-MM-DD`. Backend nhận cả hai, trả về đã chuẩn hoá ISO. */
  readonly date: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly signal?: AbortSignal;
};

/**
 * Cổng ĐỌC sổ ngày của đại lý. CHỈ ĐỌC — không có đường xác nhận đã chuyển tiền.
 *
 * Số liệu bốn mục này KHỚP với file kỳ đối soát. Đại lý báo lệch → KHÔNG tự tính lại, hỏi mã vận
 * đơn cụ thể rồi tra qua `OrderPort.detail`.
 */
export interface DailyPort {
  /** Đơn xuất kho trong ngày (mốc `shipped_out_at`). */
  shippedOrders(q: DailyQuery): Promise<DailyPage<DailyOrderLine>>;
  /** Đơn hoàn về trong ngày (mốc `returned_at`). */
  returnedOrders(q: DailyQuery): Promise<DailyPage<DailyOrderLine>>;
  /** Tiền đại lý phải chuyển cho công ty: tiền hàng + phí thùng. KHÔNG phải COD khách trả. */
  charges(q: DailyQuery): Promise<DailyPage<DailyChargeLine>>;
  /** Tiền công ty trả lại đại lý cho hàng hoàn. Không có phí thùng. */
  refunds(q: DailyQuery): Promise<DailyPage<DailyRefundLine>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sổ ngày NỘI BỘ (`/agent/internal/*`) — TOÀN HỆ THỐNG, không gắn đại lý nào.
//
// Khác `DailyPort` ở đúng một điều quan trọng: KHÔNG có `x-dealer-id`, nên dữ liệu trả về là đơn
// của MỌI đại lý. Vì vậy principal chỉ có `staffId` và nó BẮT BUỘC — backend đòi header đó, và
// phía này cũng phải biết ai đang xem cả hệ thống.
// ─────────────────────────────────────────────────────────────────────────────

/** Một đơn trong sổ ngày nội bộ. Trường nào backend không trả → undefined, KHÔNG bịa. */
export interface InternalOrderLine {
  readonly trackingNumber: string;
  readonly dealerCode?: string;
  readonly dealerName?: string;
  /** Mốc xuất kho (`orders.shipped_out_at`). */
  readonly shippedAt?: string;
  /** Mã phiếu xuất kho NỘI BỘ — có ngay khi bàn giao, chưa chắc đã lên MISA. */
  readonly voucherCode?: string;
  /** ID chứng từ bên MISA. Có = đã tạo hoá đơn. */
  readonly misaVoucherId?: string;
  readonly misaSyncAt?: string;
  /** `misa_voucher_id IS NOT NULL` — chính là điều kiện lọc của hai endpoint kia. */
  readonly invoiced?: boolean;
}

/** Khối `meta_data` của sổ ngày nội bộ. `totalItems` là tổng CẢ NGÀY, không phải số dòng trang này. */
export interface InternalDailyMeta {
  /** Ngày đã chuẩn hoá `YYYY-MM-DD` (gửi `08-08-2026` cũng trả `2026-08-08`). */
  readonly date?: string;
  /** Bộ lọc đang áp: undefined = mọi đơn xuất kho, true = đã hoá đơn, false = chưa hoá đơn. */
  readonly invoiced?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
  readonly totalItems?: number;
  readonly totalPages?: number;
}

export interface InternalDailyPage {
  readonly meta: InternalDailyMeta;
  readonly lines: readonly InternalOrderLine[];
}

/** Tham số chung của mọi lời gọi sổ ngày nội bộ. `date` do tool validate trước, không để LLM tự do. */
export interface InternalDailyQuery {
  /** `accounts.id` dạng chuỗi số. BẮT BUỘC — thiếu là backend trả 400. */
  readonly staffId: string;
  /** `DD-MM-YYYY` hoặc `YYYY-MM-DD`. Backend nhận cả hai, trả về đã chuẩn hoá ISO. */
  readonly date: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly signal?: AbortSignal;
}

/** Một đơn bị TỪ CHỐI validate: đơn tồn tại nhưng trạng thái hiện tại không cho qua bước kho. */
export interface InternalValidateRejectedLine {
  readonly trackingNumber: string;
  /** Mã trạng thái đang mắc — cùng bảng mã với `orders.status` bên tra đơn. */
  readonly status?: number;
}

/** Một đơn bị LOẠI khỏi lô validate vì luật nghiệp vụ (vd `excluded_sku`), không phải vì trạng thái. */
export interface InternalValidateExcludedLine {
  readonly trackingNumber: string;
  readonly reason?: string;
}

/**
 * Kết quả một lô validate. Bốn nhóm ngoài `validated` KHÔNG chồng lấn nhau — mỗi mã gửi lên rơi
 * vào đúng một nhóm: mới validate / đã validate từ trước / từ chối / không tìm thấy / bị loại.
 */
export interface InternalValidateResult {
  /** Số đơn validate MỚI trong lần gọi này. undefined = backend không trả số, đừng bịa 0. */
  readonly validated?: number;
  /** Số đơn đã validate từ TRƯỚC — gửi lại không sao, backend bỏ qua. */
  readonly alreadyValidated?: number;
  readonly rejected: readonly InternalValidateRejectedLine[];
  readonly notFound: readonly string[];
  readonly excluded: readonly InternalValidateExcludedLine[];
}

/** Tham số một lô validate. Danh sách mã do tool chặn trần 1..200 TRƯỚC khi tới đây. */
export interface InternalValidateRequest {
  /** `accounts.id` dạng chuỗi số — audit NGƯỜI GHI, tuỳ chọn (backend không đòi header này). */
  readonly staffId?: string;
  readonly trackingNumbers: readonly string[];
  readonly signal?: AbortSignal;
}

/**
 * Cổng sổ xuất kho / hoá đơn MISA của TOÀN HỆ THỐNG. Ba hàm sổ ngày CHỈ ĐỌC; `validateOrders`
 * là đường GHI duy nhất — đẩy đơn qua bước kho, idempotent phía backend (đơn đã validate rơi
 * vào `already_validated`, không ghi đôi).
 *
 * Ba tập khớp nhau: `invoicedOrders` + `uninvoicedOrders` = `shippedOrders`, hai tập con bù nhau,
 * không chồng lấn. Mốc thời gian là `orders.shipped_out_at` giờ ICT — cùng cửa sổ với file đối
 * soát, nên số đơn khớp tuyệt đối.
 */
export interface InternalOrdersPort {
  /** Đơn xuất kho trong ngày, mỗi đơn kèm cờ `invoiced`. */
  shippedOrders(q: InternalDailyQuery): Promise<InternalDailyPage>;
  /** Đơn đã tạo hoá đơn MISA (`misa_voucher_id IS NOT NULL`). */
  invoicedOrders(q: InternalDailyQuery): Promise<InternalDailyPage>;
  /** Đơn CHƯA tạo hoá đơn — hàng đợi cần xử lý (gồm cả đơn chưa có phiếu xuất kho). */
  uninvoicedOrders(q: InternalDailyQuery): Promise<InternalDailyPage>;
  /** GHI: validate một lô đơn để đưa qua bước kho (`POST /agent/internal/orders/validate`). */
  validateOrders(r: InternalValidateRequest): Promise<InternalValidateResult>;
}

/**
 * Cổng ĐỌC đơn hàng. CHỈ ĐỌC: huỷ/sửa đơn là WRITE, đi qua nhân viên vận hành cho tới khi có
 * approval gate (§6).
 */
export interface OrderPort {
  /**
   * Tìm đơn theo mã vận đơn / tên khách / SĐT khách. Backend chỉ quét 30 ngày gần nhất.
   *
   * Lọc ngày theo NGÀY TẠO ĐƠN (`created_at`, giờ Việt Nam) — khác mốc của sổ ngày (`DailyPort`)
   * vốn tính theo ngày xuất kho / ngày hoàn. `today` do BACKEND chốt và ĐÈ `createdFrom`/`createdTo`.
   */
  search(
    p: OrderPrincipal & {
      readonly search?: string;
      readonly status?: number;
      /** true = đơn tạo trong hôm nay (giờ VN, backend tự chốt). Đè hai mốc dưới. */
      readonly today?: boolean;
      /** `YYYY-MM-DD` giờ VN. Đã validate ở tầng tool, port không tự sửa. */
      readonly createdFrom?: string;
      /** `YYYY-MM-DD` giờ VN, trọn ngày. */
      readonly createdTo?: string;
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
  /**
   * GHI: tạo phiếu thanh toán GỘP cho nhiều đơn chưa thanh toán, trả QR SePay. KHÔNG retry ở
   * tầng HTTP — bắn lại là hai phiếu (xem AgentApiClient.post).
   *
   * null = có mã KHÔNG tồn tại hoặc không thuộc đại lý này (backend cố ý không phân biệt, chống
   * dò mã) → phiếu CHƯA được tạo. Lỗi khác bubble lên.
   */
  createPaymentBatch(
    p: OrderPrincipal & { readonly trackingNumbers: readonly string[]; readonly signal?: AbortSignal },
  ): Promise<PaymentBatch | null>;
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
