# src/agents — bố cục

Tầng agents chia làm ba nhóm. Nhìn một file, hỏi nó thuộc nhóm nào là biết nó làm gì:

| Nhóm | Là gì | Sửa khi nào |
|---|---|---|
| **Định tuyến** (`router.ts`, `registry.ts`) | Ai xử lý lượt này | Thêm channel / thêm agent |
| **`runtime/`** | *Cách* một lượt chạy — dùng chung mọi agent | Đổi cơ chế, hiếm |
| **`roots/`** | DATA khai báo từng agent (prompt, tool, sub) | Thêm/sửa agent — chỗ này là chính |

```
src/agents/
  types.ts             # hợp đồng: RootAgentProfile, SubAgent, RootAgent
  prompts.ts           # persona của các root agent

  router.ts            # TẦNG 1 (thô): channel → agentType. Bảng hằng, KHÔNG LLM
  registry.ts          # agentType → RootAgent (+ default khi channel chưa map)

  runtime/             # BỘ MÁY chạy lượt — thêm agent KHÔNG đụng vào đây
    build-agent.ts     #   profile (data) → RootAgent (chạy được).
                       #   Luồng: sub-router → assemble context → loop
    sub-router.ts      #   TẦNG 2 (mịn): trong 1 root, chọn sub-agent theo task.
                       #   1 lượt LLM rẻ (no tool, effort low, 24 token)
    loop.ts            #   vòng LLM ⇄ tools tới khi model hết gọi tool.
                       #   Chạm tool khai `announce` → phát 1 tin báo "đang xử lý" (1 lần/lượt)

  roots/               # DATA — thêm agent = thêm 1 file + 1 dòng ở registry.ts
    operations.ts      #   channel zalo-vanhanh
    dealer.ts          #   channel zalo
    personal.ts        #   channel zalo-canhan (directOnly)
    boss.ts            #   channel zalo-sep
    default.ts         #   fallback khi channel chưa map
```

## Hai tầng định tuyến

```
webhook /webhook/:channel
        │
        ├─ TẦNG 1  router.ts        channel → agentType     ← LOGIC CODE, bảng hằng
        │          registry.ts      agentType → RootAgent
        │
        └─ TẦNG 2  runtime/sub-router.ts   tin nhắn → sub-agent   ← LLM QUYẾT, theo prompt
                   (chỉ chạy khi root khai `subAgents`)
```

Chia vậy vì: channel là **sự thật hạ tầng** (biết chắc) → code quyết, deterministic, 0 token.
Câu hỏi thuộc nghiệp vụ nào là **ý người** (phải hiểu) → LLM quyết.

Channel KHÔNG cấp quyền — chỉ chọn luồng. Quyền vẫn do identity (bước AUTH) quyết.

## Luật đặt file cho root agent

Root **chưa có sub-agent** → một file phẳng `roots/<tên>.ts`. Đừng ép folder cho 16 dòng.

Root **có sub-agent** → chuyển thành folder, sub nằm cạnh root của nó (không gom sub của mọi
root vào một chỗ — mở folder là thấy trọn một agent):

```
roots/
  operations/
    index.ts         # export operationsProfile
    prompt.ts        # persona root
    subs/
      kho.ts         # SubAgent: name, description, prompt, tools
      cong-no.ts
```

`registry.ts` import `./roots/operations/index.ts` — không đổi gì khác.

## Root vs sub

- **Root** chọn theo **domain/vai** (đại lý, vận hành, sếp). Sở hữu `memorySpec` + `directOnly`
  — trí nhớ và phạm vi phòng thuộc về root vì cùng một hội thoại.
- **Sub** chọn theo **task** trong domain đó. Chỉ đổi `prompt` + `tools` cho trọn lượt.
  Hiện KHÔNG chạy loop lồng loop: chọn xong thì sub là người trả lời. Không sub nào khớp →
  root tự trả lời.

Hiện tại: 5 root, 0 sub → `sub-router.ts` chưa bao giờ được gọi (`build-agent.ts` thấy mảng
rỗng là return ngay, không tốn lượt LLM nào).
