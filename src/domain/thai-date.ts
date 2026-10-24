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

export function todayISO(): ISODate {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/**
 * กำหนดยื่นแบบของงวด (ยื่นทางอินเทอร์เน็ต): ภ.ง.ด. วันที่ 15 และ ภ.พ.30 วันที่ 23 ของเดือนถัดไป
 * เป็นค่าที่ใช้อยู่ ณ ปี 2568 — การขยายเวลายื่นออนไลน์ประกาศเป็นรายปี ต้องทบทวนทุกปี
 */
export function filingDueDates(period: Period): { wht: ISODate; vat: ISODate } {
  const next = shiftPeriod(period, 1);
  const ym = `${next.year}-${String(next.month).padStart(2, '0')}`;
  return { wht: `${ym}-15`, vat: `${ym}-23` };
}
