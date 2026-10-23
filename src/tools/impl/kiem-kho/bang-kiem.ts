// bang-kiem.ts — chữ con đọc ảnh chép lại từ ảnh BẢNG KIỂM KHO → số đếm từng mã, kèm kiểm chéo.
//
// Vì sao kiểm bằng code chứ không tin con đọc ảnh: bảng 30+ dòng số, đọc lệch một chữ số
// (4.347 → 4.341) là ghi sai tồn kho im lặng — và ca sáng bị so MISA ngay khi nộp. Bảng của kho có
// sẵn hai thứ để bắt lỗi đó: dòng Cộng, và công thức KK Chiều = KK Sáng + Hoàn + Nhập − Xuất. Số
// đọc ra khớp cả hai mới đáng ghi; lệch thì KHÔNG ghi gì, nhờ kho chụp lại.
//
// File thuần: không I/O, không model — test trên chữ chép thật của ảnh kho.

import { CountShift } from "../../../operational/types.ts";

/** Thứ tự 5 ô số mỗi dòng, đúng thứ tự cột trên bảng kho. */
const COLUMN = { Sang: 0, Hoan: 1, Nhap: 2, Xuat: 3, Chieu: 4 } as const;
const COLUMN_COUNT = 5;
const COLUMN_LABEL = ["KK Sáng", "Hàng Hoàn", "Hàng Nhập", "Hàng Xuất", "KK Chiều"] as const;

/** Ô trống = null. Trống KHÔNG phải 0 khi đọc, nhưng nộp phiên thì backend tính 0 (như web). */
type Cell = number | null;

export interface SheetRow {
  readonly stt: number;
  /** undefined = dòng không có mã hàng (hàng tặng chưa đặt mã) — không ghi được. */
  readonly sku?: string;
  readonly cells: readonly Cell[];
}

export interface ParsedSheet {
  /** Số ngày trên đầu nhóm cột, undefined = không đọc ra. */
  readonly day?: number;
  readonly rows: readonly SheetRow[];
  readonly total?: readonly Cell[];
  /** Dòng/ô đọc không ra — có thứ gì ở đây là KHÔNG ghi. */
  readonly problems: readonly string[];
}

export type SheetCheck =
  | {
      readonly ok: true;
      readonly lines: readonly { readonly sku: string; readonly quantity: number }[];
      /** Dòng không mã nhưng có số — báo lại để kho biết số đó không vào sổ. */
      readonly skipped: readonly { readonly stt: number; readonly quantity: number }[];
      readonly total: number;
    }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Câu hỏi cho con đọc ảnh. Dạng `- <nhãn>: <giá trị>` trùng với khung trả lời cố định của
 * vision/prompt.ts, nên luật chống bịa ở đó ([không đọc được], [?]) vẫn áp lên từng ô.
 */
export function sheetQuestion(day: number): string {
  return [
    "Ảnh là BẢNG KIỂM KHO: cột STT, MÃ HÀNG, TÊN HÀNG, ĐVT, rồi mỗi ngày một nhóm 5 cột KK Sáng,",
    "Hàng Hoàn, Hàng Nhập, Hàng Xuất, KK Chiều (số ngày ghi trên đầu nhóm cột); dòng cuối là Cộng.",
    `Chỉ chép nhóm cột của ngày ${day}. Ảnh không có nhóm cột ngày ${day} thì chép nhóm cột đầu`,
    "tiên và ghi đúng số ngày của nhóm đó.",
    "Chép TẤT CẢ các dòng của bảng, không bỏ dòng nào, mỗi dòng một mục THẤY đúng dạng:",
    "- Ngày: <số ngày trên đầu nhóm cột>",
    "- <STT>: <MÃ HÀNG>|<KK Sáng>|<Hàng Hoàn>|<Hàng Nhập>|<Hàng Xuất>|<KK Chiều>",
    "- Cộng: <KK Sáng>|<Hàng Hoàn>|<Hàng Nhập>|<Hàng Xuất>|<KK Chiều>",
    'Ô ghi dấu gạch thì chép "-". Ô trống để trống giữa hai dấu |. Dòng không có mã hàng thì để',
    "trống phần mã. Không chép tên hàng, ĐVT. Số giữ nguyên dấu chấm ngăn nghìn (4.347).",
  ].join("\n");
}

