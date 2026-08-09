# DiLiM — Landing Page Plan & Copy

**Sản phẩm:** hệ thống multi-agent vận hành đơn hàng của DiLiM
**Thương hiệu trên page:** **DiLiM** (không dùng tên nội bộ nào khác)
**Audience chính:** đại lý tiềm năng (chủ shop online, KOL bán hàng, người đang tìm nguồn sỉ)
**Audience phụ:** đại lý hiện hữu (giữ chân), ứng viên tuyển dụng, đối tác
**Framework:** PAS làm xương sống + StoryBrand overlay (đại lý = hero, DiLiM = guide)
**CTA kép:** `Đăng ký làm đại lý` (primary) · `Chat thử agent ngay` (secondary, deep-link Zalo OA)

---

## 0. Định vị & lý do

Đối thủ nguồn sỉ nào cũng nói "hỗ trợ tận tâm". Không ai chứng minh được. DiLiM chứng minh bằng
cách **vẽ ra bộ máy** — 6 agent, ai lo việc gì, tin nhắn đi qua đâu, ai duyệt trước khi động vào
tiền. Đại lý không cần hiểu kỹ thuật; họ chỉ cần cảm giác: *"chỗ này có hệ thống thật, không phải
một bạn admin trả lời khi rảnh."*

Kiến trúc chính là USP. Nên khối kiến trúc **không** nằm ở footer — nó là section 5 của page.

**Tagline đề xuất** (dùng ở eyebrow hero + OG description):
- `DiLiM — Hệ vận hành luôn mở` ← đề xuất
- `DiLiM — Nguồn sỉ có hệ thống`
- Không tagline, chỉ logo DiLiM (nếu brand đã đủ nhận diện)

---

## 1. Cấu trúc page (thứ tự scroll)

| # | Section | Mục tiêu | Trạng thái |
|---|---------|----------|------------|
| 1 | Hero | Hook + CTA kép | ✅ có chòm 6 agent + màn mở đầu |
| 2 | Trust bar | Chặn nghi ngờ ngay | ✅ số thật, đếm lên |
| 3 | Problem | Chạm đau (PAS: P+A) | ✅ 3 kịch bản |
| 4 | Gặp 6 agent | Giải pháp (PAS: S) | ✅ card grid + 3 điểm khác biệt |
| 5 | **Kiến trúc sống** | USP — khoe bộ máy | ⬜ sơ đồ interactive, điểm nhấn của page |
| 6 | Cách hoạt động | 3 bước | ⬜ |
| 7 | Agent làm được gì | 8 skill thật | ⬜ dùng đúng câu đại lý hay nhắn |
| 8 | An toàn & kiểm soát | Diệt objection "AI làm bậy" | ⬜ quan trọng — đừng cắt |
| 9 | Social proof | Bằng chứng | ⬜ chờ testimonial + screenshot |
| 10 | FAQ | 7 objection | ⬜ accordion |
| 11 | Final CTA | Chốt | ⬜ risk reversal |
| 12 | Footer | Pháp lý + liên hệ | ✅ |

---

## 2. COPY ĐẦY ĐỦ

Placeholder `{{...}}` = số liệu bạn điền.

### ════════ 1. HERO ════════

**Eyebrow:** `DiLiM · Hệ vận hành luôn mở`

**Headline (chính — đề xuất):**
> # Đơn của bạn có người trực. Kể cả 2 giờ sáng.

**Sub-headline:**
> DiLiM vận hành bằng {{SO_AGENT}} agent AI chuyên trách — tra đơn, báo hết hàng, chốt sổ cuối
> ngày, giục đơn hoả tốc. Nhắn là có trả lời, không chờ giờ hành chính, không "để em hỏi lại".

**CTA primary:** `Đăng ký làm đại lý`
**CTA secondary:** `Chat thử agent ngay →` *(deep-link Zalo OA, mở thẳng cửa sổ chat)*

