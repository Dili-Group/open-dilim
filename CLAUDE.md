# CLAUDE.md — dilim-agent

Coding agent kiểu Claude Code, chạy trong terminal. Async, event-driven: input qua
message-ingest → worker pool (agent loop LLM ⇄ tools) → broadcast pub/sub. Request được
ACK ngay (202), kết quả đến sau qua broadcast bus.

**Stack:** Bun + TypeScript. LLM đa provider (Anthropic Claude + Google Gemini) sau interface
chung — xem thiết kế `llm/` trong `docs/ARCHITECTURE.md`. Code hiện mới scaffold client Anthropic.

## Layout

```
        # code chạy được (Bun project)
src/
  anthropic.ts  # Anthropic client (credentials tự resolve)
  config.ts     # CONFIG + SYSTEM_PROMPT
  tools/        # tool implementations
docs/
  ARCHITECTURE.md # thiết kế đầy đủ (tiếng Việt) — nguồn sự thật kiến trúc
taxlegal/         # repo tham khảo (clone), KHÔNG phải code của agent này
```

## Lệnh

```bash
cd agent
bun run src/index.ts   # start (script: bun start)
bun --watch run src/index.ts  # dev
```

Chưa có test runner. Khi thêm test: dùng `bun test`.

## Config

- Provider: `PROVIDER` (anthropic|gemini) chọn LLM backend; `MODEL` chọn model của provider đó.
- Credentials: `ANTHROPIC_API_KEY` / `ant auth login` cho Claude, `GEMINI_API_KEY` cho Gemini.
- Override qua env: `PROVIDER`, `MODEL`, `EFFORT` (low|medium|high|xhigh|max).
- Agent sandbox tới `CONFIG.workdir` (= cwd). Không đụng ngoài root.

## Quy ước

- TypeScript strict, `noUncheckedIndexedAccess` bật — xử lý index có thể undefined.
- ESM (`"type": "module"`), import dùng `.ts` extension (`allowImportingTsExtensions`).
- Bun runtime, không phải Node. Ưu tiên API Bun sẵn có.
- Docs kiến trúc viết tiếng Việt. Giữ nhất quán.

## Rules code

**Types**
- Không `any`. Không rõ kiểu → `unknown` rồi narrow. Không `as` ép kiểu để làm im lỗi.
- Type ở boundary (input tool, message LLM, payload channel) validate runtime, đừng tin blind.
- `noUncheckedIndexedAccess` bật → `arr[i]` có thể `undefined`. Check trước khi dùng.

**Error handling**
- Không nuốt lỗi (`catch {}` rỗng). Catch → log + rethrow, hoặc trả error rõ ràng.
- Agent loop / worker không được crash cả process vì một request lỗi. Cô lập lỗi per-request.
- Lỗi từ tool → trả về LLM dạng structured (để model tự sửa), không throw ra ngoài loop.

**Async**
- `await` mọi promise. Không floating promise. Không `async` mà bên trong không `await`.
- I/O song song độc lập → `Promise.all`, đừng await tuần tự.
- Long-running (agent loop, LLM call) → hỗ trợ cancel/timeout (`AbortSignal`).

**Structure**
- Function một việc. File > ~300 dòng → tách theo trách nhiệm.
- Tool = module riêng trong `src/tools/`, export schema + handler. Một tool một file.
- Không circular import. Config/secret chỉ qua `config.ts`, không đọc `process.env` rải rác.
- Không magic number/string lặp → đặt const có tên.

**SQL (Bun.sql + Postgres)**
- Query LUÔN qua tagged template `sql`...${x}``. Không nối string. `sql.unsafe()` chỉ với input tin cậy.
- Mảng: bind bằng `sql.array(x, "TEXT")`, KHÔNG `${x}::text[]`. Bun serialize mảng JS trần thành
  chuỗi nối phẩy (`a,b,c`) → `22P02 malformed array literal`. Và ĐỪNG cast thêm sau `sql.array(x)`
  — cast thừa bọc nháy kép vào từng phần tử, ghi vào DB sai âm thầm.
- jsonb: bind `${json}::text::jsonb`, KHÔNG `${json}::jsonb` trần — cast trần khiến Bun encode
  hai lần, cột nhận string scalar thay vì object.
- Kiểu param nào Bun encode "lạ" (mảng, json, enum, interval) → thử trên Postgres thật trước khi
  tin, đừng suy từ cú pháp. Query đã sửa phải chạy được ít nhất một lần trên DB thật/temp table.
- Cột mới trên bảng đã tồn tại → viết migration `ALTER` tay; `gen:migration` chỉ dựng lại 0001.

**Secrets & I/O**
- Không hardcode key/token. Không log secret, PII, nội dung message người dùng ở mức debug.
- Mọi file/shell op sandbox trong `CONFIG.workdir`. Validate path, chặn traversal (`../`).
- Input LLM/channel = untrusted. Không eval, không nối thẳng vào shell/SQL.

**Chất lượng**
- Đặt tên rõ (hàm = động từ, biến = danh từ). Không viết tắt khó hiểu.
- Comment giải thích *tại sao*, không *cái gì*. Code tự nói phần *cái gì*.
- Thêm behavior → thêm test. Sửa bug → test tái hiện trước.
- Không commit code chết, `console.log` debug, hay code bị comment.

## Cách làm việc (Karpathy)

1. **Nghĩ trước khi code.** Nêu giả định rõ ràng. Nhiều cách hiểu → hỏi, đừng chọn thầm.
   Có cách đơn giản hơn → nói ra.
2. **Đơn giản trước.** Code tối thiểu giải quyết đúng vấn đề. Không abstraction cho code
   dùng một lần, không "cấu hình linh hoạt" không ai yêu cầu, không handle case không thể xảy ra.
3. **Sửa phẫu thuật.** Chỉ đụng thứ cần đụng. Không "cải thiện" code kề bên, không refactor
   thứ không hỏng. Match style hiện có. Dọn import/biến do CHÍNH thay đổi của mình làm thừa —
   không xóa dead code có sẵn trừ khi được yêu cầu.
4. **Chạy theo mục tiêu.** Biến task thành tiêu chí kiểm chứng được: "sửa bug" → viết test
   tái hiện bug rồi làm nó pass. Task nhiều bước → nêu plan ngắn với bước verify.
