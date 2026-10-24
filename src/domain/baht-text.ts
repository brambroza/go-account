import { toSatang } from './money';

// ----------------------------------------------------------------------
// จำนวนเงินเป็นตัวอักษรภาษาไทย (แบบ BAHTTEXT ของ Excel) — ใช้บนใบกำกับ ใบสำคัญจ่าย และ 50 ทวิ
// กติกา: หลักหน่วยที่เป็น 1 และมีหลักอื่นอยู่ข้างหน้า อ่าน "เอ็ด" (21 = ยี่สิบเอ็ด, 101 = หนึ่งร้อยเอ็ด,
// 1,000,001 = หนึ่งล้านเอ็ด), หลักสิบที่เป็น 2 อ่าน "ยี่", หลักสิบที่เป็น 1 อ่าน "สิบ",
// เกินล้านอ่านซ้ำเป็นชุดละ 6 หลัก (ล้านล้าน), ไม่มีสตางค์ลงท้าย "บาทถ้วน"
// ----------------------------------------------------------------------

const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** อ่านเลข 1–999,999 — `hasHigher` = มีหลักล้านขึ้นไปนำหน้า (หลักหน่วยที่เป็น 1 จึงอ่าน "เอ็ด") */
function readGroup(n: number, hasHigher: boolean): string {
  const digits = String(n).split('').map(Number);
  const len = digits.length;
  return digits
    .map((d, i) => {
      const place = len - 1 - i;
      if (d === 0) return '';
      if (place === 0) return d === 1 && (len > 1 || hasHigher) ? 'เอ็ด' : DIGITS[d];
      if (place === 1) {
        if (d === 1) return 'สิบ';
        if (d === 2) return 'ยี่สิบ';
      }
      return `${DIGITS[d]}${PLACES[place]}`;
    })
    .join('');
}

/** อ่านจำนวนเต็มบวก (ไม่จำกัดหลักล้าน) */
function readInteger(n: number): string {
  if (n === 0) return DIGITS[0];
  const groups: number[] = [];
  let rest = n;
  while (rest > 0) {
    groups.unshift(rest % 1000000);
    rest = Math.floor(rest / 1000000);
  }
  return groups
    .map((g, i) => {
      const text = g === 0 ? '' : readGroup(g, i > 0);
      return i < groups.length - 1 ? `${text}ล้าน` : text;
    })
    .join('');
}

/**
 * จำนวนเงินเป็นตัวอักษร เช่น 1,070.50 → "หนึ่งพันเจ็ดสิบบาทห้าสิบสตางค์", 0 → "ศูนย์บาทถ้วน"
 * ปัดเป็นสตางค์ half-up ก่อนอ่าน, ติดลบขึ้นต้นด้วย "ลบ"
 */
export function bahtText(amount: number): string {
  const satangTotal = toSatang(amount);
  const negative = satangTotal < 0;
  const abs = Math.abs(satangTotal);
  const baht = Math.floor(abs / 100);
  const satang = abs % 100;

  let text: string;
  if (baht === 0 && satang > 0) {
    text = `${readInteger(satang)}สตางค์`;
  } else {
    text = `${readInteger(baht)}บาท${satang > 0 ? `${readInteger(satang)}สตางค์` : 'ถ้วน'}`;
  }
  return negative ? `ลบ${text}` : text;
}
