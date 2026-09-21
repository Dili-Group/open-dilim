# §11 — Phễu proactive: nhặt câu hỏi không mention agent

## Vấn đề

Đo trên `message_log` (25/08/2026, kênh `zalo`): **818/1055** tin group KHÔNG nhắm agent, trong
đó ~20% là câu nhờ vả/hỏi thật ("PKE… hủy giúo c nhé", "nhờ hỗ trợ in đơn này giúp c"). Đại lý
không biết/không quen tag agent → vấn đề của họ không được giải quyết, dù agent làm được.

Đọc mọi tin bằng LLM thì vừa tốn token vừa spam nhóm. Giải pháp: **phễu 4 tầng** — mỗi tầng rẻ
hơn tầng sau, chỉ phần rất nhỏ traffic chạm LLM đầy đủ.

> **Cập nhật 21/09/2026:** tầng 0 KHÔNG còn danh sách regex intent. Việc đoán ý định chuyển hẳn
> sang tầng 2, chấm bằng model phán quyết có kiểu (Jev) — xem
> [§14](./14-proactive-jev-judge.md). Regex đo TỪ NGỮ: "đơn hôm qua vẫn nằm im" không có từ khoá
> nào mà vẫn cần giúp, "cảm ơn c, chiết khấu ok rồi" có từ khoá mà chẳng ai cần. Và regex không
> trả ra con số nào để biết mình đang sai bao nhiêu.

## Bốn tầng (`src/proactive/`)

```
tin group !addressedToAgent (gateway.ts → considerProactive, best-effort)
  │
  ├─ TẦNG 0  gate.ts — GUARD CẤU TRÚC. 0 token, chạy mọi tin, nằm trong đường nóng webhook
  │          (gateway gọi trước khi trả 202, trong vùng đã mark dedupe → cấm gọi mạng ở đây).
  │          Loại: tin không phải người thật gõ, tin của CHÍNH agent, tin đã tag đích danh
  │          người khác, tin rỗng / chỉ [Ảnh đính kèm] / chỉ URL.
  │          KHÔNG còn đoán ý định — tin có nội dung là vào hàng chờ.
  │
  ├─ VERIFY  verify.ts — xác minh TRẠNG THÁI trước khi vào hàng chờ (chỉ tin đã qua gate):
  │          phòng đã xác thực (`requireBoundGroup` trong spec — dealer cần /ketnoi-daily,
  │          chưa bind thì tool không có phạm vi dữ liệu) + ngân sách ngày của phòng còn
  │          (cùng gate với worker §6d, nhưng chặn TRƯỚC — để tới worker thì lượt vượt trần
  │          bị báo "hết ngân sách" vào phòng không ai hỏi; worker vẫn giữ backstop im lặng
  │          `budget_proactive` cho ca ngân sách cạn giữa lúc chờ và lúc nhặt).
  │
  ├─ TẦNG 1  pending.ts + poller.ts — chờ `waitMs` (dealer: 4 phút). 0 token.
  │          Hàng chờ Redis: ZSET (giờ đến hạn) + HASH (payload), key theo
  │          (channel, phòng, người hỏi) → câu mới của cùng người ĐÈ câu cũ, đồng hồ reset.
  │          Đến hạn: NGƯỜI KHÁC đã lên tiếng sau câu hỏi (soi history) → bỏ.
  │          Đây là bộ lọc mạnh nhất: đa số câu hỏi người thật tự trả lời nhau;
  │          agent chỉ nhặt câu BỊ BỎ RƠI.
  │
  ├─ TẦNG 2  proactive/judge.ts — PHÁN QUYẾT CÓ KIỂU (Jev, xem §14). Một request, 4 mệnh đề
  │          `noul` chấm song song: tự làm được không · có nhờ đích danh ai không ·
  │          đã có người lo chưa · có đang bức xúc không. Code so với NGƯỠNG của agent
  │          (`ProactiveSpec.judge.policy`) rồi quyết, và ghi lý do từ chối ra log.
  │          FAIL-CLOSED: chưa nối / hỏng / quá hạn → KHÔNG nhặt (khác luật cũ "cho qua",
  │          vì tầng 0 không còn regex gác trước).
  │
  └─ TẦNG 3  Envelope `source: "proactive"`, `addressedToAgent: true` → chung queue tin
             thường. Worker chạy như lượt thường (AUTH đúng người hỏi, budget, block…);
             agent gắn `profile.proactive.turnNote` vào prompt: trả lời ngắn, không chắc
             thì IM LẶNG (chuỗi rỗng → worker không broadcast), nhắc @mention lần sau.
```

## Opt-in theo agent — mặc định đóng

Phễu là tính năng CỦA AGENT, khai bằng `RootAgentProfile.proactive: ProactiveSpec` (giống
`mcpServers`): `judge` (năng lực + ngưỡng), `waitMs`, `turnNote`, `maxPerRoomPerHour`. Agent khai
NĂNG LỰC bằng tiếng Việt (`capabilities: string[]`) chứ không khai từ khoá — thêm agent dùng phễu
không phải nghĩ lại danh sách regex. Thiếu = agent không dùng
phễu. Hiện chỉ `dealerProfile` khai. Engine dùng chung, KHÔNG rẽ nhánh theo agentType — bật cho
agent khác = thêm spec vào profile của nó.

Tra spec theo channel: `proactive/spec.ts` = `resolveAgentType(channel)` (router §4) →
`profile.proactive`. Channel không map / agent không khai → phễu tắt cho channel đó.

## Guard

- **Tự trigger trên tin của chính mình**: tin agent gửi vọng lại webhook mang uid TÀI KHOẢN
  (`*_SELF_UID`, đo được ≠ `*_AGENT_UID` là uid mention). Gate loại cả hai. Thiếu `SELF_UID`
  → chỉ guard bằng `AGENT_UID`, có nguy cơ agent tự nhặt câu của mình.
- **Trần tần suất**: `maxPerRoomPerHour` (Redis INCR + EXPIRE 1h) — van an toàn cuối, không phụ
  thuộc phán quyết tầng 2.
- **Thiếu `JEV_API_KEY`**: phễu TẮT hẳn cho mọi agent (log cảnh báo lúc boot). Không có phán
  quyết thì không nhặt câu nào.
- **Best-effort mọi chỗ**: gate/schedule hỏng chỉ mất một cơ hội chủ động giúp, không được làm
  rớt tin (throw ở gateway là nhả dedupe, channel gửi lại nguyên tin).

## Vận hành

- Poller đi chung nhịp `schedulerTickMs` (30s), cùng khung claim-trước-bắn với scheduler §8:
  nhiều instance thì ZREM ai thắng người đó xử lý.
- Tắt phễu một agent = xoá `proactive` khỏi profile; câu đang chờ trong Redis đến hạn sẽ rơi
  (poller tra spec lại lúc nhặt).
- Hàng chờ Redis giờ nhận MỌI tin qua guard cấu trúc (trước đây chỉ ~20% qua regex). Không phình:
  key theo `(channel, phòng, người hỏi)` nên tin sau đè tin trước, mỗi người trong một phòng chỉ
  chiếm một member.
- Chỉnh ngưỡng bằng log `[proactive] judge …` (mỗi phán quyết một dòng: nhặt/không, lý do, các
  xác suất). Đọc vài ngày rồi sửa `policy` trong profile agent.
- Việc còn lại (chưa làm): ghi phán quyết xuống bảng riêng để backtest có hệ thống (§14 §9);
  kill-switch per phòng (`proactive_enabled` trên `group_map`) nếu cần tắt nhóm nóng tính không
  cần deploy.
