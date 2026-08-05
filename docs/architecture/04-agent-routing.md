# 4. Agent routing theo type

Mỗi message mang `agentType` (client gửi kèm) → định tuyến tới **root agent** tương ứng.
`operation` → ops agent, `partner` → partner agent, v.v. Thêm nghiệp vụ = thêm 1 root agent,
core không đổi (giống factory cho channel).

```
Envelope {
  msgId, conversationId,           // phòng (direct | group)
  isGroup,                         // ◀ cờ group — client/channel gửi kèm
  senderId,                        // ◀ người gửi message NÀY
  agentType,                       // ◀ client gửi — ROUTING HINT (không phải quyền)
  identity,                        // ◀ backend inject từ senderId — nguồn sự thật cho QUYỀN
  addressedToAgent,                // ◀ group: có mention @agent không (ingest set)
  channel, payload, meta
}

ingest:  nhận agentType từ client → validate ∈ whitelist enum  (sai → default/reject)
auth:    verify identity ĐƯỢC phép agentType này               (không → reject)
worker:  agent = registry.resolve(agentType) ?? defaultAgent → agent.run(envelope)
agent:   vẫn gate TỪNG tool theo identity (defense-in-depth)
```

## Luật cốt lõi: `type` ≠ authorization

`agentType` client gửi **chỉ chọn luồng chạy**, KHÔNG tự cấp quyền. Dù client khai
`type=operation`, quyền vẫn quyết bởi `identity` backend inject.

- Client khai type sai → cùng lắm route nhầm luồng, **không leo thang quyền**.
- Partner account gửi `type=operation` → `auth` chặn ở bước "identity được phép type?"
  (map allowed-types theo vai/tài khoản). Có lọt qua → tool nhạy cảm vẫn gate theo identity partner.

Hai tầng tách rời (route ≠ quyền) → client gửi type an toàn.

## 3 rào bắt buộc

1. **Whitelist enum** — `agentType ∈ {operation, partner, ...}`. Ngoài list → default agent / reject, không route mù theo chuỗi client tự đặt.
2. **Map identity → allowed types** — vai/tài khoản nào dùng type nào. Chặn ngay tầng `auth`, trước khi tới agent.
3. **Agent đích tự enforce quyền** — không tin "type đã đúng nên bỏ check". Mọi tool WRITE/nhạy cảm gate theo identity.

## Quan hệ với orchestrator

- **`agentType` route (ingest/worker)** = chọn ROOT agent — thô, theo domain/vai.
- **orchestrator (trong 1 root agent)** = chọn sub-agent/workflow — mịn, theo task.

Hai tầng khác nhau, không chồng. State (`conversationId`) nên lưu `agentType` hiện tại →
tin nhắn sau cùng hội thoại route đúng root agent, không cần suy lại.

> Chưa hỗ trợ handoff cross-agent (root A tự đẩy sang B). Ngoài phạm vi hiện tại — mỗi
> hội thoại gắn 1 `agentType`.

---

[← Mục lục kiến trúc](../ARCHITECTURE.md)