/** `- <nhãn>: <giá trị>` — gạch đầu dòng tuỳ chọn, con đọc ảnh có lúc bỏ. */
const ITEM_LINE = /^\s*[-*•]?\s*([^:]+?)\s*:\s*(.*)$/;
const ROW_LABEL = /^(?:stt\s*)?(\d{1,3})$/i;
const TOTAL_LABEL = /^(?:cộng|cong|tổng cộng|tổng)$/i;
const DAY_LABEL = /^ngày$/i;
const SKU_PATTERN = /^[A-Za-z0-9._-]+$/;

export function parseSheet(text: string): ParsedSheet {
  let day: number | undefined;
  let total: Cell[] | undefined;
  const rows: SheetRow[] = [];
  const problems: string[] = [];

  for (const line of text.split("\n")) {
    const item = ITEM_LINE.exec(line);
    const label = item?.[1]?.trim();
    const value = item?.[2] ?? "";
    if (label === undefined) continue;

    if (DAY_LABEL.test(label)) {
      day = readDay(value);
      continue;
    }
    if (TOTAL_LABEL.test(label)) {
      const parts = value.split("|");
      // Có con đọc ảnh chừa sẵn ô mã trống cho dòng Cộng → 6 ô, bỏ ô đầu.
      const cells = readCells(parts.length === COLUMN_COUNT + 1 ? parts.slice(1) : parts);
      if (cells === undefined) problems.push("dòng Cộng: có ô không đọc rõ");
      else total = cells;
      continue;
    }
    const stt = ROW_LABEL.exec(label)?.[1];
    if (stt === undefined) continue;
    const row = readRow(Number(stt), value);
    if (typeof row === "string") problems.push(row);
    else rows.push(row);
  }

  return {
    ...(day === undefined ? {} : { day }),
    rows,
    ...(total === undefined ? {} : { total }),
    problems,
  };
}

/**
 * Kiểm chéo rồi rút số của cột cần ghi. Thứ tự kiểm: đọc hỏng → thiếu dòng → trùng mã → đúng
 * ngày → dòng Cộng → công thức (chỉ ca tối). Gom hết lỗi một lần để kho chụp lại một lần là xong.
 */
export function checkSheet(sheet: ParsedSheet, shift: CountShift, day: number): SheetCheck {
  if (sheet.rows.length === 0 && sheet.problems.length === 0) {
    return { ok: false, problems: ["không đọc ra dòng nào của bảng kiểm kho"] };
  }
  const column = shift === CountShift.DauNgay ? COLUMN.Sang : COLUMN.Chieu;
  const problems = [
    ...sheet.problems,
    ...missingRows(sheet.rows),
    ...duplicatedSkus(sheet.rows),
    ...wrongDay(sheet.day, day),
    ...totalMismatch(sheet, column),
    ...(shift === CountShift.CuoiNgay ? formulaMismatch(sheet.rows) : []),
  ];
  if (problems.length > 0) return { ok: false, problems };

  const lines: { sku: string; quantity: number }[] = [];
  const skipped: { stt: number; quantity: number }[] = [];
  for (const row of sheet.rows) {
    const quantity = row.cells[column] ?? 0;
    if (row.sku !== undefined) lines.push({ sku: row.sku, quantity });
    else if (quantity > 0) skipped.push({ stt: row.stt, quantity });
  }
  // Số trên dòng Cộng (đã khớp ở trên) — đúng con số kho nhìn thấy trên bảng của mình.
  return { ok: true, lines, skipped, total: sheet.total?.[column] ?? sumColumn(sheet.rows, column) };
}

function readDay(value: string): number | undefined {
  const day = Number(/\d{1,2}/.exec(value)?.[0]);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : undefined;
}

/** Một dòng hàng, hoặc câu mô tả vì sao không đọc được (đi thẳng vào danh sách lỗi). */
function readRow(stt: number, value: string): SheetRow | string {
  const parts = value.split("|");
  if (parts.length !== COLUMN_COUNT + 1) return `dòng ${stt}: không tách được đủ ${COLUMN_COUNT} cột số`;
  const rawSku = parts[0]?.trim() ?? "";
  if (rawSku !== "" && !SKU_PATTERN.test(rawSku)) return `dòng ${stt}: mã hàng không đọc rõ`;
  const cells = readCells(parts.slice(1));
  if (cells === undefined) return `dòng ${stt}${rawSku === "" ? "" : ` (${rawSku})`}: có ô số không đọc rõ`;
  return { stt, ...(rawSku === "" ? {} : { sku: rawSku }), cells };
}

