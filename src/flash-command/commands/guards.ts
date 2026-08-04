// guards.ts — kiểm điều kiện chung cho lệnh gán/gỡ đại lý (ketnoi-daily, huy-ketnoi).
// Cả hai đòi: nhân viên gõ (có userId), trong group, có đúng 1 mention. Gom 1 chỗ, khỏi lặp.

import { ActorRole, fail, type FlashContext, type FlashResult } from "../types.ts";

/** Dữ liệu đã kiểm cho lệnh thao tác đại lý trong group. */
export type DealerActionScope = {
  actorUserId: string;
  groupId: string;
  targetUid: string;
};

/**
 * Trả scope hợp lệ HOẶC FlashResult lỗi (đã có reply). Phân biệt qua field `scope`.
 * Guard vai đã chạy ở registry; ở đây narrow lại `nhan_vien` để lấy userId type-safe.
 */
export function resolveDealerScope(
  ctx: FlashContext,
): { scope: DealerActionScope } | { error: FlashResult } {
  if (ctx.identity.role !== ActorRole.NhanVien) {
    // Không tới đây nếu registry guard đúng — vẫn chặn để type-safe + phòng gọi trực tiếp (test).
    return { error: fail("Chỉ nhân viên được thao tác đại lý.") };
  }

  if (ctx.groupId === undefined) {
    return { error: fail("Lệnh này chỉ dùng trong nhóm.") };
  }

  const first = ctx.mentions[0];
  if (first === undefined) {
    return { error: fail("Thiếu @mention người cần thao tác.") };
  }
  if (ctx.mentions.length > 1) {
    return { error: fail("Chỉ @mention 1 người mỗi lần.") };
  }

  return {
    scope: {
      actorUserId: ctx.identity.userId,
      groupId: ctx.groupId,
      targetUid: first.uid,
    },
  };
}