**Micro-copy dưới nút:** `Miễn phí. Không cần nhập gì trước khi chat.`

**Headline thay thế để A/B:**
- B: `Hỏi lúc nào cũng có người trả lời. Vì đó không phải người.`
- C: `{{SO_DAI_LY}} đại lý. {{SO_DON_NGAY}} đơn mỗi ngày. Không ai phải chờ trả lời.`

---

### ════════ 2. TRUST BAR ════════

Dải ngang dưới hero, 4 con số:

| `{{SO_DAI_LY}}+` | `{{SO_DON_NGAY}}` | `{{THOI_GIAN_PHAN_HOI}}` | `24/7` |
|---|---|---|---|
| đại lý đang chạy | đơn xử lý mỗi ngày | thời gian trả lời trung bình | agent luôn trực |

> Quy tắc: chỉ điền số **thật**. Một con số bịa bị bắt bài là mất sạch phần "minh bạch" mà cả
> page đang xây.

---

### ════════ 3. PROBLEM (PAS: Problem + Agitate) ════════

**Heading:**
> ## Bán hàng thì dễ. Chờ câu trả lời mới mệt.

**Lead:**
> Bạn không sợ bán ế. Bạn sợ khách hỏi "đơn em tới đâu rồi" mà bạn không biết trả lời sao.

**3 kịch bản (card, giọng thật của đại lý):**
*Icon Lucide: `clock` · `package-x` · `receipt-text` — line 24px, đơn sắc, không emoji (design-system §7).*

**22:14 — Đơn nằm im 3 ngày**
> Khách nhắn hỏi lần thứ tư. Bạn nhắn vào nhóm. Nhóm im. Sáng mai mới có người đọc.
> Đến lúc biết lý do thì khách đã huỷ.

**Hết hàng mà không ai báo**
> Bạn lên đơn, khách chuyển khoản xong. Ba ngày sau mới biết trong đơn có món hết hàng.
> Người xin lỗi khách là bạn, không phải kho.

**Cuối tháng không khớp sổ**
> Đơn xuất bao nhiêu, hoàn về bao nhiêu, phải chuyển bao nhiêu tiền — mỗi thứ nằm một nơi.
> Bạn ngồi cộng tay lúc 11 giờ đêm, và vẫn không chắc đúng.

**Agitate (câu chốt section):**
> Không phải người hỗ trợ tệ. Là vì họ ngủ, họ nghỉ lễ, họ đang bận 40 đại lý khác.
> Bạn thì cần câu trả lời **ngay lúc khách đang hỏi**.

---

### ════════ 4. SOLUTION — GẶP 6 AGENT ════════

**Heading:**
> ## Không phải một con bot. Là một đội.

**Lead:**
> Mỗi nhóm việc trong DiLiM có một agent riêng — prompt riêng, quyền riêng, trí nhớ riêng.
> Giống một công ty có phòng ban, chỉ khác là không phòng nào nghỉ trưa.

**Card grid (6 agent — đúng như hệ thống đang chạy):**

| Agent | Icon Lucide | Trực ở đâu | Lo việc gì cho bạn |
|-------|-------------|-----------|---------------------|
| **Đại lý** | `shopping-bag` | Nhóm Zalo của chính bạn | Tra đơn, huỷ đơn, hỏi tiền, xin video đóng gói, hết hàng, chiết khấu |
| **Vận hành** | `settings-2` | Nhóm Sales Admin | Điều phối đơn, xử lý ca khó, đặt lịch việc tự động |
| **Kho** | `warehouse` | Nhóm kho | Đọc mã vận đơn hoàn về, truy đơn hoàn đó của ai |
| **Lãnh đạo** | `chart-no-axes-column` | Nhóm ban giám đốc | Số liệu để ra quyết định |
| **Trợ lý riêng** | `user-round` | Chat 1-1 | Việc cá nhân, không đụng dữ liệu nhóm |
| **Điều phối** | `compass` | Nền | Đọc tin của bạn, giao đúng agent chuyên môn |

