import { ImageResponse } from "next/og";

import { STAT_ALWAYS_ON, STATS } from "@/content/copy";

// Trang chủ là static nên Next render ảnh này lúc `next build` rồi xuất ra asset
// tĩnh — không có runtime OG generation trên Cloudflare Worker.
export const alt =
  "DiLiM — Agent AI vận hành đơn hàng cho đại lý, trực 24/7";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Satori không đọc được CSS variable trong globals.css — token phải viết thẳng.
const INK = "#0f172a";
const MUTED = "#475569";
const ACCENT = "#2563eb";
const BG = "#ffffff";

export default function OpengraphImage() {
  const facts = [
    ...STATS.map((s) => `${s.value}${s.suffix} ${s.label}`),
    `${STAT_ALWAYS_ON.value} ${STAT_ALWAYS_ON.label}`,
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: BG,
          padding: "80px 88px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 30,
            letterSpacing: 4,
            color: ACCENT,
            fontWeight: 600,
          }}
        >
          DILIM · HỆ VẬN HÀNH LUÔN MỞ
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 32,
            fontSize: 76,
            lineHeight: 1.15,
            fontWeight: 700,
            color: INK,
          }}
        >
          <span>Đơn của bạn có người trực.</span>
          <span>Kể cả 2 giờ sáng.</span>
        </div>

        <div style={{ display: "flex", marginTop: 32, fontSize: 32, color: MUTED }}>
          Agent AI tra đơn · báo hết hàng · chốt sổ cuối ngày
        </div>

        {/* Một chuỗi thay vì 4 flex item: satori co item lại cho vừa hàng và ăn mất
            cả `gap` lẫn `margin`, làm bốn số liệu dính liền nhau. */}
        <div
          style={{
            display: "flex",
            marginTop: 48,
            paddingTop: 32,
            borderTop: `2px solid ${ACCENT}`,
            fontSize: 22,
            color: INK,
          }}
        >
          {facts.join("  ·  ")}
        </div>
      </div>
    ),
    size,
  );
}
