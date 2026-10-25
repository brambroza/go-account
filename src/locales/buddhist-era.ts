// ----------------------------------------------------------------------
// แสดงปี พ.ศ. ใน date picker โดยค่าที่เก็บยังเป็น ISO ค.ศ. — token `BBBB` (ปลั๊กอิน buddhistEra ของ dayjs)
// dayjs จัดรูปแบบ `BBBB` ได้แต่ parse ไม่ได้ จึงแปลงข้อความที่ผู้ใช้พิมพ์ (ปี พ.ศ.) กลับเป็น ค.ศ. ก่อน parse
// ----------------------------------------------------------------------

/** รูปแบบวันที่ของ date picker ทั้งระบบ: 24/10/2569 */
export const PICKER_DATE_FORMAT = 'DD/MM/BBBB';

/** รูปแบบที่ LocalizationProvider ใช้ในปฏิทิน (หัวเดือน ปุ่มเลือกปี) */
export const BUDDHIST_DATE_FORMATS = {
  year: 'BBBB',
  keyboardDate: PICKER_DATE_FORMAT,
  monthAndYear: 'MMMM BBBB',
  fullDate: 'D MMMM BBBB',
  normalDate: 'D MMMM',
  shortDate: 'D MMM',
} as const;

/**
 * แปลงข้อความวันที่ที่มีปี พ.ศ. (`format` มี `BBBB`) เป็นข้อความ/รูปแบบ ค.ศ. สำหรับ parse
 * คืน null ถ้ารูปแบบไม่มี `BBBB` (ใช้ parse ปกติ) — ปีอ่านไม่ได้ส่งต่อไปให้ parse แบบ strict ปฏิเสธเอง
 */
export function buddhistToGregorianInput(value: string, format: string): { value: string; format: string } | null {
  const index = format.indexOf('BBBB');
  if (index < 0) return null;
  const gregorianFormat = format.replace('BBBB', 'YYYY');
  // รูปแบบความกว้างคงที่ (DD/MM/BBBB) → ตำแหน่งปีตรงกัน; ไม่อย่างนั้นใช้ตัวเลข 4 หลักชุดสุดท้าย
  let start = index;
  if (value.length !== format.length) {
    const all = Array.from(value.matchAll(/\d{4}/g));
    const last = all[all.length - 1];
    if (!last || last.index === undefined) return { value, format: gregorianFormat };
    start = last.index;
  }
  const yearText = value.slice(start, start + 4);
  if (!/^\d{4}$/.test(yearText)) return { value, format: gregorianFormat };
  const year = Number(yearText) - 543;
  if (year < 1) return { value: `${value.slice(0, start)}xxxx${value.slice(start + 4)}`, format: gregorianFormat };
  return { value: `${value.slice(0, start)}${String(year).padStart(4, '0')}${value.slice(start + 4)}`, format: gregorianFormat };
}
