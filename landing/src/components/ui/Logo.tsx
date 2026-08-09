import Image from "next/image";

// Kích thước gốc của file — next/image cần đúng tỉ lệ để chừa chỗ, tránh CLS.
const LOCKUP = { w: 2131, h: 655 } as const;
const MARK = { w: 1555, h: 1528 } as const;

/** Lockup đầy đủ: xoáy "9" + chữ DiLiM + phụ đề SUPPLEMENT. Dùng ở header và footer. */
export function LogoLockup({ height = 32 }: { readonly height?: number }) {
  return (
    <Image
      src="/images/logo-text.png"
      alt="DiLiM Supplement"
      width={Math.round((height * LOCKUP.w) / LOCKUP.h)}
      height={height}
      priority
    />
  );
}

/** Chỉ biểu tượng xoáy "9". Dùng khi hẹp chỗ. */
export function LogoMark({ size = 32 }: { readonly size?: number }) {
  return (
    <Image
      src="/images/logo-icon.png"
      alt=""
      aria-hidden
      width={Math.round((size * MARK.w) / MARK.h)}
      height={size}
    />
  );
}
