# 5. Message life cycle (direct & group)

Hai loại session: **direct** (1 user ↔ agent) và **group** (nhiều người ↔ agent trong 1 phòng).
Một life cycle chung; group cắm thêm trigger-gate + ordering-per-phòng + attribution + broadcast-to-room.

Hai trục:
- **`conversationId`** = phòng. State/history gắn theo đây (group = shared history nhiều speaker).
- **`senderId`** = người gửi từng message. Direct luôn 1 người; group đổi theo message.
  **Quyền luôn theo `senderId`, KHÔNG theo phòng** — group không có "quyền group".

`isGroup` do client/channel gửi kèm (giống `agentType`): chỉ đổi **hành vi** (trigger, broadcast),
KHÔNG cấp quyền. Group trigger = **mention @agent** (chỉ mention, không dùng reply/command).

```
1. INGEST      normalize → conversationId, isGroup, senderId
               isGroup=true  → set addressedToAgent = có mention @agent trong payload?
               isGroup=false → addressedToAgent = true (direct luôn nhắm agent)
2. TRIGGER     addressedToAgent=false → CHỈ ghi vào history (passive context), KHÔNG chạy agent → DONE
               addressedToAgent=true  → tiếp
3. ACK 202     push queue
4. DEDUPE      idempotency theo msgId
5. ORDER-LOCK  serialize theo conversationId (1 message/lúc/phòng — chống đua state)
6. AUTH        identity từ senderId → verify quyền + agentType được phép
7. STATE       load history phòng; mỗi turn gắn {senderId, text} (group đa speaker)
8. AGENT       registry.resolve(agentType).run() — context biết AI đang hỏi
9. BROADCAST   direct → DM về user
               group  → publish topic phòng (fan-out mọi member), @ lại người hỏi
10. AUDIT      log msgId + senderId + tool_calls + result
```

Bước 6 (resolve `senderId` → vai, lệnh `/ketnoi-dilim`) tách riêng:
xem [5b. Định danh & vai](./05b-dinh-danh-va-vai.md).

## Delta của group (so với direct)

| Bước | Direct | Group |
|------|--------|-------|
| 1–2 Trigger | Luôn nhắm agent | Chỉ chạy khi **mention @agent**; câu khác → nuốt vào history làm ngữ cảnh (chống spam + tốn LLM) |
| 5 Ordering | Ít đua (1 người) | **Bắt buộc** serialize theo `conversationId` — nhiều người gõ cùng lúc, không khóa thì đè state/history |
| 7 History | 1 speaker | Đa speaker, mỗi entry gắn `senderId`; prompt render "An: … / Bình: …" để agent trả đúng người |
| 9 Broadcast | DM 1 user | Publish topic phòng → mọi member thấy; @ lại người hỏi |

## Ăn khớp approval ([mục 6](./06-approval.md))

Group + human-loop: `pending_action` gắn **`requesterId`**. Lúc resume, `resolver` check người
reply đúng là requester (hoặc staff có quyền) — không thì bất kỳ ai trong group cũng "xác nhận
hủy đơn" hộ người khác. Lỗ hổng dễ sai nhất ở group.

---

[← Mục lục kiến trúc](../ARCHITECTURE.md)
