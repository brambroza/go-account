import type { ISODate } from './types';

// ----------------------------------------------------------------------

const MONTHS_TH = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

const MONTHS_TH_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

export type Period = { year: number; month: number }; // ค.ศ., 1-12

function parts(date: ISODate) {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

/** ช่วงปี ค.ศ. ที่ยอมรับ — ปีนอกช่วงนี้มักเป็น พ.ศ. ที่กรอกผิดช่อง (เช่น 2569-10-24) */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

/** ตรวจว่าเป็นวันที่ ISO `YYYY-MM-DD` (ค.ศ.) ที่มีอยู่จริงและอยู่ในช่วงปีที่สมเหตุสมผล */
export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { y, m, d } = parts(value);
  if (y < MIN_YEAR || y > MAX_YEAR) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function toBE(yearAD: number): number {
  return yearAD + 543;
}

/** 24/10/2569 */
export function formatThaiDate(date: ISODate | undefined): string {
  if (!date) return '';
  const { y, m, d } = parts(date);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${toBE(y)}`;
}

/** 24 ต.ค. 2569 */
export function formatThaiDateShort(date: ISODate | undefined): string {
  if (!date) return '';
  const { y, m, d } = parts(date);
  return `${d} ${MONTHS_TH_SHORT[m - 1]} ${toBE(y)}`;
}

/** DDMMYYYY (พ.ศ.) ตาม Format กลาง เช่น 01012568 */
export function toRdDate(date: ISODate | undefined): string {
  if (!date) return '00000000';
  const { y, m, d } = parts(date);
  return `${String(d).padStart(2, '0')}${String(m).padStart(2, '0')}${toBE(y)}`;
}

export function periodOf(date: ISODate): Period {
  const { y, m } = parts(date);
  return { year: y, month: m };
}

export function inPeriod(date: ISODate, period: Period): boolean {
  const p = periodOf(date);
  return p.year === period.year && p.month === period.month;
}

export function periodLabel(period: Period): string {
  return `${MONTHS_TH[period.month - 1]} ${toBE(period.year)}`;
}

export function periodShortLabel(period: Period): string {
  return `${MONTHS_TH_SHORT[period.month - 1]} ${String(toBE(period.year)).slice(-2)}`;
}

export function shiftPeriod(period: Period, delta: number): Period {
  const index = period.year * 12 + (period.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** prefix งวดในเลขที่เอกสาร: YYMM แบบ พ.ศ. เช่น ต.ค. 2569 → 6910 */
export function docPeriodCode(date: ISODate): string {
  const { y, m } = parts(date);
  return `${String(toBE(y)).slice(-2)}${String(m).padStart(2, '0')}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  const { y, m, d } = parts(date);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(from: ISODate, to: ISODate): number {
  const a = parts(from);
  const b = parts(to);
  return Math.round(
    (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / (24 * 60 * 60 * 1000)
  );
}

/** วันสุดท้ายของเดือนก่อนหน้า `today` เช่น 2026-10-24 → 2026-09-30 (เพดานวันปิดงวด) */
export function endOfPreviousMonth(today: ISODate): ISODate {
  return addDays(`${today.slice(0, 7)}-01`, -1);
}

export function todayISO(): ISODate {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/** ที่มาของกำหนดยื่น: วันตามกฎหมาย (ประมวลรัษฎากร) หรือวันที่ขยายตามประกาศสำหรับการยื่นทางอินเทอร์เน็ต */
export type FilingDueDateSource = 'statutory' | 'extension-8';

/** ช่วงที่ประกาศขยายเวลายื่นทางอินเทอร์เน็ตมีผล — งวดภาษีถึง `throughPeriod` (`YYYY-MM`) ได้วันที่ขยาย */
export type FilingExtension = {
  source: Exclude<FilingDueDateSource, 'statutory'>;
  throughPeriod: string;
  /** ภ.ง.ด.1/2/3/53/54 */
  whtDay: number;
  /** ภ.พ.30 */
  vatDay: number;
  reference: string;
};

/** วันตามกฎหมาย (ยื่นแบบกระดาษ): หัก ณ ที่จ่ายภายในวันที่ 7 (ม.52, ม.59), ภ.พ.30 ภายในวันที่ 15 (ม.83) ของเดือนถัดไป */
export const STATUTORY_DUE_DAYS = { wht: 7, vat: 15 } as const;

/**
 * ประกาศขยายเวลายื่นแบบทางอินเทอร์เน็ต (ข้อมูล ไม่ใช่ตรรกะ — มีประกาศใหม่ให้เพิ่มแถว) เรียงตาม `throughPeriod`
 * ฉบับที่ 8: ยื่นทางอินเทอร์เน็ตได้ถึง 31 ม.ค. 2570 = งวดภาษีถึง ธ.ค. 2569 (2026-12) — แหล่ง: คู่มือขอคืน VAT ของกรมสรรพากร 2025
 * (https://www.rd.go.th/fileadmin/user_upload/lorkhor/newspr/2025/vat_refund.pdf) ⚠️ ยังไม่ได้อ่านจากราชกิจจานุเบกษาโดยตรง
 */
export const FILING_EXTENSIONS: readonly FilingExtension[] = [
  {
    source: 'extension-8',
    throughPeriod: '2026-12',
    whtDay: 15,
    vatDay: 23,
    reference: 'ประกาศกระทรวงการคลังเรื่องขยายเวลาการยื่นแบบทางอินเทอร์เน็ต (ฉบับที่ 8) ถึง 31 ม.ค. 2570',
  },
];

/**
 * กำหนดยื่นแบบของงวด (ยื่นทางอินเทอร์เน็ต): งวดที่ประกาศขยายเวลาครอบคลุม = วันที่ขยาย (ภ.ง.ด. 15 / ภ.พ.30 23)
 * งวดหลังประกาศฉบับล่าสุด = วันตามกฎหมาย (7 / 15) พร้อม `dueDateSource: 'statutory'` ให้หน้าจอเตือนตรวจประกาศใหม่
 */
export function filingDueDates(
  period: Period,
  extensions: readonly FilingExtension[] = FILING_EXTENSIONS
): { wht: ISODate; vat: ISODate; dueDateSource: FilingDueDateSource } {
  const next = shiftPeriod(period, 1);
  const ym = `${next.year}-${String(next.month).padStart(2, '0')}`;
  const key = `${period.year}-${String(period.month).padStart(2, '0')}`;
  const ext = extensions.find((e) => key <= e.throughPeriod);
  const day = (d: number) => `${ym}-${String(d).padStart(2, '0')}`;
  if (ext) return { wht: day(ext.whtDay), vat: day(ext.vatDay), dueDateSource: ext.source };
  return { wht: day(STATUTORY_DUE_DAYS.wht), vat: day(STATUTORY_DUE_DAYS.vat), dueDateSource: 'statutory' };
}

// ---------------- เดือนภาษี `YYYY-MM` ----------------

/** `2026-10-24` → `2026-10` */
export function monthKeyOf(date: ISODate): string {
  return date.slice(0, 7);
}

/** `{ year: 2026, month: 10 }` → `2026-10` */
export function periodKey(period: Period): string {
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

/** `2026-10` → `{ year: 2026, month: 10 }` */
export function periodFromKey(key: string): Period {
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

/** รูปแบบเดือนภาษี `YYYY-MM` (ค.ศ.) ที่ถูกต้อง */
export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && isValidISODate(`${value}-01`);
}

/** เลื่อนเดือน `2026-10` + 3 → `2027-01` */
export function shiftMonthKey(key: string, delta: number): string {
  return periodKey(shiftPeriod(periodFromKey(key), delta));
}

/** วันสิ้นเดือน `2026-02` → `2026-02-28` */
export function endOfMonth(key: string): ISODate {
  return addDays(`${shiftMonthKey(key, 1)}-01`, -1);
}
