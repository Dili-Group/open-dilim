import Link from "next/link";

import { ButtonLink } from "@/components/ui/Button";
import { LogoLockup } from "@/components/ui/Logo";
import { HERO, LINKS } from "@/content/copy";

// design-system §8.4: header ngang, sticky, backdrop blur 12px trên nền 82% opacity,
// viền dưới 5%. Logo trái, CTA pill canh phải.
export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border-subtle bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-[12px]">
      <div className="container-content flex h-16 items-center justify-between gap-4">
        <Link href="/" aria-label="DiLiM — trang chủ" className="flex items-center">
          <LogoLockup height={28} />
        </Link>

        <ButtonLink href={LINKS.register} variant="primary">
          {HERO.ctaPrimary}
        </ButtonLink>
      </div>
    </header>
  );
}
