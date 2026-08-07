// schedule.ts — cron expr → mốc chạy kế tiếp. Thuần, không I/O, không phụ thuộc giờ hệ thống.
//
// Cron 5 trường: `phút giờ ngày-trong-tháng tháng thứ`. Cú pháp hỗ trợ: `*`, `n`, `a,b`,
// `a-b`, `*/n`, `a-b/n`. Không hỗ trợ `L`/`W`/`#` (không ai cần, và đoán sai còn tệ hơn không có).
//
// GIỜ VN CỐ ĐỊNH: "17h mỗi ngày" nghĩa là 17h Hà Nội, còn server chạy UTC. Việt Nam KHÔNG có DST
// nên offset +07:00 là hằng — không cần thư viện timezone, và số học offset ở đây luôn đúng.

/** Offset Asia/Ho_Chi_Minh so với UTC (phút). Cố định — VN không đổi giờ theo mùa. */
export const VN_UTC_OFFSET_MINUTES = 420;

const MS_PER_MINUTE = 60_000;
/**
 * Trần ngày dò tới. Đủ phủ mọi lịch hợp lệ (29/2 xa nhất là 8 năm), và biến lịch KHÔNG BAO GIỜ
 * xảy ra (`0 0 30 2 *`) thành lỗi có tên thay vì vòng lặp vô tận.
 */
const MAX_DAYS_AHEAD = 366 * 8;
const CRON_FIELD_COUNT = 5;

/** 1 trường cron đã nở thành danh sách giá trị hợp lệ (sắp tăng dần, không trùng). */
interface CronSpec {
  readonly minute: readonly number[];
  readonly hour: readonly number[];
  readonly dayOfMonth: readonly number[];
  readonly month: readonly number[];
  readonly dayOfWeek: readonly number[];
  /** `*` ở ngày-trong-tháng / thứ → trường đó không ràng buộc (xem matchesDay). */
  readonly domUnrestricted: boolean;
  readonly dowUnrestricted: boolean;
}

/** Cron expr sai cú pháp = lỗi soạn job (người viết vào DB), không phải lỗi runtime → throw. */
export function parseCron(expr: string): CronSpec {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== CRON_FIELD_COUNT) {
    throw new Error(`Cron "${expr}" phải có ${CRON_FIELD_COUNT} trường (phút giờ ngày tháng thứ).`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    minute: parseField(minute, 0, 59, expr),
    hour: parseField(hour, 0, 23, expr),
    dayOfMonth: parseField(dayOfMonth, 1, 31, expr),
    month: parseField(month, 1, 12, expr),
    // 7 = chủ nhật (chuẩn cron cho phép cả 0 lẫn 7) → chuẩn hoá về 0.
    dayOfWeek: parseField(dayOfWeek, 0, 7, expr).map((d) => d % 7),
    domUnrestricted: dayOfMonth === "*",
    dowUnrestricted: dayOfWeek === "*",
  };
}

/**
 * Mốc chạy đầu tiên SAU `afterMs` (ms epoch UTC). Luôn tiến ít nhất 1 phút → gọi lại với kết quả
 * vừa trả không đứng yên tại chỗ (không có chuyện bắn hai lần cùng một mốc).
 */
