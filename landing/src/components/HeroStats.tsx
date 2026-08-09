import { CountUp } from "@/components/CountUp";
import { STAT_ALWAYS_ON, STATS } from "@/content/copy";

/** Pha t=480ms của màn mở đầu. */
const START_MS = 480;
const STEP_MS = 80;

/**
 * Số liệu nằm ngay trong hero, ngăn nhau bằng vạch dọc — không còn là một dải riêng
 * chiếm trọn chiều ngang. Người đọc thấy tuyên bố và bằng chứng trong cùng một tầm mắt.
 */
export function HeroStats() {
  const items = [
    ...STATS.map((stat) => ({
      key: stat.label,
      label: stat.label,
      node: (
        <>
          <CountUp to={stat.value} delayMs={START_MS} />
          {stat.suffix}
        </>
      ),
    })),
    {
      key: STAT_ALWAYS_ON.label,
      label: STAT_ALWAYS_ON.label,
      node: STAT_ALWAYS_ON.value,
    },
  ];

  return (
    /* Hẹp: lưới 2 cột, không vạch ngăn — flex-wrap sẽ để lại vạch trái mồ côi ở đầu
       hàng thứ hai. Từ 640px trở lên mới xếp một hàng có vạch. */
    <dl className="mt-8 grid grid-cols-2 gap-4 sm:flex sm:flex-wrap sm:gap-x-5 sm:gap-y-4">
      {items.map((item, i) => (
        <div
          key={item.key}
          className={`reveal ${i > 0 ? "sm:border-l sm:border-border-strong sm:pl-5" : ""}`}
          style={{ "--d": `${START_MS + i * STEP_MS}ms` } as React.CSSProperties}
        >
          <dd className="font-display text-h2 font-bold text-strong tabular-nums">
            {item.node}
          </dd>
          {/* 13px: nhãn tiếng Việt dài hơn tiếng Anh, ở 14px thì bốn cột không đứng
              chung một hàng. */}
          <dt className="mt-0.5 text-[13px] leading-normal text-muted">{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}
