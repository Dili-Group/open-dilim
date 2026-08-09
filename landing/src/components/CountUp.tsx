"use client";

import { useEffect, useRef, useState } from "react";

const FORMATTER = new Intl.NumberFormat("vi-VN");

interface CountUpProps {
  readonly to: number;
  readonly durationMs?: number;
  readonly delayMs?: number;
}

/**
 * Đếm số cho trust bar.
 *
 * Render sẵn giá trị CUỐI ở HTML đầu tiên → không CLS, và tắt JS vẫn thấy số đúng.
 * Client tua về 0 ngay trong khung hình rAF đầu tiên; lúc đó khối cha `.reveal` còn
 * ở opacity 0 (chưa tới delay của nó) nên người dùng không thấy nháy.
 *
 * Cả pha chờ lẫn pha đếm nằm chung một vòng rAF — không setTimeout, không setState
 * thẳng trong effect.
 */
export function CountUp({ to, durationMs = 900, delayMs = 0 }: CountUpProps) {
  const [value, setValue] = useState(to);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || to === 0) return;

    let mountedAt: number | undefined;

    const step = (now: number) => {
      mountedAt ??= now;
      const elapsed = now - mountedAt - delayMs;

      if (elapsed < 0) {
        setValue(0);
      } else {
        const t = Math.min(elapsed / durationMs, 1);
        // easeOutCubic — nhanh lúc đầu, hãm dần, khớp cảm giác các reveal khác.
        setValue(Math.round(to * (1 - Math.pow(1 - t, 3))));
        if (t >= 1) return;
      }

      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, [to, durationMs, delayMs]);

  return <>{FORMATTER.format(value)}</>;
}
