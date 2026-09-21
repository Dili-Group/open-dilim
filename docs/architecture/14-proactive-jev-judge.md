# 14. Thay regex phễu proactive bằng Jev (TypeSafe System One)

- **Ngày:** 2026-09-21
- **Trạng thái:** ĐÃ triển khai §3–§8. Chờ `JEV_API_KEY` để chạy thật (thiếu key = phễu tắt).
  §9 (shadow mode + bảng đo) **không làm**: regex đã bỏ hẳn theo yêu cầu nên không còn gì để chạy
  song song; chỉnh ngưỡng đọc log `[proactive] judge …`, ghi bảng để backtest là việc sau.
- **Thay cho:** tầng 0 regex intent ở [§11 phễu proactive](./11-proactive.md) + seam tầng 2 chưa nối.

## 1. Chỗ đang đau

Tầng 0 hiện quyết "tin này có đáng nhặt không" bằng 9 regex trong
`agents/roots/dealer.ts` (`/giúp|giùm|hộ (em|chị...)/`, `/hủy|huỷ|lên lại/`, `/\?\s*$/m`…).

| Triệu chứng | Vì sao regex không chữa được |
|---|---|
| Bỏ sót câu không có từ khoá | "đơn hôm qua vẫn nằm im" — không có "chưa", không có "?" |
| Bắt nhầm câu tán gẫu | "cảm ơn c nhiều nha, chiết khấu ok rồi" trúng `chiết khấu` |
| Không phân biệt được NGƯỜI NÀO đang được nhờ | "chị Hà check giúp em với" — không tag ai nên `mentions.length === 0` → lọt |
| Không phân biệt được bức xúc | Khiếu nại nặng cũng trúng `/giúp/` → agent nhảy vào giữa lúc người ta đang cáu |
| Thêm agent mới = viết lại danh sách | `warehouse`, `xac-nhan-don` muốn dùng phễu phải tự nghĩ regex |
| Không đo được | Regex không có độ tin cậy. Không biết mình đang sai bao nhiêu phần trăm |

Cốt lõi: **regex đo TỪ NGỮ, việc cần đo là Ý ĐỊNH** — "câu này có phải yêu cầu mà trợ lý tự
làm được, và có đang bị bỏ rơi không".

## 2. Jev là gì, và vì sao nó hợp chỗ này

