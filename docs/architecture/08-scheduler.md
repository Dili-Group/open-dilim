# 8. Scheduler (cron — kiểm tra định kỳ)

Nguồn trigger theo **thời gian**, không phải người dùng. Cron **tái dùng nguyên pipeline**: tự sinh
Envelope (`source=cron`) → đẩy thẳng **broker ingress** → worker/agent/broadcast y hệt message thường.
KHÔNG path xử lý mới. Không qua gateway/ACK (không có caller ngoài — scheduler là producer nội bộ tin
cậy, dựng Envelope trực tiếp).

Dùng cho: quét đơn treo, nhắc hạn, health-check, báo cáo định kỳ — và **gộp cả approval-timeout sweep**
([mục 6](./06-approval.md)): timeout job = 1 cron job, không còn quét ad-hoc rải rác.

```
job def (Postgres, durable) ── next_run_at VỪA là due-index VỪA là ô CAS
                                      ▲
        poller tick (mọi instance) ───┘
          SELECT ... WHERE enabled AND next_run_at <= now()
          mỗi job đến hạn:
            1. tính nextRunAt kế tiếp từ cron expr (giờ VN)
            2. CAS: UPDATE ... WHERE next_run_at = <giá trị vừa đọc>  ◀ thua thì bỏ lượt
            3. thắng → dựng Envelope (dưới) → ghi history phòng → push broker ingress
```

**KHÔNG có Redis ZSET, không leader-lock.** Index `scheduler_jobs_due` đã là due-index, và CAS trên
`next_run_at` cho fire-once mạnh hơn lock (không có lock nào hết hạn giữa lúc đang bắn). ZSET là một
nguồn sự thật thứ hai phải giữ đồng bộ — chỉ đáng khi số job lớn tới mức query mỗi tick thành gánh nặng.

Envelope cron:
```
Envelope {
  msgId:  `cron:{jobId}:{scheduledTs}`,   // ◀ idempotent — scheduledTs là MỐC LỊCH, không phải now()
  conversationId: job.target,             // đích broadcast (phòng đại lý / staff channel)
  senderId: job.identity,                 // ◀ vai vẫn do AUTH resolve từ đây — job không có quyền sẵn
  channel:  job.channel,                  // chọn root agent + adapter egress Y HỆT message thường (§4)
  source:   'cron',                       // ◀ phân biệt nguồn (vs message / approval)
  isGroup:  true,                         // đích cron hiện đều là phòng nhóm
  addressedToAgent: true,
  text:     job.task,                     // "kiểm tra gì"
  mentions: [], ts: scheduledTs
}
```

**Ghi history TRƯỚC khi publish** (như gateway "ingest dày"): agent đọc việc-phải-làm từ history phòng
(`RootAgent.run` nhận `history`, không nhận Envelope), và worker coi history rỗng là lượt hỏng. Lượt cron
vào history với `role: "user"` — ghi `role: "agent"` thì model tưởng là lời của chính mình rồi không làm gì.

Job def: `{ id, schedule (cron 5 trường, giờ VN), channel, identity, task, target, enabled, nextRunAt, lastRunAt }`.
Business check data-defined trong DB (non-dev thêm, giống skills). Job mới thêm có `next_run_at = NULL` →
tick đầu chỉ ĐẶT LỊCH, không bắn.

Code: `src/scheduler/` — `schedule.ts` (cron→mốc kế tiếp, offset VN cố định +07:00), `repo.ts` (CAS claim),
`fire.ts` (Envelope + seed history), `poller.ts` (vòng tick). Nhịp quét: `SCHEDULER_TICK_MS` (mặc định 30s).

## Đặt việc: flash command `/lich` (nhân viên, trong nhóm)

Job KHÔNG cần gõ SQL. Nhân viên quản ngay trong nhóm — CRUD đủ, `src/flash-command/commands/lich.ts`:

```
/lich                              xem việc của nhóm này              (read)
/lich 17:00 gửi báo cáo cuối ngày  thêm việc, chạy mỗi ngày           (create)
/lich sua a1b2c3d4 18:30           đổi giờ                            (update)
/lich sua a1b2c3d4 <việc mới>      đổi mô tả việc                     (update)
/lich tat|bat a1b2c3d4             dừng tạm / chạy lại                (update)
/lich xoa a1b2c3d4                 xoá hẳn                            (delete)
```

