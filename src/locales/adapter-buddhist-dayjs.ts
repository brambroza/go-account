import type { Dayjs } from 'dayjs';

import dayjs from 'dayjs';
import buddhistEra from 'dayjs/plugin/buddhistEra';

import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';

import { buddhistToGregorianInput } from './buddhist-era';

// ----------------------------------------------------------------------

dayjs.extend(buddhistEra);

type AdapterOptions = ConstructorParameters<typeof AdapterDayjs>[0];

/** สร้าง AdapterDayjs ที่รู้จัก token `BBBB` (ปี พ.ศ.) — ใช้กับ `new` ได้เหมือน class ของ MUI */
function createBuddhistAdapter(options?: AdapterOptions): AdapterDayjs {
  const adapter = new AdapterDayjs(options);
  adapter.formatTokenMap = {
    ...adapter.formatTokenMap,
    BBBB: { sectionType: 'year', contentType: 'digit', maxLength: 4 },
  };
  const parseGregorian = adapter.parse;
  adapter.parse = (value: string, format: string): Dayjs | null => {
    const converted = buddhistToGregorianInput(value, format);
    return converted ? parseGregorian(converted.value, converted.format) : parseGregorian(value, format);
  };
  return adapter;
}

/**
 * AdapterDayjs ที่แสดง/พิมพ์ปี พ.ศ. ในช่องวันที่ ส่วนค่าภายในเป็น dayjs ค.ศ. ตามปกติ
 * (MUI X v7 ไม่รองรับ BBBB ในตัว: เพิ่ม token ให้ field แยกส่วนปี และแปลงข้อความก่อน parse)
 * เขียนเป็น constructor function ที่คืน instance ของ AdapterDayjs — tsconfig target es5 ทำให้ `class extends`
 * class ของ MUI (ES2015) ใช้ไม่ได้ใน jest; `new AdapterDayjsBuddhist()` ได้ AdapterDayjs ที่ปรับแล้ว
 */
export const AdapterDayjsBuddhist = function AdapterDayjsBuddhist(options?: AdapterOptions) {
  return createBuddhistAdapter(options);
} as unknown as typeof AdapterDayjs;
