import { AgentRoutingMap } from "@/components/AgentRoutingMap";
import { HeroStats } from "@/components/HeroStats";
import { ButtonLink } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { HERO, LINKS } from "@/content/copy";

/**
 * Mốc thời gian màn mở đầu (design-system §6, ngoại lệ hero).
 * Nội dung nằm sẵn trong HTML từ t=0 — animation chỉ điều khiển CÁCH nó hiện ra.
 */
const T = {
  eyebrow: 80,
  headline: 160,
  headlineStep: 90,
  sub: 280,
  cta: 380,
  ctaNote: 460,
  routingMap: 520,
} as const;

export function Hero() {
  return (
    <section className="hero-glow">
      {/* Hai cột: chữ trái, chòm agent phải. Bố cục canh giữa cũ đẩy mọi thứ vào một
          cột hẹp giữa trang và để trống hai bên — cùng lượng nội dung nhưng tốn gấp
          đôi chiều cao. */}
      <div className="container-content grid items-center gap-12 py-16 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16 lg:py-24">
        <div>
          <p
            className="badge reveal"
            style={{ "--d": `${T.eyebrow}ms` } as React.CSSProperties}
          >
            <Icon name="zap" size={14} />
            {HERO.eyebrow}
          </p>

          <h1 className="mt-6 text-h1 text-strong md:text-display">
            {HERO.headlineLines.map((line, i) => (
              <span
                key={line}
                className="reveal block text-balance"
                style={
                  {
                    "--d": `${T.headline + i * T.headlineStep}ms`,
                  } as React.CSSProperties
                }
              >
                {line}
              </span>
            ))}
          </h1>

          <p
            className="reveal mt-6 max-w-xl text-body-lg text-body"
            style={{ "--d": `${T.sub}ms` } as React.CSSProperties}
          >
            {HERO.sub}
          </p>

          <HeroStats />

          <div
            className="reveal-pop mt-8 flex flex-wrap items-center gap-3"
            style={{ "--d": `${T.cta}ms` } as React.CSSProperties}
          >
            <ButtonLink href={LINKS.register} variant="primary">
              {HERO.ctaPrimary}
            </ButtonLink>
            <ButtonLink href={LINKS.zaloChat} variant="secondary">
              {HERO.ctaSecondary}
            </ButtonLink>
          </div>

          <p
            className="reveal mt-4 text-sm text-muted"
            style={{ "--d": `${T.ctaNote}ms` } as React.CSSProperties}
          >
            {HERO.ctaNote}
          </p>
        </div>

        <div
          className="reveal-pop"
          style={{ "--d": `${T.routingMap}ms` } as React.CSSProperties}
        >
          <AgentRoutingMap />
        </div>
      </div>
    </section>
  );
}
