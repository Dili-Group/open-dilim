# 4. Agent routing: channel → root agent → sub-agent

Định tuyến hai tầng, tách bạch:

- **Tầng thô (worker)** — `channel` chọn **root agent**: mỗi cửa vào (webhook/OA riêng) phục vụ
  một nhóm người dùng riêng nên có một agent riêng.
- **Tầng mịn (trong 1 root)** — orchestrator chọn **sub-agent** theo TASK của lượt đó.

Thêm nghiệp vụ = thêm 1 root agent, core không đổi.

## Tầng thô: channel → agentType → RootAgent

```
Envelope {
  msgId, conversationId,           // phòng (direct | group)
  isGroup,                         // ◀ cờ group — client/channel gửi kèm
  senderId,                        // ◀ người gửi message NÀY
  channel,                         // ◀ path webhook `/webhook/:channel` — KHÓA ĐỊNH TUYẾN
  addressedToAgent,                // ◀ group: có mention @agent không (ingest set)
  text, mentions, ts
}

ingest:  channel = path webhook; chưa đăng ký Ingestor → 404, không vào tới worker
auth:    senderId → identity (nhân viên | đại lý | guest)     — nguồn sự thật cho QUYỀN
worker:  agentType = resolveAgentType(channel)                — bảng hằng, undefined = chưa map
         agent    = registry.resolve(agentType)               — undefined → default agent
agent:   vẫn gate TỪNG tool theo identity (defense-in-depth)
```

**Bảng định tuyến** (`agents/router.ts`) là POLICY, không phải secret → để hằng trong code
(đọc được, test được), không nhét env. Đổi ai phục vụ channel nào = sửa đúng một bảng.

| channel | agentType | Phục vụ | `directOnly` | memorySpec |
|---------|-----------|---------|--------------|------------|
| `zalo` | `dealer` | Kế toán đại lý, trong nhóm của chính đại lý đó | false | `customerSupportSpec` |
| `van-hanh` | `operations` | Nhân viên vận hành Dili (Sales Admin, quản lý) | false | `internalOpsSpec` |
| `zalo-sep` | `boss` | Ban lãnh đạo — hỏi để ra quyết định | false | `internalOpsSpec` |
| `zalo-canhan` | `personal` | Trợ lý riêng, CHỈ chat 1-1 | **true** | `personalSpec` |
| *(khác)* | *(default)* | Channel chưa map — lượt vẫn chạy được | false | `customerSupportSpec` |

**1 kênh = 1 tài khoản Zalo riêng** (`agentUid` + `webhookSecret` + bridge egress riêng, khai
trong `CONFIG.channels`). Kênh thiếu env → không đăng ký ingestor → `POST /webhook/<kênh>` trả
404; kênh có ingest nhưng thiếu bridge → nhận tin được, egress rơi về console.

> Tên kênh còn nằm trong cột `channel` của `user_binding` / `group_map` / `group_member`.
> **Đổi tên kênh đang chạy = mồ côi toàn bộ định danh đã bind.**

`directOnly` = agent chỉ phục vụ 1-1 → worker BỎ QUA group MemoryScope (không phòng nào sở hữu
fact thì không đọc, không ghi — xem [§7 memory](./07-memory.md)).

## Luật cốt lõi: định tuyến ≠ authorization

`channel` **chỉ chọn luồng chạy**, KHÔNG tự cấp quyền. Quyền quyết bởi `identity` backend resolve
từ `senderId` ([§5b](./05b-dinh-danh-va-vai.md)).

- Gõ nhầm channel → cùng lắm route nhầm luồng, **không leo thang quyền**.
- Đại lý lọt vào channel vận hành → agent vận hành vẫn thấy `identity.role = dai_ly`, và mọi
  tool nhạy cảm gate theo identity đó.

Hai tầng tách rời (route ≠ quyền) → định tuyến sai là lỗi trải nghiệm, không phải lỗ bảo mật.

## 3 rào bắt buộc

1. **Whitelist enum** — `AgentType ∈ {operations, dealer, personal, boss}`. Router chỉ được trả
   giá trị trong enum; chuỗi tự do lọt vào registry là route mù.
2. **Không map → default, không đoán** — channel lạ trả `undefined` → default agent. KHÔNG chọn
   agent "gần đúng": đoán sai là trả lời sai persona cho sai nhóm người.
3. **Agent đích tự enforce quyền** — không tin "channel đã đúng nên bỏ check". Mọi tool
   WRITE/nhạy cảm gate theo identity.

## Root agent = DATA, không phải code

Các root agent khác nhau ở prompt / bộ tool / trí nhớ / sub-agent — KHÔNG khác ở luồng chạy.
Nên luồng nằm đúng một chỗ (`agents/runtime/build-agent.ts`), còn mỗi agent chỉ là một `RootAgentProfile`:

```ts
export const dealerProfile: RootAgentProfile = {
  agentType: AgentType.Dealer,
  directOnly: false,
  prompt: DEALER_PROMPT,          // persona + nhiệm vụ + điều cấm
  memorySpec: customerSupportSpec, // agent này NHỚ gì
  tools: COMMON_TOOLS,             // agent này ĐƯỢC dùng tool nào
  subAgents: [],                   // nhánh chuyên môn bên trong
};
```

**Thêm root agent** = 1 hằng trong `AgentType` + 1 file `roots/` + 1 dòng `PROFILES` + 1 dòng
bảng channel. Không đụng bộ máy chạy lượt.

`memorySpec` không chỉ là khai báo: bootstrap dựng **một đường ghi trí nhớ cho mỗi spec** từ
`agents.all()`, worker tra writer theo agent vừa chạy ([§7](./07-memory.md)). Agent mới tự có
writer đúng spec của nó, không phải nhớ sửa thêm chỗ nào.

## Tầng mịn: orchestrator chọn sub-agent

Sub-agent = nhánh chuyên môn BÊN TRONG một root (vd trong `operations`: đơn hàng / kho / công nợ).

```
run(lượt):
  1. có subAgents?  → orchestrator: 1 lượt LLM rẻ (không tool, không memory, effort=low)
                      đọc tin mới nhất → trả về ĐÚNG 1 tên sub, hoặc "none"
  2. chọn được sub  → sub cầm TRỌN lượt: prompt sub thay prompt root, tool sub thay tool root
     không chọn được→ root tự trả lời
  3. assemble context (prompt đã chốt + catalog skill + khối memory) → agent loop
```

- **Không có sub → không tốn lượt LLM định tuyến nào.** Chi phí chỉ phát sinh khi root thật sự
  có nhánh.
- **Chọn sub TRƯỚC khi lắp ngữ cảnh** — sub đổi prompt nền; assemble xong mới đổi thì phải recall
  memory (một lần gọi embed) hai lần cho cùng một lượt.
- **Không chắc → root.** Model trả tên lạ / không có câu hỏi để phân loại → `undefined`. Định
  tuyến sai còn tệ hơn không định tuyến, vì sub cầm bộ tool khác và trả lời bằng persona khác.
- **Sub KHÔNG khai `memorySpec`/`directOnly`** — trí nhớ và phạm vi phòng thuộc về ROOT (cùng một
  hội thoại); sub chỉ đổi cách xử lý lượt.
- **Không loop lồng loop** — chọn xong thì sub LÀ người trả lời, không có root "tổng hợp lại".

> Chưa hỗ trợ handoff cross-agent (root A tự đẩy sang B). Ngoài phạm vi hiện tại — mỗi channel
> gắn một root agent.

---

[← Mục lục kiến trúc](../ARCHITECTURE.md)
