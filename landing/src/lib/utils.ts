import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Gộp class Tailwind, giữ class thắng ở cuối. Component Magic UI cần helper này. */
export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs));
}