function readCells(parts: readonly string[]): Cell[] | undefined {
  if (parts.length !== COLUMN_COUNT) return undefined;
  const cells: Cell[] = [];
  for (const part of parts) {
    const cell = readCell(part);
    if (cell === undefined) return undefined;
    cells.push(cell);
  }
  return cells;
}

/**
 * Một ô số. "-" là 0 (định dạng kế toán của Excel). Dấu chấm/phẩy chỉ nhận khi là ngăn nghìn —
 * "1,5" hay "[?]" là đọc không rõ, KHÔNG đoán.
 */
function readCell(raw: string): Cell | undefined {
  const value = raw.trim();
  if (value === "") return null;
  if (/^[-–—]$/.test(value)) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  if (/^\d{1,3}([.,]\d{3})+$/.test(value)) return Number(value.replace(/[.,]/g, ""));
  return undefined;
}

/** STT phải chạy liền 1..N: hụt một số là con đọc ảnh đã bỏ sót cả một dòng. */
function missingRows(rows: readonly SheetRow[]): string[] {
  const seen = new Set(rows.map((row) => row.stt));
  const last = Math.max(0, ...seen);
  const missing: number[] = [];
  for (let stt = 1; stt <= last; stt++) if (!seen.has(stt)) missing.push(stt);
  return missing.length === 0 ? [] : [`thiếu dòng STT ${missing.join(", ")}`];
}

function duplicatedSkus(rows: readonly SheetRow[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const row of rows) {
    if (row.sku === undefined) continue;
    if (seen.has(row.sku)) repeated.add(row.sku);
    seen.add(row.sku);
  }
  return repeated.size === 0 ? [] : [`mã xuất hiện nhiều dòng: ${[...repeated].join(", ")}`];
}

/** Ảnh không ghi ngày thì không chặn — dòng Cộng vẫn bắt được bảng đọc sai. */
function wrongDay(sheetDay: number | undefined, day: number): string[] {
  if (sheetDay === undefined || sheetDay === day) return [];
  return [`ảnh là cột ngày ${sheetDay}, không phải ngày ${day}`];
}

/**
 * Dòng Cộng phải khớp tổng TẤT CẢ dòng, hoặc tổng các dòng CÓ MÃ. Vế sau có thật: bảng kho
 * 22/10/2026 ghi Cộng KK Sáng 8.912 trong khi cộng đủ 34 dòng ra 9.012 — dòng "Dù gấp 3 khúc"
 * (không mã, 100) chèn sau nên nằm ngoài vùng SUM của Excel.
 */
function totalMismatch(sheet: ParsedSheet, column: number): string[] {
  const label = COLUMN_LABEL[column] ?? "";
  const expected = sheet.total?.[column];
  if (expected === undefined || expected === null) {
    return [`không đọc được số dòng Cộng của cột ${label} để đối chiếu (ảnh cần chụp đủ dòng Cộng)`];
  }
  const sum = sumColumn(sheet.rows, column);
  const codedSum = sumColumn(
    sheet.rows.filter((row) => row.sku !== undefined),
    column,
  );
  if (sum === expected || codedSum === expected) return [];
  return [`cột ${label}: cộng các dòng ra ${sum}, dòng Cộng ghi ${expected}`];
}

function formulaMismatch(rows: readonly SheetRow[]): string[] {
  const at = (row: SheetRow, column: number): number => row.cells[column] ?? 0;
  const broken = rows.filter(
    (row) =>
      at(row, COLUMN.Sang) + at(row, COLUMN.Hoan) + at(row, COLUMN.Nhap) - at(row, COLUMN.Xuat) !==
      at(row, COLUMN.Chieu),
  );
  if (broken.length === 0) return [];
  const where = broken.map((row) => (row.sku === undefined ? `${row.stt}` : `${row.stt} (${row.sku})`));
  return [`dòng ${where.join(", ")}: KK Sáng + Hoàn + Nhập − Xuất không bằng KK Chiều`];
}

function sumColumn(rows: readonly SheetRow[], column: number): number {
  return rows.reduce((sum, row) => sum + (row.cells[column] ?? 0), 0);
}
