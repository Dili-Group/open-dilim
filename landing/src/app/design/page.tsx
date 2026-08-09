import type { Metadata } from "next";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

// Trang specimen nội bộ — kiểm tra token render đúng ở cả light/dark.
// Không nằm trong luồng landing, không link từ page nào.
// `noindex`: trang này lên SERP sẽ loãng tín hiệu brand của trang chủ.
export const metadata: Metadata = {
  title: "Design system specimen",
  robots: { index: false, follow: false },
};

const TYPE_SCALE = [
  { label: "Display Hero · 64/600", cls: "text-display font-semibold" },
  { label: "Section Heading · 40/600", cls: "text-h1 font-semibold" },
  { label: "Sub-heading · 24/500", cls: "text-h2 font-medium" },
  { label: "Card Title · 20/600", cls: "text-h3 font-semibold" },
  { label: "Body Large · 18/400", cls: "text-body-lg" },
  { label: "Body · 16/400", cls: "text-body" },
  { label: "Caption · 14/400", cls: "text-sm" },
] as const;

const SEMANTIC = [
  { name: "success", swatch: "bg-success-bg text-success" },
  { name: "warning", swatch: "bg-warning-bg text-warning" },
  { name: "info", swatch: "bg-info-bg text-info" },
  { name: "danger", swatch: "bg-danger-bg text-danger" },
] as const;

const RADII = [
  { name: "sm · 4px", cls: "rounded-sm" },
  { name: "md · 8px", cls: "rounded-md" },
  { name: "lg · 16px", cls: "rounded-lg" },
  { name: "xl · 24px", cls: "rounded-xl" },
  { name: "pill · 9999px", cls: "rounded-pill" },
] as const;

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border-subtle py-12">
      <p className="eyebrow mb-6">{title}</p>
      {children}
    </section>
  );
}

export default function DesignSpecimen() {
  return (
    <main className="container-content py-12">
      <h1 className="text-h1 font-semibold">DiLiM design system</h1>
      <p className="mt-2 text-body-lg text-muted">
        Specimen kiểm chứng token. Landing chạy light mode, không có dark mode.
      </p>

      <Section title="Typography">
        <div className="space-y-4">
          {TYPE_SCALE.map((t) => (
            <div key={t.label}>
              <p className="mono-label text-faint">{t.label}</p>
              <p className={`${t.cls} text-strong`}>Sức khoẻ mỗi ngày</p>
            </div>
          ))}
          <div>
            <p className="mono-label text-faint">Mono · nhãn kỹ thuật</p>
            <p className="mono-label text-strong">DL-2049 · SHIPPED</p>
          </div>
        </div>
      </Section>

      <Section title="Màu">
        <div className="flex flex-wrap gap-3">
          <div className="rounded-lg border border-border-subtle bg-brand px-6 py-4 text-on-brand text-sm">
            brand #2BA770
          </div>
          <div className="rounded-lg border border-border-subtle bg-brand-light px-6 py-4 text-brand-deep text-sm">
            brand-light
          </div>
          <div className="rounded-lg border border-border-subtle bg-surface-sunken px-6 py-4 text-body text-sm">
            surface-sunken
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {SEMANTIC.map((s) => (
            <div
              key={s.name}
              className={`rounded-lg px-6 py-4 text-sm ${s.swatch}`}
            >
              {s.name}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Nút">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary">Đăng ký làm đại lý</Button>
          <Button variant="brand">Chat thử agent</Button>
          <Button variant="secondary">Xem kiến trúc</Button>
          <Button variant="nav">Trang chủ</Button>
          <Button variant="primary" disabled>
            Đang gửi
          </Button>
        </div>
      </Section>

      <Section title="Badge">
        <div className="flex flex-wrap gap-3">
          {SEMANTIC.map((s) => (
            <Badge key={s.name} tone={s.name}>
              {s.name}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Input">
        <div className="max-w-sm">
          <Input placeholder="Số điện thoại Zalo" />
        </div>
      </Section>

      <Section title="Card">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <h3 className="text-h3">Card chuẩn</h3>
            <p className="mt-2 text-body text-muted">
              Radius 16px, padding 24px, viền 5%.
            </p>
          </Card>
          <Card interactive>
            <h3 className="text-h3">Card bấm được</h3>
            <p className="mt-2 text-body text-muted">
              Hover: viền đậm lên 8% và nâng 2px.
            </p>
          </Card>
          <Card featured>
            <h3 className="text-h3">Card nổi bật</h3>
            <p className="mt-2 text-body text-muted">
              Radius 24px, padding 32px.
            </p>
          </Card>
        </div>
      </Section>

      <Section title="Bo góc">
        <div className="flex flex-wrap gap-4">
          {RADII.map((r) => (
            <div
              key={r.name}
              className={`border border-border-strong bg-surface-sunken px-5 py-4 text-sm ${r.cls}`}
            >
              {r.name}
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}