**3 điểm khác biệt (dưới grid):**

**Agent nhớ bạn.**
Không phải nhớ nguyên đoạn chat — hệ thống chắt lọc điều đáng nhớ rồi lưu lại theo đúng nhóm của
bạn. Lần sau bạn không phải kể lại từ đầu. Nhóm này không đọc được gì của nhóm kia.

**Agent tự làm việc, không chỉ trả lời.**
Tra dữ liệu thật trong hệ thống, mở quy trình xử lý, hẹn giờ chạy lại. Không phải chatbot đọc kịch bản.

**Agent chủ động nhắn trước.**
5 giờ chiều tự gửi báo cáo chốt ngày. Đơn kẹt tự báo. Bạn không phải nhớ đi hỏi.

---

### ════════ 5. KIẾN TRÚC SỐNG (section chủ lực) ════════

**Heading:**
> ## Đây là toàn bộ bộ máy. Chúng tôi không giấu gì.

**Lead:**
> Hầu hết nơi khác nói "chúng tôi hỗ trợ tốt". Chúng tôi vẽ luôn ra cho bạn xem tin nhắn của bạn
> đi qua đâu, ai xử lý, ai duyệt trước khi động tới đơn và tiền.

**Sơ đồ interactive** — dựa trên `docs/dilim-architecture.excalidraw` và `docs/arch.png`, vẽ lại
bản gọn cho người không kỹ thuật, 3 tầng:

```
   BẠN NHẮN                XỬ LÝ                        TRẢ LỜI
   ────────                ─────                        ───────
   Zalo nhóm  ──────▶  Nhận & xác nhận ngay  ──▶  Đội xử lý (agent chạy song song)
   đại lý              (không bắt bạn chờ)         · biết bạn là ai → mở đúng quyền
                                                   · nhớ việc cũ của nhóm bạn
                                                   · tra dữ liệu đơn/kho/công nợ thật
                                                   · việc nhạy cảm → chờ người duyệt
                                                        │
   Bạn nhận  ◀───────────────────────────────────────────┘
   trả lời                   Hẹn giờ (báo cáo cuối ngày, nhắc đơn) ──▶ quay lại đội xử lý
```

**4 chú thích (hover trên node, viết cho người thường):**

- **Nhận ngay, không bắt chờ** — tin của bạn được ghi nhận tức thì rồi mới xử lý. Hệ thống bận
  cách mấy cũng không nuốt mất tin nhắn.
- **Biết bạn là ai** — hệ thống nhận ra bạn là đại lý hay nhân viên từ chính tài khoản Zalo, rồi
  mới mở quyền tương ứng. Vào nhầm nhóm cũng không xem được dữ liệu không phải của bạn.
- **Nhớ theo nhóm** — trí nhớ gắn với nhóm của bạn. Không rò sang đại lý khác. Không bao giờ.
- **Có người gác** — việc đụng tới tiền, chiết khấu, huỷ đơn đều dừng lại chờ nhân viên duyệt.
  Agent không tự quyết.

**Câu chốt section:**
> Bạn không cần hiểu sơ đồ này. Bạn chỉ cần biết: **nó có thật, và nó chạy kể cả khi không ai
> thức.**

**Link phụ (nhỏ, dưới sơ đồ):** `Xem tài liệu kiến trúc đầy đủ →`

---

### ════════ 6. CÁCH HOẠT ĐỘNG — 3 BƯỚC ════════

**Heading:** `## Ba bước. Không cài app, không học phần mềm.`

*Icon Lucide: `handshake` · `message-circle` · `zap`.*

**Bước 1 — Đăng ký, có nhóm riêng**
Ký hợp đồng xong, DiLiM mở một nhóm Zalo riêng cho bạn. Agent có mặt sẵn trong đó.