export function nextRunAfter(
  expr: string,
  afterMs: number,
  offsetMinutes: number = VN_UTC_OFFSET_MINUTES,
): number {
  const spec = parseCron(expr);
  const offsetMs = offsetMinutes * MS_PER_MINUTE;
  // Làm việc trên "giờ tường" bằng cách dịch mốc UTC sang local rồi đọc bằng getUTC* — tránh
  // getMonth()/getDate() vốn theo timezone của process (khác nhau giữa máy dev và server).
  const fromLocal = Math.floor(afterMs / MS_PER_MINUTE) * MS_PER_MINUTE + MS_PER_MINUTE + offsetMs;
  const cursor = new Date(fromLocal);
  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const date = cursor.getUTCDate();

  for (let dayAhead = 0; dayAhead <= MAX_DAYS_AHEAD; dayAhead++) {
    // Date.UTC tự cuộn ngày tràn tháng/năm → không phải tự cộng lịch.
    const dayStart = new Date(Date.UTC(year, month, date + dayAhead));
    if (!matchesDay(spec, dayStart)) continue;

    for (const hour of spec.hour) {
      for (const minute of spec.minute) {
        const candidateLocal = Date.UTC(
          dayStart.getUTCFullYear(),
          dayStart.getUTCMonth(),
          dayStart.getUTCDate(),
          hour,
          minute,
        );
        if (candidateLocal < fromLocal) continue;
        return candidateLocal - offsetMs;
      }
    }
  }

  throw new Error(`Cron "${expr}" không có mốc chạy nào trong ${MAX_DAYS_AHEAD} ngày tới.`);
}

/**
 * Chuẩn cron: ngày-trong-tháng và thứ ràng buộc theo HOẶC khi cả hai đều được chỉ định
 * (`0 0 1 * 1` = ngày 1 HOẶC thứ hai). Chỉ một trường bị chỉ định → chỉ trường đó quyết.
 */
function matchesDay(spec: CronSpec, dayStart: Date): boolean {
  if (!spec.month.includes(dayStart.getUTCMonth() + 1)) return false;

  const domHit = spec.dayOfMonth.includes(dayStart.getUTCDate());
  const dowHit = spec.dayOfWeek.includes(dayStart.getUTCDay());
  if (spec.domUnrestricted && spec.dowUnrestricted) return true;
  if (spec.domUnrestricted) return dowHit;
  if (spec.dowUnrestricted) return domHit;
  return domHit || dowHit;
}

/** Nở 1 trường thành danh sách giá trị. `src` = expr gốc để lỗi chỉ đúng job hỏng. */
function parseField(raw: string, min: number, max: number, src: string): number[] {
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    for (const value of parsePart(part, min, max, src)) values.add(value);
  }
  if (values.size === 0) throw new Error(`Cron "${src}": trường "${raw}" rỗng.`);
  return [...values].sort((a, b) => a - b);
}

function parsePart(part: string, min: number, max: number, src: string): number[] {
  const [rangeText, stepText, ...extra] = part.split("/");
  if (rangeText === undefined || extra.length > 0) {
    throw new Error(`Cron "${src}": phần "${part}" sai cú pháp.`);
  }

  let step = 1;
  if (stepText !== undefined) {
    step = Number(stepText);
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Cron "${src}": bước "/${stepText}" phải là số nguyên dương.`);
    }
  }

  const { from, to } = parseRange(rangeText, min, max, src, stepText !== undefined);
  const values: number[] = [];
  for (let value = from; value <= to; value += step) values.push(value);
  return values;
}

function parseRange(
  text: string,
  min: number,
  max: number,
  src: string,
  hasStep: boolean,
): { from: number; to: number } {
  if (text === "*") return { from: min, to: max };

  const bounds = text.split("-");
  const [fromText, toText] = bounds;
  if (fromText === undefined || bounds.length > 2) {
    throw new Error(`Cron "${src}": khoảng "${text}" sai cú pháp.`);
  }

  const from = toBounded(fromText, min, max, src);
  // Giá trị đơn "17" = ĐÚNG 17. Chỉ khi có bước ("5/2") mới trải tới hết khoảng, đúng chuẩn cron.
  if (toText === undefined) return { from, to: hasStep ? max : from };
  const to = toBounded(toText, min, max, src);
  if (to < from) throw new Error(`Cron "${src}": khoảng "${text}" có cận trên nhỏ hơn cận dưới.`);
  return { from, to };
}

function toBounded(text: string, min: number, max: number, src: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Cron "${src}": giá trị "${text}" ngoài khoảng ${min}-${max}.`);
  }
  return value;
}
