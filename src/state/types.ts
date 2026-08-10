// types.ts — hợp đồng tầng state/memory dài hạn (§7).
//
// Partition (ownerKind, ownerId, channel, conversationId) — mọi read/write LỌC CẢ BỐN (tenancy
// cứng, không lọt cross-owner/cross-channel).
//
// Fact có hai loại CHỦ SỞ HỮU:
//   - PHÒNG đại lý (`customer`): phòng có cả nhân viên lẫn khách nói chung một mạch hội thoại,
//     nên fact là của phòng; ai gõ chỉ là chi tiết ghi TRONG text fact.
//   - MỘT NGƯỜI (`user`): chat 1-1 với trợ lý riêng — không phòng khách nào sở hữu.
//   - PHÒNG CHƯA BIND (`room`): nhóm chưa `/ketnoi-daily` — chưa biết của đại lý nào, nhưng vẫn
//     đáng thu thập đặc trưng + vấn đề của nhóm.
//
// Scope derive ở tầng wiring (worker), KHÔNG phải từ Identity người gõ (nhân viên không mang
// customerId) → state/ nhận scope tường minh, không đoán.

import type { HistoryEntry } from "../types/index.ts";

/** Ai sở hữu fact. Hai giá trị = hai KHÔNG GIAN ĐỊNH DANH, không được trộn (xem MemoryScope). */
export const MemoryOwnerKind = {
  /** ownerId = customer_id (từ group_map) — fact của phòng đại lý. */
  Customer: "customer",
  /** ownerId = senderId — fact của chính người đang chat 1-1. */
  User: "user",
  /**
   * ownerId = conversationId — fact của CHÍNH CÁI PHÒNG, dùng cho nhóm chưa `/ketnoi-daily`.
   * Có để thu thập đặc trưng + vấn đề của nhóm ngay khi chưa biết nhóm thuộc đại lý nào; nhóm đã
   * bind vẫn ghi theo `Customer` (fact thuộc về khách, không thuộc về phòng).
   */
  Room: "room",
} as const;
export type MemoryOwnerKind = (typeof MemoryOwnerKind)[keyof typeof MemoryOwnerKind];

/**
 * Khoá phân vùng memory.
 *
 * `ownerKind` KHÔNG thừa: `customer_id` và `senderId` là chuỗi từ hai hệ khác nhau, trùng giá
 * trị là chuyện có thể xảy ra. Thiếu nó thì fact riêng tư của một người lọt vào phòng đại lý
 * trùng id (hoặc ngược lại) mà không có cách nào phát hiện.
 *
 * `channel` + `conversationId` = đúng một cuộc trò chuyện (conversationId là id thô của kênh,
 * chỉ unique TRONG kênh — bỏ channel là lẫn phòng giữa hai kênh).
 */
export interface MemoryScope {
  readonly ownerKind: MemoryOwnerKind;
  readonly ownerId: string;
  readonly channel: string;
  readonly conversationId: string;
}

// Vocabulary loại fact MẶC ĐỊNH (dùng cho agent hỗ trợ khách — xem specs.ts). KHÔNG phải bộ
// duy nhất: mỗi agent khai vocab riêng trong DistillSpec. Cột `type` là text tự do ở DB.
export const MemoryType = {
  Preference: "preference", // sở thích/ràng buộc bền của khách
  Context: "context", // dữ kiện nền (đơn, sản phẩm, quan hệ)
  Episode: "episode", // sự việc đã xảy ra (đã tạo/hủy đơn...)
} as const;
export type MemoryType = (typeof MemoryType)[keyof typeof MemoryType];
export const MEMORY_TYPE_VALUES: readonly string[] = Object.values(MemoryType);

/** 1 fact distiller rút ra — atomic, self-contained, chưa gắn provenance/scope. */
export interface DistilledFact {
  /** Nhãn loại — vocab do DistillSpec của agent quyết; text tự do (không enum toàn cục). */
  readonly type: string;
  readonly text: string;
  /** 0..1 — thấp = suy đoán; dùng để lọc lúc recall. */
  readonly confidence: number;
}

/**
 * Policy chưng cất — TUỲ AGENT. Bộ chưng cất KHÔNG mặc định là "hội thoại khách": mỗi agent
 * cần nhớ thứ khác (agent bán hàng nhớ nhu cầu; agent kỹ thuật nhớ cấu hình...). Spec quyết
 * NỘI DUNG chưng cất; LlmDistiller chỉ là bộ máy chung chạy spec đó.
 */
