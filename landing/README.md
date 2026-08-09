# landing

Landing page DILIM — Next.js 16 (App Router, TS, Tailwind v4) deploy lên Cloudflare Workers
qua adapter [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare).

## Yêu cầu

- Node.js **>= 22** (wrangler 4 bắt buộc). Dùng `nvm use` — repo có `.nvmrc`.
- pnpm 10.

## Lệnh

```bash
pnpm dev       # Next dev server (Node runtime) — nhanh nhất khi code UI
pnpm preview   # build + chạy trong workerd (giống production)
pnpm deploy    # build + deploy lên Cloudflare Workers
pnpm cf-typegen # sinh lại cloudflare-env.d.ts sau khi sửa wrangler.jsonc
```

`preview`/`deploy`/`upload` tự chạy `cf-typegen` trước vì `cloudflare-env.d.ts` không commit.

## Cấu hình Cloudflare

- `wrangler.jsonc` — tên worker, compatibility date/flags, assets binding. Thêm binding
  (KV/D1/R2) ở đây rồi chạy `pnpm cf-typegen`.
- `open-next.config.ts` — cấu hình cache của adapter (mặc định: không cache layer).
- `next.config.ts` — gọi `initOpenNextCloudflareForDev()` để `next dev` thấy binding Cloudflare.

Deploy lần đầu cần đăng nhập: `pnpm exec wrangler login`.