Ba ràng buộc của lệnh này:

- **Mô tả việc là TEXT TỰ NHIÊN**, không phải tên kỹ thuật: nó chính là tin đi vào history phòng lúc
  tới giờ, agent đọc như yêu cầu của người dùng. Viết "gửi báo cáo cuối ngày", đừng viết "job_v2".
- **Phạm vi cứng theo phòng**: job gắn `(channel, nhóm đang gõ)`, và mã ngắn (8 ký tự đầu của id)
  chỉ có nghĩa trong nhóm đó — không nhóm nào sửa/xoá được việc của nhóm khác. Trần
  `MAX_JOBS_PER_GROUP` chặn gõ nhầm thành hàng chục tin tự động.
- **Gõ có dấu hay không đều được**: `/lịch xóa` = `/lich xoa`. Tên lệnh gấp dấu ngay ở `parseCommand`
  (`flash-command/normalize.ts`) nên luật này áp cho MỌI lệnh, không riêng `/lich`. Chỉ khoá tra cứu
  mới bỏ dấu — mô tả việc người dùng nhập giữ nguyên dấu.
- **Chỉ nhận giờ trong ngày** (`17`, `17h`, `17:00`, `17h30`), không nhận cron expr: người gõ là
  nhân viên, không phải người viết cron. Lịch phức tạp (theo thứ, theo tháng) đặt thẳng bằng SQL:

```sql
INSERT INTO scheduler_jobs (id, schedule, channel, identity, task, target)
VALUES (gen_random_uuid()::text, '0 8 * * 1', 'zalo', 'system:cron',
        'Gửi tổng kết tuần cho nhóm.', 'group-42');
```

Nhân viên không phải nhớ cú pháp: skill `lap-lich` (scope `dealer, operations`) dạy agent dịch câu
nói thường ("mỗi ngày 5h chiều gửi báo cáo") thành đúng dòng lệnh để copy, và chốt rõ **agent không
tự đặt lịch được** — không có tool nào tạo job, chỉ người gõ mới đặt được.

Đổi lịch (`/lich sua <mã> <giờ>`) và bật lại (`/lich bat <mã>`) đều reset `next_run_at = NULL` →
poller tính lại mốc đầu tiên. Không reset thì job bật lại sau một tuần tắt sẽ bắn bù ngay lập tức.

## 4 chốt

1. **Fire-once.** Nhiều instance → 2 poller không được cùng bắn 1 job. CAS trên `next_run_at`
   (`UPDATE ... WHERE next_run_at = <vừa đọc>`) cho đúng 1 người thắng; `msgId` idempotent + dedupe
   Redis (chung cửa sổ với ingest) là lớp chặn thứ hai. Claim TRƯỚC khi bắn: publish hỏng thì bỏ lượt
   đó và ghi log — báo cáo trùng vào nhóm tệ hơn báo cáo thiếu.
2. **Cron KHÔNG bypass quyền.** `channel` route qua bảng như thường, `identity` qua `auth` y hệt message. Job
   chạy dưới identity service/user cấu hình — không phải "quyền root". Tool WRITE vẫn gate theo identity.
3. **Execute idempotent.** Job làm WRITE (gửi cảnh báo, tạo ticket) → idempotent theo `msgId`; retry/tick
   trùng không nhân đôi. Write thật rủi ro vẫn qua `pending_action` ([mục 6](./06-approval.md)).
4. **Output có đích rõ.** Không ai "hỏi" → không reply-về-người-hỏi. Job def chỉ định `target` broadcast
   (staff channel / conversationId). Agent/recall như thường, chỉ khác điểm đến.

**Miss-fire:** instance down qua giờ chạy → khi lên, poller thấy `nextRunAt < now` → chạy **bù 1 lần**
(không replay mọi lần lỡ), rồi nhảy tới mốc kế tiếp tính từ *bây giờ*.

**Cron expr hỏng** (người soạn gõ sai vào DB): throw TRƯỚC claim → job giữ nguyên lịch cũ và kêu lại
mỗi tick cho tới khi có người sửa. Không tự tắt job: mất báo cáo mà không ai biết còn tệ hơn log ồn.

---

[← Mục lục kiến trúc](../ARCHITECTURE.md)