**Bước 2 — Nhắn như nhắn người thật**
"Đơn ABC tới đâu rồi", "còn hàng son này không", "chị đang mấy phần trăm chiết khấu".
Không cú pháp, không lệnh, không menu.

**Bước 3 — Agent tra thật rồi trả lời**
Đọc dữ liệu đơn hàng, kho, công nợ trong hệ thống rồi trả lời. Việc cần duyệt thì chuyển
nhân viên và báo lại bạn.

**CTA giữa trang:** `Chat thử ngay — không cần đăng ký`

---

### ════════ 7. AGENT LÀM ĐƯỢC GÌ (8 skill thật) ════════

**Heading:** `## Những việc bạn hay phải chờ. Giờ hỏi là có.`

Grid 8 ô — mỗi ô mở đầu bằng **đúng câu đại lý hay nhắn**:

| Bạn nhắn | Agent làm |
|----------|-----------|
| *"Đơn ABC tới đâu rồi?"* | Tra trạng thái thật, báo đơn đang nằm khâu nào |
| *"Đi giúp chị gấp, khách đang đợi"* | Kiểm tra đúng khâu đơn đang kẹt rồi báo lại mốc thời gian thật |
| *"Còn hàng son đỏ không em?"* | Tra tồn kho, báo hàng về khi nào, hỏi bạn muốn giữ hay huỷ đơn |
| *"Chị đang mấy phần trăm?"* | Báo bậc chiết khấu hiện tại + còn thiếu gì để lên bậc |
| *"Chốt sổ hôm nay giúp chị"* | Đơn xuất, đơn hoàn, tổng tiền phải thanh toán — gửi ngay |
| *"Quên mật khẩu app rồi"* | Chỉ từng bước + gửi link tài liệu chính thức |
| *"Gắn API Key PosCake sao?"* | Hướng dẫn lấy API Key, gắn webhook để đơn tự về hệ thống |
| *"5h chiều nhắc chị chốt đơn"* | Đặt lịch chạy tự động, tự nhắn đúng giờ mỗi ngày |

**Câu dưới grid:**
> Nhóm kho có agent riêng đọc mã vận đơn hoàn về và truy ra đơn đó của ai — nên hàng hoàn của bạn
> không bị trôi.

---

### ════════ 8. AN TOÀN & KIỂM SOÁT ════════

> Đừng cắt section này. Objection lớn nhất của đại lý với AI là *"lỡ nó làm bậy đơn của tôi thì
> sao"*. Trả lời thẳng ở đây rẻ hơn trả lời từng người qua sales.

**Heading:** `## AI không được tự quyết chuyện tiền bạc.`

| Icon Lucide | | |
|---|---|---|
| `shield-check` | **Việc nhạy cảm phải có người duyệt** | Huỷ đơn, nâng chiết khấu, đụng công nợ — agent dừng lại chờ nhân viên xác nhận rồi mới chạy |
| `layout-grid` | **Dữ liệu tách theo nhóm** | Trí nhớ và dữ liệu gắn chặt vào nhóm của bạn. Đại lý khác không thấy được gì của bạn |
| `id-card` | **Quyền theo người, không theo nhóm** | Hệ thống xác định bạn là ai từ tài khoản Zalo. Vào nhầm nhóm cũng không mở thêm quyền nào |
| `eye` | **Việc gì cũng có dấu vết** | Mỗi thao tác được ghi lại, truy ngược được ai làm gì lúc nào |
| `user-round-check` | **Luôn còn người thật** | Agent không thay người. Ca khó được chuyển thẳng cho nhân viên vận hành |

---

### ════════ 9. SOCIAL PROOF ════════

**Heading:** `## Đại lý đang dùng nói gì`

*Cấu trúc 3 testimonial — thay bằng lời thật, giữ nguyên khuôn:*

