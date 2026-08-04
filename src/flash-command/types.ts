// types.ts — hợp đồng của tầng flash-command.
//
// Flash command = tin nhắn bắt đầu bằng `/` → chạy SIDE-EFFECT (bind/gán/gỡ), KHÔNG qua LLM.
// Tách khỏi lượt agent (ngôn ngữ tự nhiên): parse ở registry, dispatch tới handler thuần.
//
// Mọi phụ thuộc I/O (Postgres, hệ vận hành) đi qua PORT inject trong context — flash-command
// không tự mở kết nối. Seam này cho test (mock port) + tránh phụ thuộc ingest/db-wiring
// (chưa tồn tại). Nơi khởi động thật cấp implementation của port.

// ─────────────────────────────────────────────────────────────────────────────
// Vai của NGƯỜI GÕ lệnh (actor). Khác GroupRole (schema): nhan_vien không ở group_member —
// nhận diện qua user_binding. guest = mặc định đóng. Vai do AUTH resolve từ senderId, KHÔNG
// do client khai (xem docs/ARCHITECTURE.md §AUTH).
// ─────────────────────────────────────────────────────────────────────────────
export const ActorRole = {
  NhanVien: "nhan_vien",
  DaiLy: "dai_ly",
  Guest: "guest",
} as const;
export type ActorRole = (typeof ActorRole)[keyof typeof ActorRole];

/**
 * Định danh người gõ, đã resolve từ senderId. Union rời rạc theo vai:
 * chỉ nhân viên có `userId` (dùng làm `assigned_by` khi gán đại lý).
 */
export type Identity =
  | { role: typeof ActorRole.NhanVien; senderId: string; userId: string }
  | { role: typeof ActorRole.DaiLy; senderId: string; customerId: string }
  | { role: typeof ActorRole.Guest; senderId: string };

// Mention chuyển lên types/ chung (Envelope dùng chung). Import để dùng trong file + re-export
// giữ nguyên API flash-command.
import type { Mention } from "../types/index.ts";
export type { Mention };

// ─────────────────────────────────────────────────────────────────────────────
// Ports — seam I/O. Implementation cấp lúc khởi động, không nằm ở đây.
// ─────────────────────────────────────────────────────────────────────────────

/** Cổng tới hệ vận hành: đổi token nhân viên gõ → user_id (verify server-side). */
export interface OpsPort {
  /** null = token không hợp lệ / hết hạn. Không throw cho case "sai token" — đó là input hợp lệ. */
  resolveUserByToken(token: string): Promise<{ userId: string } | null>;
}

/** Cổng ghi định danh vào Postgres (user_binding / group_member). Idempotent. */
export interface IdentityRepo {
  /** Upsert user_binding(channel, senderId) → userId; clear revoked_at (bind lại sau đổi máy). */
  bindUser(p: { channel: string; senderId: string; userId: string }): Promise<void>;
  /** True nếu senderId đang là nhân viên active — chặn phong nhầm nhân viên thành đại lý. */
  isBoundUser(p: { channel: string; senderId: string }): Promise<boolean>;
  /** Upsert group_member role=dai_ly, active. `assignedBy` = user_id nhân viên gán (audit). */
  assignDealer(p: {
    channel: string;
    groupId: string;
    senderId: string;
    assignedBy: string;
  }): Promise<void>;
  /** Set group_member.revoked_at = now (kế toán nghỉ). No-op nếu không có row active. */
  revokeDealer(p: { channel: string; groupId: string; senderId: string }): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context + kết quả
// ─────────────────────────────────────────────────────────────────────────────

/** Mọi thứ handler cần. `args`/`mentions` đã parse từ payload; port đã inject. */
export interface FlashContext {
  readonly identity: Identity;
  readonly channel: string;
  /** undefined khi direct (không group). Lệnh cần group tự kiểm và trả lỗi rõ. */
  readonly groupId: string | undefined;
  /** Token sau tên lệnh, tách theo khoảng trắng. `noUncheckedIndexedAccess` → check trước khi dùng. */
  readonly args: readonly string[];
  readonly mentions: readonly Mention[];
  readonly repo: IdentityRepo;
  readonly ops: OpsPort;
}

/**
 * Kết quả lệnh — LUÔN structured, không throw ra ngoài (lỗi input/quyền = kết quả hợp lệ).
 * `reply` là text trả người dùng cho cả ok lẫn fail.
 */
export type FlashResult = { ok: boolean; reply: string };

/** Đường tắt tạo kết quả — đọc gọn ở handler. */
export const ok = (reply: string): FlashResult => ({ ok: true, reply });
export const fail = (reply: string): FlashResult => ({ ok: false, reply });

/**
 * Một flash command = 1 module (export default 1 object này). Thêm lệnh = thêm 1 file rồi
 * register — không sửa registry (open/closed).
 */
export interface FlashCommand {
  /** Tên KHÔNG kèm `/`, viết thường. Là khoá trong registry. */
  readonly name: string;
  readonly description: string;
  /** undefined = mọi vai gõ được (vd ketnoi-hethong: guest bind để THÀNH nhân viên). */
  readonly allowedRoles?: readonly ActorRole[];
  handler(ctx: FlashContext): Promise<FlashResult>;
}
