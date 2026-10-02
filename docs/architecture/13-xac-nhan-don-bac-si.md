# 13. Agent ghi sổ XÁC NHẬN ĐƠN (nhóm bác sĩ)

- **Ngày:** 2026-09-10 (cập nhật 2026-09-21 sau khi triển khai)
- **Trạng thái:** ĐÃ triển khai §1–§4, §6–§7, §10 và adapter §5. Cổng STT thay bằng Jev — §0b.
  **Thu hẹp 02/10/2026: agent CHỈ GHI đăng ký** — §0c; các phần về kết quả/hàng đợi/tổng hợp/nhắc
  bên dưới là hồ sơ thiết kế, KHÔNG còn trong code. Chờ backend mở endpoint
  (hợp đồng: [13-xac-nhan-don-api.md](./13-xac-nhan-don-api.md)) và chờ id nhóm thật
  (`ZALO_XACNHAN_GROUP_ID`). §8 (việc treo) KHÔNG làm — xem "Chốt lại sau khi làm" bên dưới.
- **Nguồn nghiệp vụ:** "Quy trình xác nhận thông tin đơn hàng — DiLiM Supplement" (Ban Điều Hành,
  áp dụng cho Sale – Leader; xác nhận chuyên môn: BS Phan Hồng Sơn).
- **Ràng buộc đã chốt với người đặt hàng:**
  1. Dùng **tài khoản Zalo `zalo` (kênh đại lý) sẵn có** — không dựng acc/bridge mới.
  2. **Đúng MỘT nhóm** xác nhận. Không thiết kế cho N nhóm.
  3. **Nơi lưu dữ liệu để MỞ** — thiết kế theo port, chọn backend sau (§5).

---

## 0. Chốt lại sau khi làm (2026-09-21)

Ba chỗ thiết kế đoán khác thực tế, và một chỗ cố ý bỏ:

**Mẫu tin: `STT`, không phải `XN:`.** §3 đề xuất bắt sale gõ tiền tố mới `XN:`. Tin thật trong
nhóm đã có khuôn sẵn và ai cũng theo — mở đầu bằng `STT` rồi 5 mục đánh số:

```
STT: 8 NVH ( đã kí rule)
1, Tên KH: chị TRANG   94734
2, Tình trạng: …
3, Đã CHỐT; 2TCC                  ← có người ghi "Đã tư vấn", "Đã tư vấn gửi cb"
4, Lí do XN: hàng giả nhiều nên sợ …
5, Khung H XN: 12h                ← có người ghi "16-17h", "11-12h ngày 18/9"
```

Nên cổng mẫu gác ở chữ `STT` đầu dòng (bắt cả `STT: 8`, `Stt 2 :`, `Stt 1.`), không gác ở dấu
phân cách — mỗi người ngăn cách một kiểu. **Bóc 5 mục là việc của LLM, không phải regex**: regex
chỉ quyết định "tin này có phải một lượt không", còn đọc nghĩa thì để model.

**Khung giờ = khung khách XIN, không phải lúc sale gõ.** §7 giả định đăng ký phải nằm trong khung
11h–12h / 16h–17h. Thực tế sale đăng ký cả ngày (08:17, 14:17, 20:13) cho khung sắp tới. Nên
`dung_khung` = đăng ký có KỊP trước khi khung đó đóng hay không, chứ không phải "gõ trong khung".

**Nơi lưu: API DILIM** (§5 nhánh 2), chốt với người đặt hàng. Postgres của agent và Google Sheet
đều bỏ. Agent gọi `POST /agent/expert-verifications` của dilim-system (02/10/2026 — xem
[13b](./13-xac-nhan-don-api.md)); lỗi thì tool báo "chưa ghi được".

**§8 việc treo: KHÔNG làm.** `workflows/` sinh ra cho việc LIÊN nhóm (kho hỏi đại lý), ở đây hỏi
và trả lời cùng một phòng. Dùng phương án B như §8 đã chừa: `tong_hop_ngay` trả thẳng danh sách
dòng thiếu kết quả, một job `/lich` nhắc mỗi ngày.

