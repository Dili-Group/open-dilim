import type { ReactNode } from "react";

// design-system §8.5. Màu semantic CHỈ sống trong badge/alert, không tô mảng lớn.
const TONE = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  info: "bg-info-bg text-info",
  danger: "bg-danger-bg text-danger",
} as const;

export type BadgeTone = keyof typeof TONE;

interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
}

export function Badge({ tone = "success", children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-pill px-3 py-1 text-label font-medium uppercase ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
