import type { ButtonHTMLAttributes, ReactNode } from "react";

// design-system §8.1. Hover = opacity 0.9 (KHÔNG đổi màu), disabled = opacity 0.45.
// Pill 9999px là hình dấu ấn của brand — chỉ biến thể `nav` được dùng radius 8px.

// Vùng chạm tối thiểu 44px (WCAG 2.5.5 / Apple HIG). Padding cũ cho ra nút cao
// 31–38px. `min-h` giữ chiều cao mà không phải nới padding ngang.
// `touch-action: manipulation` bỏ độ trễ 300ms khi chạm hai lần trên mobile.
const BASE =
  "inline-flex min-h-11 touch-manipulation items-center justify-center gap-2 text-button font-medium transition hover:opacity-90";

const VARIANT = {
  primary:
    "bg-btn-primary-bg text-btn-primary-fg px-6 py-2 rounded-pill shadow-button",
  secondary:
    "bg-surface-card text-strong px-5 py-2 rounded-pill border border-border-strong",
  nav: "bg-transparent text-strong px-3 py-2 rounded-md hover:bg-surface-sunken",
  brand: "bg-brand text-[#0d0d0d] px-6 py-2 rounded-pill",
} as const;

export type ButtonVariant = keyof typeof VARIANT;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${BASE} disabled:pointer-events-none disabled:opacity-45 ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

interface ButtonLinkProps {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly className?: string;
  readonly children: ReactNode;
}

/** Cùng hình dạng với Button — dùng cho CTA điều hướng (Zalo OA, form đăng ký). */
export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
}: ButtonLinkProps) {
  return (
    <a
      href={href}
      className={`${BASE} ${VARIANT[variant]} ${className}`}
    >
      {children}
    </a>
  );
}