> "Trước 10 giờ tối khách hỏi đơn là em chịu, sáng mai mới trả lời được. Giờ hỏi phát ra ngay,
> khách không kịp khó chịu."
> — **{{TEN}}**, đại lý {{TINH_THANH}}, {{SO_THANG}} tháng cùng DiLiM

> "Cái em thích nhất là 5 giờ chiều tự gửi chốt sổ. Không phải đi hỏi, không phải cộng tay."
> — **{{TEN}}**, đại lý {{TINH_THANH}}

> "Hết hàng nó báo trước lúc em chưa kịp lên đơn. Đỡ được mấy vụ xin lỗi khách."
> — **{{TEN}}**, đại lý {{TINH_THANH}}

**Case snippet (khối riêng, nền nhấn):**
> **{{TEN_DAI_LY}} — từ {{X}} đơn/tháng lên {{Y}} đơn/tháng trong {{Z}} tháng**
> "Không phải vì em bán giỏi hơn. Là vì em hết mất thời gian đi hỏi và đi chờ."

**Bổ trợ mạnh hơn testimonial:** ảnh chụp hội thoại Zalo thật (che tên, che SĐT) — 2-3 ảnh trong
carousel. Đại lý tin ảnh chat hơn tin lời khen.

---

### ════════ 10. FAQ ════════

**Q: Agent trả lời sai thì sao?**
A: Agent chỉ trả lời dựa trên dữ liệu thật trong hệ thống, không phán đoán. Việc nào không chắc thì
chuyển nhân viên chứ không đoán bừa. Và mọi việc đụng tiền đều phải có người duyệt trước khi chạy.

**Q: Vậy DiLiM cắt hết nhân viên hỗ trợ à?**
A: Không. Agent lo phần lặp đi lặp lại — tra đơn, chốt sổ, chỉ đường. Nhân viên nhờ vậy còn thời gian
cho ca thật sự khó. Bạn vẫn nhắn được người thật bất cứ lúc nào.

**Q: Tôi không rành công nghệ, dùng được không?**
A: Bạn chỉ cần biết nhắn Zalo. Không cài app, không học phần mềm, không cú pháp. Nhắn tiếng Việt
bình thường như nhắn với nhân viên.

**Q: Dữ liệu đơn hàng, khách hàng của tôi có bị lộ sang đại lý khác không?**
A: Không. Dữ liệu và trí nhớ gắn cứng vào nhóm của bạn. Đây là ràng buộc trong kiến trúc hệ thống,
không phải quy định nội bộ dễ quên.

**Q: Đêm khuya, lễ Tết có trả lời không?**
A: Có. Agent chạy 24/7, không nghỉ lễ. Việc cần người duyệt sẽ chạy khi nhân viên online, nhưng bạn
luôn biết ngay đơn đang ở đâu.

**Q: Làm đại lý DiLiM cần vốn bao nhiêu?**
A: {{DIEU_KIEN_VON}} — {{CHINH_SACH_NHAP_HANG}}.

**Q: Đăng ký mất bao lâu thì bán được?**
A: {{THOI_GIAN_ONBOARD}}. Ký hợp đồng, mở nhóm Zalo riêng, agent có mặt ngay từ ngày đầu.

---

### ════════ 11. FINAL CTA ════════

**Heading:**
> ## Bạn không cần thêm một nhà cung cấp. Bạn cần một hệ thống không bao giờ tắt máy.

**Body:**
> {{SO_DAI_LY}} đại lý đang chạy trên hệ thống này. Không ai trong số họ còn phải chờ tới sáng mai
> để biết đơn của mình tới đâu.

**Risk reversal:**
> Chat thử trước, đăng ký sau. Không cần để lại thông tin, không ai gọi làm phiền bạn.

**CTA primary:** `Đăng ký làm đại lý` · **CTA secondary:** `Nhắn thử agent trên Zalo →`

