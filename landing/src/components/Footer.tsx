import { LogoLockup } from "@/components/ui/Logo";
import { COMPANY } from "@/content/copy";

const LEGAL = [
  { label: "Giấy chứng nhận doanh nghiệp số", value: COMPANY.taxId },
  { label: "Ngày cấp phép", value: COMPANY.licensedAt },
  { label: "Người đại diện", value: COMPANY.representative },
  { label: "Giờ làm việc", value: COMPANY.workingHours },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-border-subtle">
      <div className="container-content grid gap-10 py-12 md:grid-cols-3">
        <div>
          <LogoLockup height={32} />
          <p className="mt-4 text-body font-medium text-strong">{COMPANY.name}</p>
          <p className="mt-2 text-body text-muted">{COMPANY.address}</p>
        </div>

        <dl className="space-y-3">
          {LEGAL.map((row) => (
            <div key={row.label}>
              <dt className="text-sm text-faint">{row.label}</dt>
              <dd className="text-body text-body">{row.value}</dd>
            </div>
          ))}
        </dl>

        <div className="space-y-3">
          <div>
            <p className="text-sm text-faint">Điện thoại</p>
            <a
              href={`tel:${COMPANY.phone.replace(/\s/g, "")}`}
              className="text-body text-strong transition hover:text-brand-ink"
            >
              {COMPANY.phone}
            </a>
          </div>
          <div>
            <p className="text-sm text-faint">Email</p>
            <a
              href={`mailto:${COMPANY.email}`}
              className="text-body text-strong transition hover:text-brand-ink"
            >
              {COMPANY.email}
            </a>
          </div>
        </div>
      </div>

      <div className="border-t border-border-subtle">
        <div className="container-content flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-6 text-sm text-faint">
          <p>{COMPANY.productNote}</p>
          <p>{COMPANY.copyright}</p>
        </div>
      </div>
    </footer>
  );
}
