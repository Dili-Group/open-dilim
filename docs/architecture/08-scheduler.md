# 8. Scheduler (cron — kiểm tra định kỳ)

Nguồn trigger theo **thời gian**, không phải người dùng. Cron **tái dùng nguyên pipeline**: tự sinh
Envelope (`source=cron`) → đẩy thẳng **broker ingress** → worker/agent/broadcast y hệt message thường.
KHÔNG path xử lý mới. Không qua gateway/ACK (không có caller ngoài — scheduler là producer nội bộ tin
cậy, dựng Envelope trực tiếp).

Dùng cho: quét đơn treo, nhắc hạn, health-check, báo cáo định kỳ — và **gộp cả approval-timeout sweep**
([mục 6](./06-approval.md)): timeout job = 1 cron job, không còn quét ad-hoc rải rác.

```
job def (Postgres, durable) ──▶ Redis ZSET (due-index theo nextRunAt)
                                      ▲
        poller tick (leader-lock) ────┘
          ZRANGEBYSCORE now → mỗi job đến hạn:
            1. dựng Envelope (dưới) → push broker ingress
            2. tính nextRunAt → ZADD lại (reschedule)
```

Envelope cron:
```
Envelope {
  msgId:  `cron:{jobId}:{scheduledTs}`,   // ◀ idempotent — chống double-fire
  conversationId: job.target,             // đích broadcast (staff channel / phòng)
  senderId: 'system:cron',
  channel:  job.channel,                  // chọn root agent Y HỆT message thường (§4)
  identity:  job.identity,                // service/user cấu hình — auth gate NHƯ thường
  source:   'cron',                       // ◀ phân biệt nguồn (vs message / approval)
  addressedToAgent: true,
  payload:  { task: job.task }            // "kiểm tra gì" — prompt hệ thống sinh
}
```

Job def: `{ id, schedule (cron/interval), channel, identity, task, target, enabled, nextRunAt, lastRunAt }`.
System job (approval-timeout, health-check) code-defined trong `defs/`; business check data-defined trong
DB (non-dev thêm, giống skills).

## 4 chốt

1. **Fire-once.** Nhiều instance/worker → 2 poller không được cùng bắn 1 job. Leader-lock (Redis) HOẶC
   pop atomic (`ZPOPMIN`/Lua) + idempotent `msgId` dedupe ở worker. Trùng tick → dedupe nuốt.
2. **Cron KHÔNG bypass quyền.** `channel` route qua bảng như thường, `identity` qua `auth` y hệt message. Job
   chạy dưới identity service/user cấu hình — không phải "quyền root". Tool WRITE vẫn gate theo identity.
3. **Execute idempotent.** Job làm WRITE (gửi cảnh báo, tạo ticket) → idempotent theo `msgId`; retry/tick
   trùng không nhân đôi. Write thật rủi ro vẫn qua `pending_action` ([mục 6](./06-approval.md)).
4. **Output có đích rõ.** Không ai "hỏi" → không reply-về-người-hỏi. Job def chỉ định `target` broadcast
   (staff channel / conversationId). Agent/recall như thường, chỉ khác điểm đến.

**Miss-fire:** instance down qua giờ chạy → khi lên, poller thấy `nextRunAt < now` → chạy **bù 1 lần**
(không replay mọi lần lỡ). Job nhạy thời điểm set cờ skip-to-next thay vì catch-up.

---

[← Mục lục kiến trúc](../ARCHITECTURE.md)
