import { COMPANY, FAQ, HERO, STATS } from "@/content/copy";
import { SITE, absoluteUrl } from "@/lib/site";

/**
 * Structured data (schema.org) cho trang chủ, gộp trong một `@graph`.
 *
 * - `Organization` + `WebSite`: Google gắn kết quả với brand "DiLiM" — đây là thứ
 *   quyết định thứ hạng cho truy vấn thương hiệu.
 * - `SoftwareApplication`: mô tả sản phẩm là hệ agent AI, phủ nhóm từ khoá ngành.
 * - `FAQPage`: lấy đúng nội dung `FAQ` đang hiển thị. Google phạt nếu schema có
 *   câu hỏi mà người dùng không thấy trên trang — nên không sinh thêm ở đây.
 */

const ORG_ID = `${SITE.url}/#organization`;
const SITE_ID = `${SITE.url}/#website`;

const AGENT_COUNT = STATS.find((s) => s.label === "agent chuyên trách")?.value ?? 6;

export function JsonLd() {
  const graph = [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: COMPANY.name,
      alternateName: ["DiLiM", "DiLi Supplement", "DILI"],
      url: SITE.url,
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl("/images/logo-icon.png"),
      },
      email: COMPANY.email,
      telephone: COMPANY.phone,
      taxID: COMPANY.taxId,
      foundingDate: "2022-11-11",
      address: {
        "@type": "PostalAddress",
        streetAddress: "50 Đường số T21, Khu The Manhattan Glory",
        addressLocality: "Phường Long Bình, Thành phố Thủ Đức",
        addressRegion: "TP. Hồ Chí Minh",
        addressCountry: "VN",
      },
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        telephone: COMPANY.phone,
        email: COMPANY.email,
        areaServed: "VN",
        availableLanguage: ["vi"],
      },
    },
    {
      "@type": "WebSite",
      "@id": SITE_ID,
      url: SITE.url,
      name: SITE.name,
      description: SITE.description,
      inLanguage: "vi-VN",
      publisher: { "@id": ORG_ID },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE.url}/#software`,
      name: "DiLiM",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "AI Agent",
      operatingSystem: "Web, Zalo",
      description: SITE.description,
      url: SITE.url,
      inLanguage: "vi-VN",
      publisher: { "@id": ORG_ID },
      featureList: [
        "Tra cứu đơn hàng theo thời gian thực",
        "Cảnh báo hết hàng tự động",
        "Chốt sổ và đối soát công nợ cuối ngày",
        "Truy vết đơn hoàn về kho",
        `${AGENT_COUNT} agent AI chuyên trách theo từng nhóm việc`,
      ],
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "VND",
        description: HERO.ctaNote,
      },
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE.url}/#faq`,
      mainEntity: FAQ.items.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];

  return (
    <script
      type="application/ld+json"
      // Nội dung là hằng số trong repo, không phải input người dùng — không có
      // đường chèn `</script>`. `JSON.stringify` vẫn escape dấu nháy giúp.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ "@context": "https://schema.org", "@graph": graph }),
      }}
    />
  );
}
