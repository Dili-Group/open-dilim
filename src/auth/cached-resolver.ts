// cached-resolver.ts — cache-aside Identity trên Redis, bọc trước SqlIdentityResolver.
//
// Mỗi tin gọi resolve() = tới 2 query Postgres (user_binding + group_member). Cache lớp Redis
// chặn trước như session server-side: HIT → khỏi chạm DB. Chỉ cache nhân_viên + đại_lý; guest =
// mặc định đóng, đổi trạng thái bất kỳ lúc nào (bind/gán) → luôn miss, hỏi DB.
//
// Invalidation: SqlIdentityRepo.{assignDealer,revokeDealer} DEL đúng key khi vai đại lý đổi.
// Nhân viên chưa có đường revoke → không cần xoá. Guest không cache → bind từ guest khỏi xoá.
// TTL = lưới an toàn: đổi group_map (hiếm) chỉ stale tối đa TTL rồi tự hết.

import type { Identity } from "../flash-command/types.ts";
import { ActorRole } from "../flash-command/types.ts";
import type { RedisCommand } from "../redis/types.ts";
import type { IdentityResolver, ResolveInput } from "./types.ts";

const CACHE_PREFIX = "auth";
// 8h — khớp một ca làm của nhân viên/đại lý.
const TTL_SEC = 8 * 60 * 60;

/** Key cache Identity. Gồm groupId vì vai đại lý phụ thuộc (channel, group_id, sender_id):
 *  cùng sender ở nhóm khác = vai khác. undefined (DM) → "-". */
export function authCacheKey(channel: string, senderId: string, groupId?: string): string {
  return `${CACHE_PREFIX}:${channel}:${senderId}:${groupId ?? "-"}`;
}

export class CachedIdentityResolver implements IdentityResolver {
  constructor(
    private readonly inner: IdentityResolver,
    private readonly send: RedisCommand,
  ) {}

  async resolve(input: ResolveInput): Promise<Identity> {
    const key = authCacheKey(input.channel, input.senderId, input.groupId);
    const cached = parseCachedIdentity(await this.send("GET", [key]), input.senderId);
    if (cached !== null) return cached;

    const identity = await this.inner.resolve(input);
    if (identity.role !== ActorRole.Guest) {
      await this.send("SET", [key, JSON.stringify(identity), "EX", String(TTL_SEC)]);
    }
    return identity;
  }
}

/** Narrow giá trị Redis (unknown) → Identity. Cache rác/khác shape → null = coi như miss, hỏi DB.
 *  Chỉ nhận nhân_viên/đại_lý (đúng thứ được cache); senderId phải khớp key. */
function parseCachedIdentity(raw: unknown, senderId: string): Identity | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  if (rec["senderId"] !== senderId) return null;

  if (rec["role"] === ActorRole.NhanVien && typeof rec["userId"] === "string") {
    const fullName = rec["fullName"];
    return {
      role: ActorRole.NhanVien,
      senderId,
      userId: rec["userId"],
      // Tên là phần TRANG TRÍ: cache cũ (ghi trước khi có field) hay kiểu sai thì bỏ tên, KHÔNG
      // coi cả bản ghi là rác — vai vẫn đúng, ép miss chỉ để lấy tên là tốn query vô ích.
      fullName: typeof fullName === "string" ? fullName : undefined,
    };
  }
  if (rec["role"] === ActorRole.DaiLy && typeof rec["customerId"] === "string") {
    return { role: ActorRole.DaiLy, senderId, customerId: rec["customerId"] };
  }
  return null;
}
