# §11 — Phễu proactive: nhặt câu hỏi không mention agent

## Vấn đề

Đo trên `message_log` (25/08/2026, kênh `zalo`): **818/1055** tin group KHÔNG nhắm agent, trong
đó ~20% là câu nhờ vả/hỏi thật ("PKE… hủy giúo c nhé", "nhờ hỗ trợ in đơn này giúp c"). Đại lý
không biết/không quen tag agent → vấn đề của họ không được giải quyết, dù agent làm được.

Đọc mọi tin bằng LLM thì vừa tốn token vừa spam nhóm. Giải pháp: **phễu 4 tầng** — mỗi tầng rẻ
hơn tầng sau, chỉ phần rất nhỏ traffic chạm LLM đầy đủ.

## Bốn tầng (`src/proactive/`)

```
tin group !addressedToAgent (gateway.ts → considerProactive, best-effort)
  │
  ├─ TẦNG 0  gate.ts — regex intent + guard. 0 token, chạy mọi tin.
  │          Loại: chatter, [Ảnh đính kèm] trần, URL trần, tin của CHÍNH agent.
  │          Giữ (~20%): giúp/giùm, hủy, check, vận đơn, thanh toán, chiết khấu,
  │          "chưa thấy…", khi nào/sao, câu kết "?".
  │
  ├─ TẦNG 1  pending.ts + poller.ts — chờ `waitMs` (dealer: 4 phút). 0 token.
  │          Hàng chờ Redis: ZSET (giờ đến hạn) + HASH (payload), key theo
  │          (channel, phòng, người hỏi) → câu mới của cùng người ĐÈ câu cũ, đồng hồ reset.
  │          Đến hạn: NGƯỜI KHÁC đã lên tiếng sau câu hỏi (soi history) → bỏ.
  │          Đây là bộ lọc mạnh nhất: đa số câu hỏi người thật tự trả lời nhau;
  │          agent chỉ nhặt câu BỊ BỎ RƠI.
  │
  ├─ TẦNG 2  poller.ts `deps.classify` — SEAM classifier model rẻ. CHƯA NỐI (cho qua).
  │          Nối sau: câu hỏi + context → "agent trả lời được không?" ~300 token/call.
  │
  └─ TẦNG 3  Envelope `source: "proactive"`, `addressedToAgent: true` → chung queue tin
             thường. Worker chạy như lượt thường (AUTH đúng người hỏi, budget, block…);
             agent gắn `profile.proactive.turnNote` vào prompt: trả lời ngắn, không chắc
             thì IM LẶNG (chuỗi rỗng → worker không broadcast), nhắc @mention lần sau.
```

## Opt-in theo agent — mặc định đóng

Phễu là tính năng CỦA AGENT, khai bằng `RootAgentProfile.proactive: ProactiveSpec` (giống
`mcpServers`): `triggers`, `waitMs`, `turnNote`, `maxPerRoomPerHour`. Thiếu = agent không dùng
phễu. Hiện chỉ `dealerProfile` khai. Engine dùng chung, KHÔNG rẽ nhánh theo agentType — bật cho
agent khác = thêm spec vào profile của nó.

Tra spec theo channel: `proactive/spec.ts` = `resolveAgentType(channel)` (router §4) →
`profile.proactive`. Channel không map / agent không khai → phễu tắt cho channel đó.

## Guard

- **Tự trigger trên tin của chính mình**: tin agent gửi vọng lại webhook mang uid TÀI KHOẢN
  (`*_SELF_UID`, đo được ≠ `*_AGENT_UID` là uid mention). Gate loại cả hai. Thiếu `SELF_UID`
  → chỉ guard bằng `AGENT_UID`, có nguy cơ agent tự nhặt câu của mình.
- **Trần tần suất**: `maxPerRoomPerHour` (Redis INCR + EXPIRE 1h) — van an toàn khi nhóm bàn
  tán sôi nổi, nhất là khi tầng 2 chưa nối.
- **Best-effort mọi chỗ**: gate/schedule hỏng chỉ mất một cơ hội chủ động giúp, không được làm
  rớt tin (throw ở gateway là nhả dedupe, channel gửi lại nguyên tin).

## Vận hành

- Poller đi chung nhịp `schedulerTickMs` (30s), cùng khung claim-trước-bắn với scheduler §8:
  nhiều instance thì ZREM ai thắng người đó xử lý.
- Tắt phễu một agent = xoá `proactive` khỏi profile; câu đang chờ trong Redis đến hạn sẽ rơi
  (poller tra spec lại lúc nhặt).
- Việc còn lại (chưa làm): nối tầng 2 classifier; kill-switch per phòng (`proactive_enabled`
  trên `group_map`) nếu cần tắt nhóm nóng tính không cần deploy.