**Micro-copy:** `Phản hồi trong {{THOI_GIAN_PHAN_HOI}}. Kể cả bây giờ.`

---

### ════════ 12. FOOTER ════════

DiLiM · Về chúng tôi · Chính sách đại lý · Tài liệu kiến trúc · Zalo OA · Hotline · Địa chỉ kho

---

## 3. Kế hoạch build

**Nền tảng đã có:** `landing/` — Next.js 16.3 + Tailwind v4 + OpenNext 1.20 → Cloudflare Workers.
Build đã verify chạy (`wrangler dev` HTTP 200). Cần Node 22 (`nvm use`).

**Component map:**

```
landing/src/
  app/
    globals.css             # ✅ token layer (design-system §2-§6)
    layout.tsx              # ✅ Inter + Geist Mono, lang="vi"
    design/page.tsx         # ✅ specimen nội bộ — kiểm token light/dark
    page.tsx                # ghép section
  components/
    ui/                     # ✅ Button · Card · Badge · Input (design-system §8)
    Hero.tsx                # + AgentNodesBg.tsx (SVG animate)
    TrustBar.tsx
    ProblemCards.tsx
    AgentGrid.tsx           # 6 agent
    ArchitectureDiagram.tsx # interactive, hover tooltip — làm kỹ nhất
    HowItWorks.tsx
    SkillGrid.tsx           # 8 skill
    SafetyGrid.tsx
    Testimonials.tsx        # + ChatScreenshots.tsx carousel
    Faq.tsx                 # accordion
    FinalCta.tsx
  content/copy.ts           # TOÀN BỘ copy tách riêng — sửa chữ không đụng component
```

**Màn mở đầu hero (đã code):** CSS thuần, 0 KB thư viện. Nội dung nằm sẵn trong HTML tĩnh
từ t=0 — animation chỉ điều khiển *cách* nó hiện ra, không chặn đọc, không gây CLS.

| t | Hiện gì |
|---|---------|
| 0ms | Nền + gradient hero paint ngay |
| 80ms | Eyebrow `DiLiM · Hệ vận hành luôn mở` |
| 160 / 250ms | Hai dòng headline, so le |
| 280ms | Sub-headline |
| 380ms | Hai nút CTA (scale 0.96→1) |
| 460ms | Micro-copy dưới nút |
| 480–800ms | Trust bar, 4 ô so le, số đếm 0→giá trị |
| 600–1050ms | Chòm 6 agent: đường nối vẽ ra từ hub, node bung dần |

Chỉ animate `opacity` / `transform` / `filter` — chạy trên compositor, không đụng layout.
`prefers-reduced-motion: reduce` → mọi thứ về trạng thái cuối tức thì, số không đếm.

**Quyết định theme: chỉ light mode.** Không `prefers-color-scheme`, không `[data-theme]`.
design-system §2.5 vẫn giữ đặc tả dark cho portal — landing cố ý không dùng.

**Ràng buộc design-system phải giữ khi code section:**

- **Không emoji.** Icon Lucide (`lucide-react` đã cài), line 24px, `currentColor`, đơn sắc.
- **Không section nền xám.** Phân tách bằng viền `--border-subtle` + khoảng trắng, không đổi nền.
- **Xanh `#2BA770` chỉ ở CTA, focus, accent nhỏ.** Không tô mảng lớn — gradient hero là ngoại lệ
  duy nhất (`--brand-light` → `--bg`).
- **Nút và input luôn `rounded-pill`.** Đây là hình dấu ấn của brand.
- **Ba trọng lượng: 400 / 500 / 600.** Không dùng 700.
- **Giọng điềm tĩnh, không hype.** Copy trong plan này đã theo; sửa về sau đừng thêm từ như
  "đột phá", "số 1", "tuyệt vời".
