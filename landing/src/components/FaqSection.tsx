import { Icon } from "@/components/ui/Icon";
import { FAQ } from "@/content/copy";

/**
 * FAQ dùng `<details>` gốc: không JS, không "use client", và toàn bộ câu trả lời
 * nằm sẵn trong HTML server-render — điều kiện bắt buộc để Google đọc được và để
 * schema FAQPage trong `JsonLd` khớp với nội dung nhìn thấy trên trang.
 */
export function FaqSection() {
  return (
    <section
      id="cau-hoi-thuong-gap"
      className="section-pad border-t border-border-subtle bg-bg-subtle"
    >
      <div className="container-content">
        <p className="eyebrow text-center">{FAQ.eyebrow}</p>
        <h2 className="mt-4 text-balance text-center text-h1 text-strong">
          {FAQ.heading}
        </h2>

        {/* Khối canh giữa, nhưng chữ bên trong vẫn canh trái: câu trả lời dài 2–3
            dòng mà canh giữa thì mỗi dòng bắt đầu một chỗ, mắt phải dò lại. */}
        <div className="mx-auto mt-10 max-w-3xl divide-y divide-border-strong border-y border-border-strong">
          {FAQ.items.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
                <h3 className="text-h3 font-medium text-strong">{item.q}</h3>
                <Icon
                  name="chevron-down"
                  size={20}
                  className="mt-0.5 shrink-0 text-muted transition group-open:rotate-180"
                />
              </summary>
              <p className="mt-3 max-w-2xl text-body">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
