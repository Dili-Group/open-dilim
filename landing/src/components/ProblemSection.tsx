import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PROBLEM } from "@/content/copy";

// §6 chỉ nới luật chuyển động cho hero — các section dưới fold KHÔNG animate khi
// scroll. Đứng yên, đọc được ngay, không tốn JS.
export function ProblemSection() {
  return (
    <section className="section-pad border-t border-border-subtle bg-bg-subtle">
      <div className="container-content">
        {/* Tiêu đề trái, dẫn nhập phải: khoá cả hai ở max-w-2xl thì 44% chiều ngang
            bên phải bỏ trống, section đọc ra rỗng. */}
        <div className="grid gap-x-12 gap-y-4 md:grid-cols-12 md:items-end">
          <h2 className="text-balance text-h1 text-strong md:col-span-7">
            {PROBLEM.heading}
          </h2>
          <p className="text-body-lg text-body md:col-span-5">{PROBLEM.lead}</p>
        </div>

        {/* `featured` ở đây để lấy hộp lớn (rounded-xl p-8), không phải để nhấn:
            ba card này chữ ngắn, ở p-6 chúng lùn hơn nhịp dọc của section. */}
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PROBLEM.cards.map((card) => (
            <Card key={card.title} featured>
              <Icon name={card.icon as IconName} className="text-accent" />
              <h3 className="mt-5 text-h3 text-strong">{card.title}</h3>
              {/* Không đặt class màu: thừa hưởng --text-body (#333) từ body.
                  Ở #666 chữ thân card 16px trên nền trắng đọc ra nhợt. */}
              <p className="mt-3 text-body">{card.body}</p>
            </Card>
          ))}
        </div>

        {/* max-w-2xl ≈ 70 ký tự/dòng. Rộng hơn thì mắt khó bắt đầu dòng kế tiếp. */}
        <p className="mt-10 max-w-2xl text-body-lg text-strong">{PROBLEM.close}</p>
      </div>
    </section>
  );
}
