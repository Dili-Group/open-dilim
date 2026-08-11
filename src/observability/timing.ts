// timing.ts — bấm giờ từng khâu trong MỘT lượt worker.
//
// Loop agent đã tự đo LLM và tool (agents/runtime/loop.ts), nhưng phần còn lại của lượt thì không:
// một lượt 16s nhìn y hệt nhau dù mất thời gian ở AUTH (Postgres chậm), ở nạp ngữ cảnh (mấy lượt
// Redis nối tiếp), ở LLM, hay ở đường ghi trí nhớ CHẠY SAU khi đã trả lời xong.
//
// Chỉ ghi SỐ, không ghi nội dung — cùng nguyên tắc với logCacheUsage và trace của loop.

/** Đồng hồ một lượt: `lap` chốt khâu vừa xong, `summary` in cả chuỗi + tổng. */
export interface TurnTimer {
  /** Chốt khoảng từ lap trước (hoặc lúc bắt đầu) tới giờ, đặt tên là `step`. */
  lap(step: string): void;
  /** `"auth=41ms ctx=212ms agent=6498ms tổng=16084ms"`. */
  summary(): string;
}

/** `now` tiêm được để test không phụ thuộc đồng hồ thật. */
export function startTurnTimer(now: () => number = Date.now): TurnTimer {
  const startedAt = now();
  let lastAt = startedAt;
  const laps: string[] = [];
  return {
    lap(step: string): void {
      const at = now();
      laps.push(`${step}=${at - lastAt}ms`);
      lastAt = at;
    },
    summary(): string {
      return [...laps, `tổng=${now() - startedAt}ms`].join(" ");
    },
  };
}
