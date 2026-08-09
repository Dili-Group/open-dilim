import type { ReactNode } from "react";

interface CardProps {
  readonly featured?: boolean;
  /** Bật hiệu ứng nâng khi hover — chỉ dùng cho card thật sự bấm được. */
  readonly interactive?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

// design-system §8.2. Độ sâu dựa trên VIỀN, bóng chỉ nâng nhẹ. Không viền trái màu.
// Viền dùng `border-strong` (#e5e5e5): card trắng trên nền trắng mà viền 5% thì
// gần như tàng hình.
export function Card({
  featured = false,
  interactive = false,
  className = "",
  children,
}: CardProps) {
  const size = featured ? "rounded-xl p-8" : "rounded-lg p-6";
  const hover = interactive
    ? "transition hover:border-border-medium hover:-translate-y-0.5"
    : "";

  return (
    <div
      className={`bg-surface-card border border-border-strong shadow-card ${size} ${hover} ${className}`}
    >
      {children}
    </div>
  );
}