- **Số liệu chỉ khi có nguồn.** Không số trang trí.
- Class dùng token: `bg-surface-card`, `text-strong/body/muted/faint`, `border-border-subtle`,
  `text-display/h1/h2/h3/body-lg/body`, `.eyebrow`, `.mono-label`, `.container-content`,
  `.section-pad`.

**Thứ tự làm (mỗi bước deploy được, verify được):**

1. ~~Design system: token, font, component, dark mode~~ — **xong**, build + lint + typecheck sạch.
2. Hero + TrustBar + FinalCta → deploy → có page bán được tối thiểu.
3. Problem + AgentGrid + HowItWorks + SkillGrid → page đầy đủ chức năng thuyết phục.
4. **ArchitectureDiagram** — làm riêng, tốn thời gian nhất, là thứ khiến page đáng nhớ.
5. Safety + Testimonials + FAQ.
6. SEO/OG, analytics, tối ưu tốc độ, kiểm mobile.

**Assets cần bạn cấp:**
- [x] ~~Số liệu~~ — **200+ đại lý · 300+ đơn/ngày · 6 agent · 24/7**, đã vào `content/copy.ts`
- [x] ~~Top sản phẩm~~ — 10 SKU, xếp theo số đơn
- [ ] 3 testimonial thật + 1 case study
- [ ] 2-3 screenshot hội thoại Zalo (đã che tên/SĐT)
- [ ] **Link Zalo OA** để deep-link CTA "chat thử" — đang là `#`, chặn deploy
- [ ] **Form đăng ký đại lý** (đích CTA primary) — đang là `#`, chặn deploy
- [ ] Chính sách vốn / thời gian onboard cho FAQ
- [ ] Logo DiLiM (file), để thay chỗ chữ ở header/footer

**Quyết định về dữ liệu doanh thu:** bảng gốc có doanh thu từng SKU (tổng ~25,7 tỷ).
**Cố ý không đưa lên trang public** — số đó lộ cơ cấu doanh thu cho đối thủ (SKU nào gánh,
mã nào sắp chết). Chỉ hiển thị *số lượng bán* và *số đơn*: vẫn chứng minh được sức bán mà
không hở bài. Vì bỏ cột doanh thu nên danh sách xếp lại theo **số đơn** — giữ thứ tự cũ sẽ
trông vô lý với người đọc.

**Kỹ thuật cần lưu:**
- Mobile-first. Đại lý xem trên điện thoại gần như 100%.
- Sơ đồ kiến trúc trên mobile: đổi sang layout dọc, không thu nhỏ chữ.
- Tất cả copy ở `content/copy.ts` để sửa chữ không cần đụng JSX.
- OG image = ảnh sơ đồ kiến trúc — share Zalo/Facebook là ăn ngay chất công nghệ.

---

## 4. Ghi chú tối ưu chuyển đổi

**A/B test:**
- Headline A (`Đơn của bạn có người trực. Kể cả 2 giờ sáng.`) vs C (headline số liệu)
- CTA primary: `Đăng ký làm đại lý` vs `Nhận tư vấn làm đại lý`
- Vị trí khối kiến trúc: section 5 vs đẩy lên section 3

**Đo:**
- Tỉ lệ click `Chat thử` vs `Đăng ký` — nếu chat thử thắng đậm, đảo primary/secondary
- Độ sâu scroll tới ArchitectureDiagram — nếu tụt mạnh, section trước đó quá dài
- Nguồn traffic Zalo vs Facebook — quyết định OG image nào cần đẹp trước

**Ba nguyên tắc giữ khi sửa copy về sau:**
1. Luôn dẫn bằng *cái đại lý được*, không bằng *cái hệ thống có*. "Đơn có người trực" thắng
   "kiến trúc event-driven".
2. Kiến trúc là **bằng chứng**, không phải nội dung bán hàng. Vẽ ra để tin, không để hiểu.
3. Số liệu phải thật. Page này bán bằng chữ "minh bạch" — một con số bịa làm sập cả luận điểm.