[Jev](https://docs.typesafe.ai/api) (TypeSafe AI) là **System One model**: không sinh chữ, nó
chấm một `state` theo các câu hỏi có **không gian trả lời khai trước**, trả **giá trị có kiểu +
phân phối xác suất + độ tin cậy**.

Ba primitive:

| Loại | Trả về | Giới hạn |
|---|---|---|
| `noul` | xác suất mệnh đề đúng (0–1) | — |
| `choice` | option được chọn + phân phối đủ mọi option + confidence | ≤ 255 option |
| `score` | mức trong thang đã sắp thứ tự + phân phối + confidence | 2–10 mức |

Số thật (tra ngày 21/09/2026):

| | |
|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>` |
| Giá | **$0.042 / 1M input token**, output token **miễn phí** |
| Độ trễ | **70–500ms** end-to-end |
| Context | 32k token |
| Model id | pin bản cụ thể (`jev-1.13.0`), tài liệu khuyên KHÔNG để `jev-latest` chạy prod |
| Lỗi | 401 key sai · 422 body sai · 429 rate limit · 529 quá tải (retry backoff) |
| Nhiều câu hỏi/1 request | chấm **song song, độc lập** — thêm câu hỏi gần như không thêm độ trễ |

Vì sao hợp: câu hỏi của ta là loại "người có kinh nghiệm liếc qua là biết" — đúng thứ Jev nhắm.
Và nó trả **phân phối**, nghĩa là lần đầu tiên ta có **con số để chỉnh ngưỡng**, thay vì cãi nhau
xem nên thêm từ khoá nào vào regex.

Khẩu hiệu của họ khớp luôn cách repo này chia tầng: *code tính, Jev phán, LLM suy luận/viết*.
Trong phễu: `router.ts` = code, tầng 2 = Jev, tầng 3 = LLM trả lời.

**Giới hạn phải nhớ:** calibration ≠ đúng. Confidence cao vẫn sai được. Jev không tra cứu thêm
được gì ngoài `state` ta đưa. Nên nó là **cửa lọc**, không phải người quyết cuối — tầng 3 vẫn
giữ quyền im lặng bằng `PROACTIVE_DECLINE`.

## 3. Quyết định kiến trúc: Jev đặt ở TẦNG 2, không thay tầng 0

Cám dỗ là gọi Jev ngay tại tầng 0 cho mọi tin. **Không làm**, vì hai lý do đo được:

1. **Tầng 0 nằm trong đường nóng của webhook.** `message-ingest/gateway.ts:82` gọi
   `await considerProactive(...)` **bên trong** vùng đã mark dedupe, trước khi trả 202. Thêm
   70–500ms × mọi tin nhóm vào đó là làm chậm ingest và kéo một dịch vụ ngoài vào chỗ mà hỏng
   là nhả dedupe, bắt Zalo gửi lại nguyên tin.
2. **Tầng 1 lọc mạnh hơn và miễn phí.** Đa số câu hỏi được người thật trả lời trong cửa sổ chờ.
   Chấm trước cửa sổ đó là trả tiền cho câu mà 30 giây sau có người lo.

Nên: **tầng 0 rút về guard cấu trúc thuần (0 token), regex intent BỎ HẲN; Jev chạy ở tầng 2,
sau cửa sổ chờ.**

```
tin nhóm !addressedToAgent
  │
  ├─ TẦNG 0  gate.ts — CHỈ guard cấu trúc, 0 token, giữ nguyên chỗ cũ:
  │          không phải tin người thật (source ≠ channel) · tin của chính agent (selfIds) ·
  │          đã tag đích danh ai đó (mentions) · rỗng/chỉ ảnh/chỉ URL.
  │          ❌ BỎ: spec.triggers.some(...)
  │
  ├─ VERIFY  verify.ts — giữ nguyên (phòng đã bind + ngân sách ngày còn).
  │
  ├─ TẦNG 1  poller.ts — chờ waitMs, rồi soi history: có NGƯỜI KHÁC lên tiếng sau câu hỏi → bỏ.
  │          0 token. Vẫn là bộ lọc mạnh nhất, và giờ là bộ lọc CHI PHÍ cho tầng 2.
  │
  ├─ TẦNG 2  proactive/judge.ts — ✅ JEV. 1 request, 5 câu hỏi chấm song song.
  │          Code đọc phân phối + confidence rồi quyết theo NGƯỠNG của agent đó.
  │          Jev hỏng / quá ngưỡng thời gian → KHÔNG nhặt (fail-closed, xem §7).
  │
  └─ TẦNG 3  Envelope `proactive` → worker → agent. Giữ nguyên, kể cả quyền im lặng.
```

Hệ quả phải nhận: hàng chờ Redis tầng 1 giờ nhận **mọi** tin qua guard cấu trúc thay vì ~20%.
Không đáng lo — key theo `(channel, phòng, người hỏi)` nên tin sau đè tin trước, mỗi người trong
một phòng chỉ chiếm đúng một member; chi phí là 2 lệnh Redis/tin, cùng hạng với `message_log`
vốn đã ghi Postgres mọi tin.

## 4. Bộ câu hỏi (DATA, không phải code)

Một request, năm câu hỏi. `state` = câu hỏi đang xét + vài lượt history quanh nó + danh sách
việc agent làm được.

| id | loại | hỏi gì | dùng để |
|---|---|---|---|
| `tu_lam_duoc` | `noul` | Trợ lý có tự xử lý được yêu cầu này bằng đúng danh sách việc trong state không? | cổng chính |
| `nhom_viec` | `choice` | Yêu cầu thuộc nhóm nào: `tra_don`, `tien_can_chuyen`, `vi_chiet_khau`, `doi_soat`, `het_hang`, `khieu_nai`, `nho_nguoi_khac`, `tan_gau` | chặn theo bộ tool agent thực có; cũng là nhãn để đo |
| `nho_dich_danh` | `noul` | Người hỏi đang nhờ ĐÍCH DANH một người cụ thể (dù không tag)? | thứ regex không bao giờ bắt được |
| `da_co_nguoi_lo` | `noul` | Trong các tin sau câu hỏi, đã có ai đang xử lý việc này chưa? | lớp hai cho tầng 1 (tầng 1 chỉ đếm "có ai nói", không biết nói về gì) |
| `muc_do` | `score` | `[binh_thuong, hoi_gap, buc_xuc]` | khiếu nại nặng → để NGƯỜI xử lý, agent đứng ngoài |

`state` (JSON, không phải chuỗi ghép):

```jsonc
{
  "cau_hoi": { "nguoi_hoi": "Chị Lan (đại lý)", "noi_dung": "đơn hôm qua vẫn nằm im" },
  "hoi_thoai_gan_day": [ { "ai": "Chị Lan", "noi": "…" }, { "ai": "NV Hà", "noi": "…" } ],
  "tro_ly_lam_duoc": [
    { "id": "tra_don", "mo_ta": "tra tình trạng đơn, mã vận đơn, lý do đơn treo" },
    { "id": "tien_can_chuyen", "mo_ta": "số tiền đại lý cần chuyển để đơn được đi" }
    // … sinh từ ProactiveSpec.capabilities, không gõ tay hai lần
  ]
}
```

Danh sách `tro_ly_lam_duoc` lấy thẳng từ spec của agent → **thêm agent dùng phễu = khai năng lực
bằng tiếng Việt, không phải nghĩ regex**. Đây là phần trả lời được câu "sao mỗi agent phải viết
lại danh sách từ khoá".

## 5. Quyết định = hàm THUẦN, không nằm trong Jev

Jev trả số; **ngưỡng và luật là của mình**, để test được không cần mạng:

```ts
// proactive/judge.ts
export function quyetDinh(answers: ProactiveAnswers, policy: JudgePolicy): JudgeVerdict {
  if (answers.nho_dich_danh.noul >= policy.maxNhoDichDanh) return decline("viec_cua_nguoi_khac");
  if (answers.da_co_nguoi_lo.noul >= policy.maxDaCoNguoiLo) return decline("da_co_nguoi_lo");
  if (answers.muc_do.score === "buc_xuc") return decline("buc_xuc_de_nguoi_xu_ly");
  if (answers.tu_lam_duoc.noul < policy.minTuLamDuoc) return decline("ngoai_pham_vi");
  if (answers.tu_lam_duoc.confidence < policy.minConfidence) return decline("khong_chac");
  const nhom = answers.nhom_viec.choice;
  if (!policy.capabilityIds.includes(nhom)) return decline("nhom_viec_khong_thuoc_pham_vi");
  if ((answers.nhom_viec.probabilities[nhom] ?? 0) < policy.minNhomViecProb) return decline("phan_tan");
  return { nhat: true, nhom, confidence: answers.tu_lam_duoc.confidence };
}
```

Ngưỡng khởi điểm (chỉnh sau khi có số thật — §9):

```ts
minTuLamDuoc: 0.75, minConfidence: 0.60, minNhomViecProb: 0.50,
maxNhoDichDanh: 0.30, maxDaCoNguoiLo: 0.30
```

`JudgeVerdict` mang cả **lý do từ chối** — không phải `boolean`. Lý do là thứ đi vào log và là
thứ duy nhất cho phép chỉnh ngưỡng có căn cứ.

## 6. "Typesafe" nghĩa là gì trong repo này

Hai lớp, không lẫn:

**Lớp compile-time** — khai câu hỏi một lần, kiểu câu trả lời suy ra từ đó:

```ts
// judge/types.ts
export interface NoulDef { readonly type: "noul"; readonly instructions: string;
  readonly criteria: { readonly true: string; readonly false: string } }
export interface ChoiceDef<O extends string> { readonly type: "choice"; readonly instructions: string;
  readonly criteria: Readonly<Record<O, string>> }
export interface ScoreDef<L extends readonly string[]> { readonly type: "score";
  readonly instructions: string; readonly criteria: L }

export type AnswerOf<Q> =
  Q extends NoulDef ? { readonly noul: number; readonly confidence: number } :
  Q extends ChoiceDef<infer O> ? { readonly choice: O;
    readonly probabilities: Readonly<Record<O, number>>; readonly confidence: number } :
  Q extends ScoreDef<infer L> ? { readonly score: L[number];
    readonly probabilities: Readonly<Record<L[number], number>>; readonly confidence: number } :
  never;

export type AnswersOf<Q extends Record<string, QuestionDef>> = { readonly [K in keyof Q]: AnswerOf<Q[K]> };

export interface JudgePort {
  ask<Q extends Record<string, QuestionDef>>(
    input: { readonly state: unknown; readonly questions: Q },
    signal?: AbortSignal,
  ): Promise<AnswersOf<Q>>;
}
```

Khai `QUESTIONS` với `as const` là `answers.nhom_viec.choice` tự có union đúng 8 nhóm; gõ sai
tên nhóm ở `quyetDinh` là đỏ typecheck.

**Lớp runtime** — luật của repo: *type ở boundary phải validate, đừng tin blind*. Response HTTP
là `unknown`; adapter narrow từng answer theo đúng định nghĩa câu hỏi đã khai, thiếu/sai kiểu →
**ném `JudgeError`, không đoán giá trị mặc định**. Kiểu TS chỉ là hợp đồng cho chính mình, nó
không chặn được backend đổi shape.

> Tài liệu công khai mô tả answer là `{ type, noul|choice|score, confidence }`, còn SDK ví dụ có
> `.probabilities`. Trước khi tin, in **nguyên văn một response thật** rồi mới chốt reader —
> cùng kỷ luật đã dùng với Bun.sql (§CLAUDE.md: đừng suy từ cú pháp, thử trên hệ thật).

**Dùng SDK `@typesafe-ai/sdk` hay tự gọi `fetch`?** Đề xuất **tự gọi fetch** qua một client nhỏ
như `operational/agent-api.ts`: repo chỉ có 4 dependency runtime, SDK kéo theo peer `zod`, mà ta
vẫn phải tự validate ở boundary. Cái SDK cho thêm (suy kiểu) thì 40 dòng type ở trên đã có.

## 7. Hỏng thì làm gì — FAIL-CLOSED, đây là chỗ đổi luật

Seam tầng 2 hiện tại ghi rõ: *chưa nối → cho qua hết*. Luật đó đúng KHI regex còn đứng ở tầng 0.
**Bỏ regex thì phải lật lại**: Jev hỏng mà vẫn cho qua = mọi câu chưa ai đáp đều đánh thức agent
= spam cả nhóm.

| Tình huống | Xử |
|---|---|
| Chưa khai `JEV_API_KEY` | phễu TẮT hẳn cho mọi agent (log cảnh báo lúc boot) |
| 429 / 529 | retry backoff tối đa 2 lần trong hạn `timeoutMs`; hết → không nhặt |
| 401 / 422 | không retry, log lỗi cấu hình, không nhặt |
| Timeout (mặc định 3s) | không nhặt. Câu hỏi đã rời hàng chờ (ZREM), không đưa lại — mất một cơ hội giúp, không mất tin |

Trần `maxPerRoomPerHour` giữ nguyên: van an toàn cuối, không phụ thuộc Jev.

## 8. Module + file phải đụng

| File | Việc |
|---|---|
| `src/judge/types.ts` *(mới)* | `QuestionDef`, `AnswerOf`, `AnswersOf`, `JudgePort`, `JudgeError`. File lá, không import config |
| `src/judge/jev.ts` *(mới)* | `JevJudge implements JudgePort` — fetch `api.typesafe.ai/v1/systemone`, backoff 429/529, narrow response |
| `src/proactive/judge.ts` *(mới)* | `QUESTIONS` (data) + `buildState()` + `quyetDinh()` thuần + closure cắm vào `deps.classify` |
| `src/proactive/gate.ts` | bỏ `spec.triggers.some(...)`; giữ nguyên guard cấu trúc |
| `src/agents/types.ts` | `ProactiveSpec`: bỏ `triggers`, thêm `judge: { capabilities, policy }` |
| `src/agents/roots/dealer.ts` | 9 regex → danh sách năng lực tiếng Việt + ngưỡng |
| `src/proactive/poller.ts` | `classify(question)` → `classify(question, recent)`: Jev cần history, mà tầng 1 vừa đọc sẵn rồi — đừng đọc hai lần |
| `src/config.ts` | `jev: { apiKey, model, timeoutMs, mode }` |
| `src/bootstrap/index.ts` | dựng `JevJudge`, cắm `classify`, cảnh báo khi thiếu key |
| `src/db/schema.ts` + `migrations/0011_proactive_judgment.sql` | bảng đo (§9) — cột mới trên bảng có sẵn thì viết `ALTER` tay, ở đây là bảng mới |

Không đụng: `pending.ts`, `verify.ts`, tầng 3, worker, agent.

## 9. Đo trước khi tin — shadow mode + backtest *(KHÔNG làm lần này)*

> Regex đã bỏ hẳn nên không còn phán quyết thứ hai để so song song. Phần dưới giữ lại làm hồ sơ
> cho lần muốn dựng đo có hệ thống. Hiện tại mỗi phán quyết in một dòng log
> `[proactive] judge msg=… nhat=… lyDo=… lam_duoc=…/… dich_danh=… co_nguoi_lo=… muc_do=…` —
> đủ để chỉnh ngưỡng bằng tay sau vài ngày, không đủ để tính ma trận nhầm lẫn.

Repo đã có tiền lệ đúng kiểu này (`ENFORCE_BUDGET=false`: đo trước, chặn sau). Làm y vậy:

```
JEV_MODE=off      # không gọi, phễu tắt (mặc định)
JEV_MODE=shadow   # gọi Jev, GHI SỔ, nhưng quyết định vẫn theo regex cũ
JEV_MODE=enforce  # Jev quyết
```

Trong `shadow`, tầng 0 đã bỏ regex nên **mọi** câu qua guard vào hàng chờ; tầng 2 tính CẢ hai
phán quyết (regex cũ chạy tại chỗ, Jev) rồi ghi bảng `proactive_judgment`:

```
ngay · channel · conversation_id · msg_id
regex_pass BOOL · jev_nhat BOOL · jev_nhom TEXT · jev_ly_do TEXT
tu_lam_duoc NUMERIC · confidence NUMERIC · input_tokens INT · latency_ms INT
```

Hai con số cần lấy sau vài ngày:

- **Regex bỏ sót**: `regex_pass = false AND jev_nhat = true` → đọc tay ~30 dòng, đếm bao nhiêu
  thực sự đáng trả lời.
- **Regex bắt nhầm**: `regex_pass = true AND jev_nhat = false`.

Có số rồi mới chỉnh ngưỡng §5 và bật `enforce`. Kèm một script replay để không phải chờ:
`bun run src/proactive/backtest.ts --ngay 2026-08-25` đọc `message_log` (đã có sẵn mọi tin),
chấm lại bằng Jev, in ma trận nhầm lẫn — **chi phí dưới 1.500 VND cho trọn một ngày dữ liệu**
(xem §10), rẻ hơn nhiều so với đoán.

## 10. Chi phí + độ trễ, tính bằng số thật

Một lần chấm: `state` (câu hỏi + ~8 lượt history + danh sách năng lực) + text 5 câu hỏi
≈ **1.000–1.500 input token**. Output miễn phí.

```
1.300 token × $0,042 / 1.000.000 = $0,0000546  ≈ 1,4 VND / lần chấm   (tỉ giá 26.000)
```

| Kịch bản | Số lần chấm/ngày | Tiền/ngày |
|---|---|---|
| Kiến trúc này (chỉ câu qua tầng 1) | ~150–400 | **210–560 VND** |
| Nếu lỡ chấm mọi tin nhóm không nhắm agent (818 tin — KHÔNG làm) | 818 | ~1.150 VND |
| Backtest trọn một ngày dữ liệu cũ | 818 | ~1.150 VND |

So với trần ngân sách hiện tại của một nhóm đại lý (2.000 VND/ngày/phòng, `usage/budget.ts`),
chi phí phán quyết là **nhiễu làm tròn**. Đắt không phải là lý do chọn đặt ở tầng 2 — **độ trễ
trên đường nóng và fail-mode mới là lý do** (§3).

Độ trễ 70–500ms nằm trong poller (nhịp 30s), không ai chờ nó. Nhưng vẫn đặt `timeoutMs = 3000`
để một lần Jev treo không kéo dài cả tick đang xử lý cả trăm câu.

Chi phí này KHÔNG vào `llm_usage_log` (bảng đó là sổ chi phí LLM theo phòng, đơn vị pico-USD
theo bảng giá `usage/pricing.ts`). Jev là nhà cung cấp khác, đơn vị khác, không gom hạn mức theo
phòng → ghi ở `proactive_judgment` (§9), cộng riêng.

## 11. Rủi ro

| Rủi ro | Mức | Chặn thế nào |
|---|---|---|
| **Thêm một bên xử lý dữ liệu khách** — nội dung chat nhóm đại lý gửi sang TypeSafe | Cao, phải người quyết | Hiện chat đã đi qua Anthropic/Gemini, nhưng thêm nhà cung cấp là quyết định kinh doanh, không phải quyết định kỹ thuật. `state` chỉ mang text tin + tên hiển thị; KHÔNG đưa mã đơn, số điện thoại, số tiền nếu không cần cho phán quyết |
| Confidence cao nhưng sai | Trung bình | Tầng 3 vẫn được im lặng (`PROACTIVE_DECLINE`); trần `maxPerRoomPerHour`; `buc_xuc` luôn đứng ngoài |
| Phụ thuộc nhà cung cấp mới, model đổi hành vi | Trung bình | Pin `jev-1.13.0`; `JudgePort` là interface của mình → đổi sang LLM classifier thường hoặc Cloudflare Workers AI (`typesafe/jev`) chỉ là đổi adapter |
| Vendor tự chạy benchmark | Thấp | Không tin số của họ; §9 bắt buộc backtest trên `message_log` của mình |
| Bỏ regex là mất luôn đường lui | Thấp | Shadow mode giữ regex chạy song song tới khi có số; giữ nhánh `JEV_MODE=off` = phễu tắt, hệ trở về trạng thái an toàn |

## 12. Đã làm gì (21/09/2026)

| File | |
|---|---|
| `src/judge/types.ts` | `noul/choice/score`, `AnswerOf`/`AnswersOf`, `JudgePort`, `JudgeError` |
| `src/judge/jev.ts` | `JevJudge` — fetch, backoff 429/5xx/transport, narrow response theo định nghĩa câu hỏi |
| `src/proactive/buckets.ts` | 8 nhóm việc + `ProactiveCapability` + `JudgePolicy` (file lá, tránh vòng import) |
| `src/proactive/judge.ts` | 5 câu hỏi, `buildJudgeState`, `quyetDinh` (thuần), `buildProactiveClassify` (fail-closed) |
| `src/proactive/gate.ts` | bỏ regex intent, còn guard cấu trúc |
| `src/agents/types.ts` · `roots/dealer.ts` | `ProactiveSpec.triggers` → `judge`; 9 regex → 4 năng lực + ngưỡng |
| `src/proactive/poller.ts` | classify nhận `(question, recent, spec.judge)`; thiếu classify = không nhặt |
| `src/config.ts` · `.env.example` · `bootstrap` | `JEV_API_KEY` / `JEV_MODEL` (pin `jev-1.13.0`) / `JEV_TIMEOUT_MS`, dựng `JevJudge`, cảnh báo khi thiếu key |
| `src/judge/judge.test.ts` · `src/proactive/judge.test.ts` | 10 + 14 test: narrow response, retry, mọi nhánh từ chối, fail-closed |

## 13. Thứ tự làm, mỗi bước có mốc kiểm

1. **`src/judge/` + type + adapter Jev.** *Verify:* một script gọi thật với 5 câu hỏi trên 3 tin
   mẫu; in nguyên văn response; chốt reader theo response thật, không theo tài liệu.
2. **`proactive/judge.ts`: QUESTIONS + `quyetDinh()` thuần.** *Verify:* `bun test` với answers
   dựng tay — mọi nhánh từ chối, cả biên ngưỡng.
3. **Spec + gate + poller + config, chạy `JEV_MODE=shadow`.** *Verify:* test gate không còn đọc
   `triggers`; test poller fail-closed khi judge ném; chạy thật 3–5 ngày, bảng `proactive_judgment`
   có dòng.
4. **Backtest + chỉnh ngưỡng.** *Verify:* ma trận nhầm lẫn trên ≥ 300 tin đã gán nhãn tay.
5. **`JEV_MODE=enforce`, xoá regex khỏi `dealer.ts`.** *Verify:* một tuần không có tin agent nhảy
   vào nhầm; so số lượt proactive trước/sau.

## 14. Chưa làm

- Không thay tầng 1 (soi history) bằng Jev: đó là phép so thời gian deterministic, code làm đúng
  và miễn phí.
- Không thay cổng mẫu `STT` của nhóm xác nhận đơn (§13): cổng đó nằm ở ingest — đúng đường nóng
  mà §3 vừa nói là không được gọi mạng.
- Không dùng Jev cho `sub-router.ts` (chọn sub-agent) trong lần này, dù nó là ứng viên rõ ràng
  tiếp theo: `choice` thay cho một lượt LLM 24 token. Làm sau khi phễu chạy ổn.

---

**Nguồn:** [TypeSafe API reference](https://docs.typesafe.ai/api) ·
[Jev quickstart TypeScript](https://www.refix.ai/news/jev-quickstart-typescript/) ·
[MarkTechPost — giá + độ trễ](https://www.marktechpost.com/2026/09/19/typesafe-ai-releases-jev/) ·
[Cloudflare AI: typesafe/jev](https://developers.cloudflare.com/ai/models/typesafe/jev/) ·
[Tham chiếu tổng hợp: mạnh/yếu, pattern ngưỡng](https://gist.github.com/pjburnhill/adf8d28efcad9df037bfdece178ef965)
