// types.ts — hợp đồng tầng state/memory dài hạn (§7).
//
// Memory thuộc về KHÁCH, không về người gõ: partition (customerId, endUserId) — mọi read/write
// LỌC CẢ HAI (tenancy cứng, không lọt cross-customer). Scope này derive từ group_map + senderId
// ở tầng wiring (worker), KHÔNG phải Identity người gõ → state/ nhận scope tường minh, không đoán.

/** Khoá phân vùng memory. customerId từ group_map; endUserId = người dùng cuối (≠ nhân viên). */
export interface MemoryScope {
  readonly customerId: string;
  readonly endUserId: string;
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

/** Kho memory dài hạn. Impl Postgres+pgvector; test qua fake executor. */
export interface MemoryStore {
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

  /** Semantic search top-K fact liên quan `queryText` TRONG scope này. */
  recall(
    scope: MemoryScope,
    queryText: string,
    k: number,
    signal?: AbortSignal,
  ): Promise<RecalledFact[]>;

  /** Prime lúc bootstrap: fact gần nhất của scope (profile khách compact). */
  prime(scope: MemoryScope, limit: number, signal?: AbortSignal): Promise<RecalledFact[]>;
}

/**
 * Cổng thực thi SQL — seam để test không cần Postgres thật. `text` chỉ ghép từ hằng schema
 * (tin được); MỌI giá trị runtime đi qua `params` ($1,$2...) → tham số hoá, chống injection.
 */
export interface SqlExecutor {
  query(text: string, params: readonly unknown[]): Promise<unknown>;
}
