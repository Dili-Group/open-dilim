import type { InputHTMLAttributes } from "react";

// design-system §8.3. Radius pill để khớp nút; focus ring xanh giữ nguyên ở cả hai theme.
type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className = "", ...rest }: InputProps) {
  return (
    <input
      className={`w-full bg-transparent text-strong placeholder:text-faint border border-border-medium rounded-pill px-3 py-2 text-body transition focus:border-accent ${className}`}
      {...rest}
    />
  );
}
