# 5b. Định danh: `senderId` → vai (bước 6 AUTH)

Bước 6 của [message life cycle](./05-message-lifecycle.md), tách riêng vì đây là chốt phân quyền.

`senderId` (webhook đã ký → tin được) resolve thành **1 trong 3 vai**. Vai quyết quyền +
data scope, KHÔNG do client khai.

| Vai | Là ai | Resolve từ | Data scope |
|-----|-------|-----------|-----------|
| **nhân viên** | Sales Admin / quản lý / giám đốc Dili | `user_binding(channel, senderId)` active → `user_id` hệ vận hành | Theo quyền `user_id` (có thể nhiều đại lý) |
| **đại lý** | Kế toán đại lý | `group_member(channel, groupId, senderId)` role=`dai_ly` active | Đúng đại lý của group (derive từ `group_map`) |
| **guest** | Còn lại | Không match 2 cái trên (default đóng) | Không data nội bộ; hỏi chung |

**Thứ tự resolve (dừng ở match đầu):**
```
1. user_binding(channel, senderId) active?        → nhân viên  (định danh TOÀN CỤC, không theo group)
2. group_member(channel, groupId, senderId)=dai_ly? → đại lý   (theo group)
3. else                                            → guest      (mặc định)
```

`customer_id` (đại lý nào) **derive runtime** từ `group_map(channel, groupId)` — KHÔNG lưu trong
`group_member`. Vận hành sở hữu quan hệ group→đại lý (single source of truth); cache lại sẽ stale
khi re-map. Group không có trong `group_map` → lookup miss → fail sạch, không gán treo.

**Lệnh `/ketnoi-dilim @mention` — gán vai đại lý:**
```
nhân viên gõ /ketnoi-dilim @A  (trong group G)
  1. verify sender = nhân viên (user_binding active)        — guest/đại lý gõ → reject
  2. lấy uid A từ MENTION ENTITY của payload (uid, offset)   — KHÔNG regex tên (trùng/đổi → sai người)
  3. validate A chưa phải nhân viên                          — tránh phong nhầm nhân viên thành đại lý
  4. upsert group_member(channel, G, A, role=dai_ly, assigned_by=user_id nhân viên)
```
- `customer_id` KHÔNG nhập tay: suy từ `group_map(G)` lúc runtime.
- Gỡ vai (kế toán nghỉ): `/huy-ketnoi @A` → set `group_member.revoked_at`.
- `assigned_by` lưu vết ai phong ai (audit).

> **Lỗ dễ sai:** đừng coi "mọi người trong group = đại lý". Group trộn nhân viên Dili + kế toán
> đại lý + người lạ. Không resolve vai trước → guest/nhân viên thấy nhầm data nội bộ đại lý, hoặc
> đại lý A thấy data đại lý B. Resolve `senderId` → vai LUÔN chạy trước khi agent trả lời.

---

[← Mục lục kiến trúc](../ARCHITECTURE.md)
