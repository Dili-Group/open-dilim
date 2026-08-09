import type { Metadata } from "next";
import { Geist_Mono, Lexend, Source_Sans_3 } from "next/font/google";

import { JsonLd } from "@/components/JsonLd";
import { COMPANY } from "@/content/copy";
import { SITE } from "@/lib/site";
import "./globals.css";

// Ba vai chữ: display (tiêu đề), body (nội dung đọc), mono (nhãn kỹ thuật).
// Subset `vietnamese` bắt buộc — thiếu nó dấu tiếng Việt rơi về font fallback.

// Lexend cho tiêu đề, đậm 700 — chữ rộng, khẩu độ mở, ở 48px vẫn đọc nhanh.
const display = Lexend({
  // Tên biến tránh trùng `--font-display` mà Tailwind `@theme` tự sinh ra.
  variable: "--font-display-face",
  subsets: ["latin", "vietnamese"],
  weight: ["500", "600", "700"],
});

// Source Sans 3 cho thân bài: x-height vừa, dấu tiếng Việt đặt cân, đọc tốt ở 16–18px.
const body = Source_Sans_3({
  variable: "--font-body",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  // Nhãn chòm agent là tiếng Việt viết hoa ("ĐẠI LÝ", "TRỢ LÝ RIÊNG") — thiếu subset
  // này thì riêng chữ có dấu rơi sang font hệ thống, cùng dòng hai kiểu chữ.
  subsets: ["latin", "vietnamese"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  // Bắt buộc để `alternates.canonical` và ảnh OG sinh ra URL tuyệt đối.
  metadataBase: new URL(SITE.url),
  title: {
    default: SITE.title,
    // Trang con chỉ khai tên riêng, hậu tố brand tự nối — "DiLiM" xuất hiện ở
    // mọi title là tín hiệu brand cho truy vấn thương hiệu.
    template: `%s — ${SITE.shortName}`,
  },
  description: SITE.description,
  keywords: [...SITE.keywords],
  applicationName: SITE.name,
  authors: [{ name: COMPANY.name }],
  creator: COMPANY.name,
  publisher: COMPANY.name,
  alternates: {
    canonical: "/",
    languages: { "vi-VN": "/" },
  },
  openGraph: {
    type: "website",
    locale: SITE.locale,
    url: SITE.url,
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.title,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Cho phép Google hiện snippet dài và preview ảnh lớn thay vì cắt ngắn.
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  category: "technology",
  // Điền mã khi đã xác minh Search Console: verification: { google: "..." }.
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      className={`${display.variable} ${body.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <JsonLd />
      </body>
    </html>
  );
}
