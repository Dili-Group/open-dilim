/**
 * Hằng số SEO dùng chung cho metadata, sitemap, robots và JSON-LD.
 * Đổi domain ở đây, không rải literal khắp nơi.
 */

/** Không có dấu `/` cuối — mọi chỗ nối đường dẫn đều tự thêm. */
export const SITE_URL = "https://open-dilim.dilisupplement.com";

export const SITE = {
  url: SITE_URL,
  name: "DiLiM",
  /** Dùng cho `title.template` — tab trình duyệt và SERP đều thấy. */
  shortName: "DiLiM",
  locale: "vi_VN",
  title: "DiLiM — Agent AI vận hành đơn hàng cho đại lý, trực 24/7",
  description:
    "DiLiM là hệ agent AI vận hành đơn hàng cho đại lý: tra đơn, báo hết hàng, chốt sổ cuối ngày, trả lời ngay trên nhóm chat kể cả 2 giờ sáng. 6 agent chuyên trách, 200+ đại lý đang chạy.",
  /**
   * Ba nhóm từ khoá theo mức khả thi giảm dần: brand (top 1 khả thi) →
   * long-tail tiếng Việt (khả thi) → từ rộng (chỉ phủ on-page).
   */
  keywords: [
    "dilim",
    "dilim agent",
    "DiLiM AI",
    "agent dilim",
    "dili supplement",
    "agent AI đại lý",
    "AI vận hành đơn hàng",
    "agent AI tra đơn hàng",
    "chatbot Zalo cho đại lý",
    "AI chốt sổ cuối ngày",
    "trợ lý AI bán hàng",
    "hệ thống agent AI tiếng Việt",
    "agent",
    "AI agent",
  ],
} as const;

/** Đường dẫn tuyệt đối từ path tương đối. `absoluteUrl("/")` → domain gốc. */
export function absoluteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}