export interface DistillSpec {
  /** Chỉ dẫn cho con nhẹ: agent này giữ GÌ, bỏ gì. Là phần đổi theo agent. */
  readonly system: string;
  /** Loại fact hợp lệ. Rỗng = chấp nhận mọi type model trả (chỉ trim). */
  readonly allowedTypes: readonly string[];
  /** type model trả không thuộc allowedTypes → clamp về đây. */
  readonly defaultType: string;
}

/**
 * Tham số recall. Object chứ KHÔNG hai tham số vị trí `number` cạnh nhau — đổi chỗ nhầm `k` với
 * `maxDistance` sẽ không ai phát hiện ra.
 */
export interface RecallOptions {
  /** top-K (§7: 5–8). */
  readonly k: number;
  /** Trần cosine distance pgvector `<=>`. Xa hơn = không đủ liên quan → vứt (§7 chống ảo giác #1). */
  readonly maxDistance: number;
}

/** Fact recall về — chỉ phần cần cho context (progressive disclosure), không kèm embedding. */
export interface RecalledFact {
  readonly type: string;
  readonly text: string;
  readonly createdAt: Date;
}

/** 1 lượt hội thoại đưa vào distiller. role phân biệt khách nói vs agent trả. */
export interface DistillTurn {
  readonly senderId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}

/** Rút fact bền từ 1 đoạn hội thoại. Không throw ra ngoài — lỗi model cô lập, trả []. */
export interface Distiller {
  distill(turns: readonly DistillTurn[], signal?: AbortSignal): Promise<DistilledFact[]>;
}

/**
 * Cổng CHỈ-ĐỌC memory. Tách khỏi `MemoryStore` vì bên đọc (context/) không có việc gì với
 * `write`/`prime` — bắt nó phụ thuộc cả kho là ép cài method chết (ISP).
 */
export interface MemoryRecall {
  /** Semantic search fact liên quan `queryText` TRONG scope này, theo `options`. */
  recall(
    scope: MemoryScope,
    queryText: string,
    options: RecallOptions,
    signal?: AbortSignal,
  ): Promise<RecalledFact[]>;
}

/** Kho memory dài hạn (đọc + ghi). Impl Postgres+pgvector; test qua fake executor. */
export interface MemoryStore extends MemoryRecall {
  /**
   * Ghi fact vào scope. `sourceMsgId` = provenance + idempotency (message đã distill → bỏ qua).
   * Trả SỐ fact ghi thực (sau khi bỏ trùng near-dup). Không ghi log thô.
   */
  write(
    scope: MemoryScope,
    facts: readonly DistilledFact[],
    sourceMsgId?: string,
    signal?: AbortSignal,
  ): Promise<number>;

  /** Prime lúc bootstrap: fact gần nhất của scope (profile khách compact). */
  prime(scope: MemoryScope, limit: number, signal?: AbortSignal): Promise<RecalledFact[]>;
}

/**
 * Đường GHI trí nhớ dài hạn. Nhận CẢ cửa sổ history (không phải DistillTurn) vì policy chạy hay
 * không dựa trên `msgId` để đặt cursor — xem `TurnoverMemoryWriter`. Worker không giữ policy đó.
 * Trả SỐ fact ghi thực (0 = chưa tới ngưỡng, hoặc không rút được fact nào).
 */
export interface MemoryWriter {
  afterTurn(
    scope: MemoryScope,
    entries: readonly HistoryEntry[],
    signal?: AbortSignal,
  ): Promise<number>;
}

/**
 * Tra đường ghi theo agent. Cần vì `DistillSpec` đóng cứng vào distiller lúc dựng: agent nhớ
 * khác nhau thì phải là writer khác nhau, không thể đổi spec giữa chừng.
 *
 * undefined = agent lạ (không nên xảy ra — writer dựng từ chính danh sách agent) → worker bỏ qua
 * ghi dài hạn thay vì ghi bằng spec của agent khác.
 */
export interface MemoryWriterLookup {
  for(agentType: string): MemoryWriter | undefined;
}

/**
 * Cổng thực thi SQL — seam để test không cần Postgres thật. `text` chỉ ghép từ hằng schema
 * (tin được); MỌI giá trị runtime đi qua `params` ($1,$2...) → tham số hoá, chống injection.
 */
export interface SqlExecutor {
  query(text: string, params: readonly unknown[]): Promise<unknown>;
}