**§9 job cron: đặt bằng `/lich` trong chính nhóm**, không code job riêng — scheduler đã có sẵn
đường đó. `/lich` chỉ chạy được bởi nhân viên/đại lý đã bind (sale guest không gõ được), và chỉ
đặt được lịch NGÀY (không lọc T2–T7). Chủ nhật job vẫn bắn nhưng sổ rỗng nên agent trả một câu
ngắn — chấp nhận được, đổi lại không phải thêm bảng job riêng.

## 0b. Cổng STT → Jev (2026-10-02)

Cổng regex `STT`/`KQ:` ở ingest bỏ sót đúng loại tin sổ cần nhất: tin lệch mẫu ("Khách Lan 55821
muốn BS gọi 16h…"), tin sửa ("khách Trang đổi sang chiều nhé"), tin báo kết quả không có tiền tố
`KQ:`. Lọt cổng = mất dòng sổ, mà mất im lặng. Nay **mọi tin có chữ** trong nhóm đều qua cổng
hai bậc: khuôn regex trước, Jev ([14](./14-proactive-jev-judge.md)) cho phần còn lại.

```
ingest (zalo.ts)   tin nhóm XN, có chữ, không @agent/lệnh, không phải tin của chính agent
                     → addressedToAgent=true + intentGate=true          (0 I/O, giữ đường nóng sạch)
worker (handler)   6c2: intentGate → worker/intake.ts
                     1. khớp khuôn `STT <số>` → chạy lượt, KHÔNG gọi Jev   (`KQ:` bỏ từ §0c)
                     2. lệch khuôn → Jev 1 câu noul `viec_cua_phong`
                          ≥ 0.5 → chạy lượt        < 0.5 → ignored "intake_judge"
                          Jev vắng/hỏng → ignored "intake_judge_unavailable"
```

| Quyết định | Vì sao |
|---|---|
| Jev ở **worker**, không ở ingest | ingest chạy trước 202, trong vùng đã mark dedupe — gọi mạng ở đó là làm chậm webhook và biến lỗi mạng thành nhả dedupe (14 §3) |
| Chấm **trước** bước ngân sách | phòng hết trần mà mỗi câu "ok em" đều nhận tin báo "hết ngân sách" là spam cả nhóm |
| **Khuôn trước, Jev sau** | soát 18 tin đăng ký thật 29/09–02/10: **18/18** mở bằng `STT <số>` (`STT:   3`, `Stt 4 MKA`, `STT 1: NVH`, `Stt 05 nvh(…`). Khớp khuôn thì chạy thẳng: rẻ, không phụ thuộc mạng, và tin mang tên khách + SĐT + bệnh KHÔNG phải đi sang TypeSafe |
| Jev hỏng → **bỏ** tin lệch khuôn | tin đúng khuôn đã qua bậc 1 nên Jev sập không làm mất tin đăng ký; tin lệch khuôn mất đúng như trước khi có cổng này |
| Tin `intentGate` **không gom burst** | gom theo PHÒNG: "ok em" của sale B 1s sau sẽ đè tin đăng ký của sale A, rồi lượt B bị chấm tán gẫu và bỏ — A mất tin |
| `@agent`/`/lệnh` **không** qua Jev | đường thoát khi Jev chấm sai |
| Loại tin khai bằng tiếng Việt (`intakeKinds` trong `dedicated-rooms.ts`) | cùng lối `capabilities` của phễu: thêm loại tin = thêm một dòng, không viết regex |
| `state` chỉ mang text + tên hiển thị | không senderId, không id nhóm. ⚠️ Tin lệch khuôn (đăng ký lệch mẫu, sửa/bổ sung) vẫn có thể mang tên khách / số → đi sang TypeSafe (14 §11: quyết định kinh doanh) |

**Ngưỡng 0.5 — đo trên `jev-1.13.0` ngày 02/10/2026**, 18 tin mẫu:

| nhóm | điểm |
|---|---|
| đăng ký (đúng mẫu, lệch mẫu), sửa/bổ sung, huỷ, báo kết quả (có và không `KQ:`), hỏi hàng đợi | **0.83–0.98** |
| "ok em", cảm ơn, chúc, họp team, than khách khó tính, emoji | **0.03–0.11** |
| "bác sĩ gọi chưa ạ" (mơ hồ) | 0.52 → chạy |

Khoảng trống 0.11–0.83 rộng nên vạch đặt giữa và nghiêng về phía CHẠY: chạy nhầm tốn một lượt
LLM, bỏ nhầm mất một dòng sổ. Chỉnh theo log `[intake] msg=… run=… viec_cua_phong=…`.

Mẫu thật 02/10 cũng lộ hai lỗ ở phía bóc trường, đã vá: lý do "gặp bác để hỏi thêm" lọt bộ lọc
chung chung (`chuan-hoa.ts` giờ bóc vỏ mở đầu rồi mới so); mục 3 "Đang dùng/Đã dùng" = khách đã
mua (`da_chot` true, soi case chưa hiệu quả) — ghi trong skill `dang-ky-xac-nhan`.

Chi phí: mọi tin có chữ KHÔNG khớp khuôn × ~1,4 VND (14 §10). Tin không đáng → bỏ trước LLM nên không
tốn token Claude/Gemini.

## 0c. Thu hẹp: chỉ ghi đăng ký (2026-10-02)

Chốt với người đặt hàng: agent **chỉ ghi đăng ký và báo lại kết quả ghi** (đã ghi + số thứ tự,
thiếu mục gì, hay chưa ghi được). Không đọc hàng đợi, không ghi kết quả cuộc gọi, không tổng hợp,
không báo cáo, không nhắc.

| Bỏ | Chỗ |
|---|---|
| tool `xem_hang_doi`, `chot_ket_qua`, `tong_hop_ngay` | `tools/impl/xacnhan/` — xoá file |
| `queue` / `settle` / `summary` trên `OrderConfirmPort` + adapter | `operational/types.ts`, `xac-nhan-api.ts` |
| endpoint `hang-doi`, `ket-qua`, `tong-hop` | [13b](./13-xac-nhan-don-api.md) |
| `VISION_TOOLS`, `DOC_TOOLS` khỏi profile | cổng ý định chỉ cho tin có chữ vào lượt |
| khuôn `KQ:` + loại tin "báo kết quả", "hỏi sổ" | `dedicated-rooms.ts` — không có tool thì đánh thức agent chỉ để nói "không làm được" là spam |
| job `/lich` tổng hợp + nhắc (§9) | không còn tool nào để job gọi |

**Mã đại lý (02/10/2026):** chữ cạnh STT (`VDD`, `nvh`, `TQT`) là mã đại lý, phải khớp hệ vận
hành mới ghi. `ghi_dang_ky` tra `GET /agent/dealers/lookup?code=` (sẵn có, khớp đúng không phân
biệt hoa thường, chỉ đại lý đang hoạt động) sau mọi kiểm tra tại chỗ; không có → không ghi, báo
sale sửa mã; lỗi tra → không ghi, KHÔNG đổ là mã sai. Không gập dấu (`VĐĐ` ≠ `VDD`): mã gõ lệch
hệ thống chính là thứ cần báo để sửa. Cần token scope `Dealer:read:all` — xem [13b](./13-xac-nhan-don-api.md).

Còn lại: `ghi_dang_ky` + bộ chung (`whoami`, nạp skill). Ai hỏi hàng đợi/kết quả → agent không
được đánh thức (Jev chấm ngoài phạm vi), hoặc nếu `@agent` thì trả một câu "leader theo dõi".

## 1. Agent này làm gì (và không làm gì)

Nó là **thư ký sổ của nhóm**, không phải bác sĩ, không phải sale.

| Làm | Không làm |
|---|---|
| Nhận tin đăng ký của sale, chấm đủ/thiếu trường, ghi thành một dòng sổ | Trả lời câu hỏi chuyên môn thay BS Sơn |
| Gác khung giờ, xếp hàng đợi, trả vị trí thứ tự | Gọi khách, tạo nhóm 3 người, bật camera |
| Ghi kết quả sau cuộc gọi (chốt / chưa chốt / huỷ) | Phán "sale mất đơn" hay "sale giữ đơn" |
| Nhắc dòng chưa cập nhật trước hạn 11h hôm sau, tổng hợp ngày cho leader | Kiểm tên/ảnh đại diện Zalo của sale, mời khỏi cộng đồng |
| | Tính và chuyển 10% lợi nhuận, tính hoa hồng |

Ranh giới này là **cố ý**: mọi thứ cột phải là dữ kiện agent tự quan sát được trong nhóm. Mọi thứ
cột trái là phán quyết của người — agent chỉ cung cấp số liệu để người phán.

## 2. Vấn đề #1 — định tuyến: kênh `zalo` đang thuộc agent Dealer

Tầng thô hiện tại (`agents/router.ts`) route theo **channel**: `zalo → AgentType.Dealer`. Nhóm
xác nhận nằm trên chính tài khoản đó ⇒ mọi tin của nhóm sẽ rơi vào agent đại lý — sai persona, và
**agent đại lý cầm `ORDER_TOOLS`/`DEALER_TOOLS`** (đọc đơn, ví, chiết khấu theo đại lý chủ phòng).

### Vì sao KHÔNG dùng sub-agent

`SubAgent` chọn theo **task trong một root**, không theo phòng. Nếu nhét nghiệp vụ xác nhận thành
sub của Dealer thì bộ tool + persona đại lý vẫn đi theo sang nhóm nội bộ này, và ngược lại tool
ghi sổ xác nhận có mặt ở mọi nhóm đại lý. Sai cả hai chiều.

### Đề xuất: mở tầng thô thành `(channel, groupId)`

```ts
// agents/router.ts
export function resolveAgentType(channel: string, groupId?: string): AgentType | undefined
```

Thứ tự tra: **phòng chuyên dụng trước, bảng channel sau.**

```
groupId có, và (channel, groupId) là PHÒNG CHUYÊN DỤNG  → agentType của phòng đó
còn lại                                                  → CHANNEL_AGENT[channel]  (như cũ)
```

Vẫn giữ nguyên ba tính chất của tầng thô: **code quyết, deterministic, 0 token**, và **không cấp
quyền** (quyền vẫn do identity). Chỉ khác: khoá định tuyến mịn thêm một bậc.

**Id nhóm nằm ở env, không phải hằng trong code** — khác bảng `CHANNEL_AGENT`. Lý do: "kênh nào
phục vụ ai" là POLICY (review được, test được); còn "nhóm xác nhận có id `1234…`" là **dữ kiện hạ
tầng của một lần triển khai** (tạo lại nhóm là đổi id), cùng loại với `agentUid`/`webhookSecret`.

```
# .env
ZALO_XACNHAN_GROUP_ID=      # thiếu env = agent này TẮT, nhóm đó trả về agent Dealer như hiện tại
```

`CONFIG.xacnhan = { channel: "zalo", groupId }` — `undefined` khi thiếu env (fail-closed, giống
`zaloOaChannel`).

### Chỗ phải sửa theo

| File | Sửa gì |
|---|---|
| `src/agents/router.ts` | thêm tham số `groupId`, thêm bảng phòng chuyên dụng |
| `src/worker/handler.ts:41` và `:376` | truyền `envelope.isGroup ? envelope.conversationId : undefined` |
| `src/proactive/spec.ts:15` | `proactiveSpecFor(channel, groupId)` — nếu không, phễu proactive của Dealer chạy nhầm trong nhóm này |
| `src/proactive/verify.ts:44` | như trên |
| `src/agents/types.ts` | `AgentType.OrderConfirm = "xac-nhan-don"` |
| `src/agents/registry.ts` | 1 dòng `xacNhanProfile` |
| `docs/architecture/04-agent-routing.md` | cập nhật mô tả tầng thô |

## 3. Vấn đề #2 — trigger gate: tin đăng ký không @mention agent

`message-ingest/ingestor.ts::isAddressed` hiện tại: trong nhóm chỉ `/lệnh` hoặc `@agent` mới thành
một lượt; tin còn lại chỉ nuốt vào history. Sale đăng ký sẽ **không** mention agent.

Ba đường, chọn đường 3:

| | Cách | Vì sao loại / chọn |
|---|---|---|
| 1 | Bắt sale `@agent` mỗi lần đăng ký | Đổi thói quen của mấy chục sale; quên mention = **mất dòng sổ**, mà mất im lặng |
| 2 | Nhóm chuyên dụng ⇒ **mọi** tin đều là một lượt | Chi phí LLM nổ theo tin tán gẫu, và agent nói leo vào mọi câu |
| 3 | **Nhóm chuyên dụng + cổng mẫu (regex, 0 token)** | ✅ Tin khớp mẫu đăng ký/kết quả mới thành lượt; tin khác vẫn vào history làm ngữ cảnh |

```ts
// ingestor.ts — mở rộng, KHÔNG thay hành vi cũ
isAddressed(...)                                   // mention / lệnh — giữ nguyên
  || (isDedicatedRoom(channel, groupId) && DEDICATED_TRIGGERS.some((re) => re.test(text)))
```

Mẫu tin (chính là "đúng mẫu" mà quy trình §5 bước 2 đã đòi, chỉ thêm tiền tố cho máy nhận ra):

```
XN: <Tên khách> | <5 số cuối SĐT> | <Sản phẩm> | <Vấn đề khách cần bác sĩ giải đáp>
KQ: <5 số cuối> | đã chốt|chưa chốt|huỷ | <tình trạng khách> | <liệu trình>
```

Trigger: `/^\s*(xn|xác nhận|xac nhan)\s*[:：]/i`, `/^\s*(kq|kết quả|ket qua)\s*[:：]/i`.
`@agent` và `/lệnh` **luôn** vào — đó là đường thoát khi sale gõ lệch mẫu.

Hai đầu phải khớp: cổng ở **ingest** (đặt vạch) và bảng phòng chuyên dụng ở **router** (soi vạch)
đọc cùng một `CONFIG.xacnhan`. Lệch nhau = tin vào tới worker rồi bị agent đại lý trả lời.

## 4. Vòng đời một dòng sổ

```
sale gõ "XN: …"
   │
   ├─ thiếu trường / lý do chung chung ──▶ trang_thai = thieu_thong_tin
   │                                        agent trả lời TẠI CHỖ thiếu gì, KHÔNG ghi vào hàng đợi
   │
   └─ đủ ──▶ dang_ky ──▶ [gác khung giờ] ──▶ trong_hang (thứ tự N của slot)
                                │
                     sai khung / Chủ nhật ──▶ trong_hang nhưng dung_khung=false
                                              xếp SAU mọi dòng đúng khung của slot kế
                                │
                       sale gõ "KQ: …" ──▶ da_chot | chua_chot | huy   (đóng dòng)
                                │
                       quá 11h hôm sau chưa có KQ ──▶ agent nhắc đích danh sale
```

**Lý do chung chung bị chặn** (quy trình §6): `tư vấn thêm`, `hỏi thêm`, `hỗ trợ thêm` và biến thể
— chặn bằng danh sách đen + độ dài tối thiểu, ở **tool** chứ không chỉ ở prompt (prompt là gợi ý,
tool là hàng rào).

**Case "uống chưa hiệu quả"** (§7) đòi thêm 5 trường: tình trạng trước, tình trạng hiện tại, liệu
trình đã dùng, thời gian sử dụng, số lần chăm sóc. Agent phát hiện theo ngữ nghĩa (prompt/skill),
rồi tool yêu cầu đủ 5 trường mới ghi.

## 5. Nơi lưu — CHỪA MỞ, thiết kế theo port

Đây là phần cố ý chưa chốt. Hợp đồng nằm ở `src/operational/types.ts` (cùng chỗ với `OrderPort`,
`DealerPort`), **adapter chọn sau**:

```ts
export interface OrderConfirmPort {
  /** GHI một dòng đăng ký. Trả về dòng đã ghi kèm thứ tự trong hàng đợi. */
  register(input: NewRegistration, signal?: AbortSignal): Promise<Registration>;
  /** ĐỌC hàng đợi một ngày (lọc theo slot nếu có). */
  queue(input: { day: string; slot?: SlotId }, signal?: AbortSignal): Promise<readonly Registration[]>;
  /** GHI kết quả sau cuộc gọi — đóng dòng. */
  settle(input: SettleInput, signal?: AbortSignal): Promise<Registration>;
  /** ĐỌC các dòng đã xác nhận mà CHƯA có kết quả (đầu vào của tin nhắc). */
  unsettled(input: { day: string }, signal?: AbortSignal): Promise<readonly Registration[]>;
  /** ĐỌC tổng hợp ngày cho leader đối soát. */
  summary(input: { day: string }, signal?: AbortSignal): Promise<DaySummary>;
}
```

Trường của một `Registration` (đủ cho cả bảng §11 lẫn bảng leader §12 của quy trình):

```
id, ngay, slot, dung_khung, thu_tu
sale_sender_id, sale_ten                  ← từ identity, LLM KHÔNG truyền vào được
khach_ten, sdt_5_cuoi, san_pham, ly_do
lieu_trinh?, tinh_trang_truoc?, tinh_trang_hien_tai?, thoi_gian_dung?, so_lan_cham_soc?
trang_thai, ket_qua?, ghi_chu?
msg_id_nguon, tao_luc, cap_nhat_luc       ← provenance: truy được về đúng tin gốc
```

Ba adapter khả dĩ, **đổi 1 file, không đụng tool/agent**:

| Adapter | Khi nào chọn | Giá phải trả |
|---|---|---|
| `SqlOrderConfirmRepo` (Postgres của agent) | muốn chạy được ngay, agent làm chủ dữ liệu | thêm migration `ALTER` viết tay (0001 chỉ `CREATE IF NOT EXISTS`) — xem CLAUDE.md |
| `AgentApiOrderConfirm` (`/agent/*` DILIM) | muốn số nằm chung hệ vận hành, leader xem trên web | chờ backend mở endpoint |
| `SheetsOrderConfirm` | giữ nguyên thói quen bảng "XÁC NHẬN KHÁCH HÀNG DR SƠN" | cần service account Google, và sheet không phải nguồn sự thật giao dịch |

Nối vào `AgentDeps` theo đúng quy ước sẵn có: `readonly orderConfirm?: OrderConfirmPort` —
`undefined` = chưa nối ⇒ **tool trả lỗi nghiệp vụ, không chặn boot**. Nhờ vậy §1–§4 và §6–§9 làm
được và chạy thật (agent nói "chưa nối hệ thống") trước khi chốt backend.

## 6. Bộ tool — `src/tools/impl/xacnhan/`, mỗi tool một file

| Tool | Chiều | Việc | Hàng rào trong tool |
|---|---|---|---|
| `ghi_dang_ky` | GHI | validate đủ trường + 5 số cuối + lý do không chung chung → ghi dòng, trả thứ tự & slot | phòng phải là nhóm xác nhận (server-side); `sale_sender_id` ép từ `identity.senderId` |
| `xem_hang_doi` | ĐỌC | hàng đợi hôm nay theo thứ tự | như trên |
| `chot_ket_qua` | GHI | ghi chốt/chưa chốt + tình trạng + liệu trình | chỉ **chính sale đã đăng ký dòng đó**, hoặc nhân viên (`identity.role`) |
| `tong_hop_ngay` | ĐỌC | số liệu ngày + danh sách dòng thiếu kết quả | như trên |

Không tool nào nhận tham số "nhóm nào" hay "sale nào" — hai thứ đó lấy server-side. Cho model tự
khai là mở đường ghi dòng của sale này sang tên sale khác.

Khai vào profile: `XACNHAN_TOOLS`, cạnh `COMMON_TOOLS` + `VISION_TOOLS` (sale hay chụp màn hình).
**Không** khai `ORDER_TOOLS`/`DEALER_TOOLS`: nhóm này không thuộc đại lý nào.

## 7. Gác khung giờ

Policy, để **hằng trong code** (`src/tools/impl/xacnhan/khung-gio.ts`) — không phải env:

```
T2–T7: 11:00–12:00 (slot "trua"), 16:00–17:00 (slot "chieu")
CN   : OFF
```

Mốc giờ tính theo **giờ VN**, không `Date.getHours()` (server chạy UTC lệch 7 tiếng). Dùng lại
đúng lối đã có: `Intl` như `usage/budget.ts::usageDay`, hoặc `VN_UTC_OFFSET_MINUTES` ở
`scheduler/schedule.ts`.

Ngoài khung **không từ chối** — quy trình §5 nói rõ là "xác nhận sau các trường hợp đúng giờ" ⇒
ghi với `dung_khung=false` và xếp sau. Từ chối thẳng là làm mất dòng sổ.

## 8. Chốt kết quả sau cuộc gọi — dùng VIỆC TREO (§6) hay scheduler?

Khoảng cách giữa lúc xác nhận và lúc sale báo kết quả là **giờ → ngày**. Đúng hình dạng của
`workflows/` (`WorkflowDef` = data, thêm 1 file `defs/xac-nhan-ket-qua.ts` + 1 dòng register, không
thêm bảng, không thêm tool).

Lợi: khối `pending` được ghép vào ngữ cảnh nên câu "KQ: …" đến 2 ngày sau vẫn khớp đúng dòng.

⚠️ **Phải kiểm trước khi cam kết**: ở đây `origin` và `target` là **cùng một phòng** (agent hỏi và
được trả lời trong chính nhóm xác nhận), trong khi `workflows/` sinh ra cho việc liên-nhóm. Nếu
engine không chịu same-room, rơi về phương án B: `unsettled(day)` + một cron nhắc (§9) — đơn giản
hơn, chỉ mất khối ngữ cảnh pending.

## 9. Nhắc + tổng hợp — `scheduler/`

Hai job cron, bắn `Envelope source="cron"` vào chính nhóm; agent chạy lượt và gọi `tong_hop_ngay`:

| Job | Lịch (giờ VN) | Nội dung |
|---|---|---|
| `xacnhan-tong-hop` | 17:05, T2–T7 | tổng hợp ngày cho leader + liệt kê dòng chưa có kết quả |
| `xacnhan-nhac-capnhat` | 10:30, T3–CN | nhắc đích danh sale còn nợ kết quả của **hôm trước**, hạn 11h |

10:30 chứ không phải 11:00 vì hạn quy trình §11 là **trước 11h** — nhắc đúng lúc hết hạn là nhắc muộn.

## 10. Persona, skill, trí nhớ, ngân sách

- **Prompt** `XACNHAN_PROMPT` (`agents/prompts.ts`): thư ký sổ. Cấm: tư vấn chuyên môn, đoán tình
  trạng bệnh, hứa giờ BS gọi, bình luận sale làm tốt/kém. Trả lời **ngắn, một dòng xác nhận** —
  nhóm đông người, agent nói dài là spam.
- **Skill** `dang-ky-xac-nhan` (`skills/defs/`): mẫu tin, tiêu chí "lý do chính đáng" vs chung chung,
  case chưa-hiệu-quả 5 trường, câu từ chối khi thiếu.
- **memorySpec**: `internalOpsSpec` (nhớ VIỆC, không nhớ sở thích khách). `directOnly: false`.
- **Ngân sách** (`usage/budget.ts`): **không** để `null` như các nhóm nội bộ khác. Nhóm này đông và
  mở rộng theo số sale ⇒ đặt trần rộng (đề xuất `20_000` VND/ngày) để có phanh, rồi chỉnh theo số đo thật.
- **Phễu proactive**: **tắt**. Cổng mẫu ở §3 đã là đường vào; thêm phễu nữa là agent nhảy vào mọi
  câu tán gẫu trong nhóm.

## 11. Thứ tự triển khai (mỗi bước có mốc kiểm được)

1. **Kiểu + policy thuần** — `OrderConfirmPort`, `khung-gio.ts`, hàm validate đăng ký.
   *Verify:* `bun test` — test thuần cho khung giờ (kể cả CN, kể cả biên 11:00/12:00) và cho bộ lọc lý do chung chung.
2. **Định tuyến + cổng mẫu** — §2, §3.
   *Verify:* test router (`zalo` + group lạ → `dealer`; `zalo` + đúng group → `xac-nhan-don`), test `isAddressed` cho cả 3 dạng tin.
3. **Profile + prompt + skill + 4 tool, port để `undefined`.**
   *Verify:* chạy thật trong một nhóm nháp — gõ "XN: …", agent phải trả đúng câu "chưa nối hệ thống", và **không** trả lời tin tán gẫu.
4. **Chốt adapter lưu trữ** (§5) → migration/endpoint.
   *Verify:* một dòng đi trọn vòng đời trên DB thật: đăng ký → hàng đợi → KQ → tổng hợp.
5. **Scheduler jobs (+ workflow def nếu §8 phương án A đứng được).**
   *Verify:* hạ mốc giờ xuống vài phút, xem tin nhắc bắn đúng phòng, đúng người.

## 12. Chỗ dễ hỏng

| Rủi ro | Triệu chứng | Cách chặn |
|---|---|---|
| Nhóm bị tạo lại → đổi group id | Agent **câm lặng**, không lỗi gì | Log rõ ở boot: id nhóm đang gác; thêm `/whoami` trong nhóm trả về "đang gác nhóm xác nhận" |
| Sale gõ lệch mẫu | Không vào phễu ⇒ mất dòng sổ, mất im lặng | Trigger nhận nhiều biến thể; ghim tin mẫu; `@agent` luôn vào |
| Sale gửi lại tin đăng ký | Dòng trùng, hàng đợi sai thứ tự | Khoá tự nhiên `(ngay, sdt_5_cuoi, sale_sender_id)` → cập nhật thay vì chèn mới |
| Trùng 5 số cuối trong ngày | Ghi kết quả vào nhầm dòng | `chot_ket_qua` phát hiện trùng → hỏi lại tên khách, không tự chọn |
| Agent nói leo trong nhóm đông | Sale khó chịu, tốn tiền | Cổng mẫu hẹp + prompt cấm bình luận + trần ngân sách §10 |
| Env thiếu → nhóm rơi về agent Dealer | Agent đại lý trả lời trong nhóm nội bộ | Fail-closed đã có; thêm test cho nhánh `groupId === undefined` |

## 13. Ngoài phạm vi lần này

Tên/ảnh Zalo của sale, cuộc gọi 3 bên và camera, phán quyết giữ đơn / mất đơn (§8–§10 quy trình),
10% lợi nhuận cho BS Sơn (§13), hoa hồng leader (§12). Agent chỉ **ghi dữ kiện và tổng hợp**; ai
được đơn, ai bị mời khỏi cộng đồng vẫn do người quyết.
