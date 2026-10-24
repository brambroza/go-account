import { endOfMonth, monthKeyOf, docPeriodCode } from './thai-date';

import type { ISODate } from './types';

// ----------------------------------------------------------------------

export const DOC_PREFIX = {
  taxInvoice: 'IV',
  /** ใบแจ้งหนี้ของบริษัทที่ไม่จด VAT (ไม่ใช่ใบกำกับภาษี) */
  invoice: 'BL',
  creditNote: 'CN',
  /** ใบลดหนี้ของบริษัทที่ไม่จด VAT */
  creditMemo: 'CM',
  /** ใบเพิ่มหนี้ ม.86/9 (ผู้จด VAT) */
  debitNote: 'DN',
  /** ใบเพิ่มหนี้ของบริษัทที่ไม่จด VAT (ไม่ใช่เอกสารภาษี) */
  debitMemo: 'DM',
  receipt: 'RE',
  /** ใบเสร็จรับเงิน/ใบกำกับภาษี ของงานบริการ (ม.78/1) — ออกเมื่อรับชำระ */
  receiptTaxInvoice: 'RT',
  purchase: 'PI',
  /** ใบลดหนี้จากผู้ขาย (เลขที่ภายใน) */
  purchaseCredit: 'PC',
  payment: 'PV',
  /** หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) */
  whtCert: 'WT',
  /** คืนเงินลูกค้า */
  refund: 'RF',
  /** รับเงินคืนจากผู้ขาย (ใบลดหนี้หลังจ่ายแล้ว) */
  supplierRefund: 'SR',
  /** โอนเงินระหว่างบัญชีของบริษัท */
  transfer: 'TR',
  /** ใบเสนอราคา (ไม่ใช่เอกสารภาษี ไม่ลงบัญชี — ไม่บังคับเรียงตามวันที่) */
  quotation: 'QT',
  journal: 'JV',
} as const;

export type DocPrefix = (typeof DOC_PREFIX)[keyof typeof DOC_PREFIX];

/**
 * prefix ที่วันที่ต้องไม่ถอยหลังจากเอกสารใบก่อน (เลขที่เรียงตามวันที่)
 * PI เรียงตามวันที่ด้วยตั้งแต่ข้อมูล v4: วันที่เอกสารซื้อคือ "วันที่บันทึก" ส่วนวันที่ในใบกำกับผู้ขาย
 * (ซึ่งมาถึงไม่เรียงกัน) แยกเป็น `supplierInvoiceDate` และเดือนใช้สิทธิภาษีซื้อเป็น `vatClaimPeriod`
 * ยกเว้น JV — เลขภายในของสมุดรายวัน ออกตามลำดับการบันทึก (รวมรายการปิดภาษีเดือนที่ลงวันสิ้นเดือน)
 */
export const DATE_ORDERED_PREFIXES: readonly DocPrefix[] = [
  'IV',
  'BL',
  'CN',
  'CM',
  'DN',
  'DM',
  'RE',
  'RT',
  'PI',
  'PC',
  'PV',
  'WT',
  'RF',
  'SR',
  'TR',
];

const DOC_NO_PATTERN = /^([A-Z]{2})(\d{4})-(\d{4,})$/;

/** แยกเลขที่เอกสาร `IV6910-0043` → { prefix: 'IV', period: '6910', seq: 43 } (ไม่ตรงรูปแบบคืน null) */
export function parseDocNo(docNo: string): { prefix: string; period: string; seq: number } | null {
  const m = DOC_NO_PATTERN.exec(docNo);
  if (!m) return null;
  return { prefix: m[1], period: m[2], seq: Number(m[3]) };
}

/**
 * เลขที่เอกสารเรียงต่อเนื่องต่อ prefix ต่องวด: IV6910-0043
 * (ใบกำกับภาษีต้องเรียงเลขต่อเนื่อง ห้ามข้าม ห้ามซ้ำ — backend จริงต้องออกเลขใน transaction เดียวกับการบันทึก)
 */
export function nextDocNo(
  sequences: Record<string, number>,
  prefix: DocPrefix,
  date: ISODate
): { docNo: string; key: string; value: number } {
  const key = `${prefix}${docPeriodCode(date)}`;
  const value = (sequences[key] ?? 0) + 1;
  return { docNo: `${key}-${String(value).padStart(4, '0')}`, key, value };
}

const SYSTEM_PREFIXES: readonly string[] = Object.values(DOC_PREFIX);

/**
 * เลขที่ของระบบเดิม (ใบค้างรับ/ค้างจ่ายยอดยกมา) ที่ระบบนี้อาจออกเลขซ้ำภายหลัง — ใช้ตอนบันทึกยอดยกมาและตรวจข้อมูล
 * - รูปแบบเลขที่ของระบบนี้ (prefix ของระบบ + งวด พ.ศ. YYMM + ลำดับ) และงวดอยู่หลังเดือนยอดยกมา → ชนได้
 * - งวดไม่เกินเดือนยอดยกมา (เช่นเลขของ Express เดือนก่อน ๆ) ระบบไม่ออกอีกแล้ว เพราะทุกรายการลงวันที่หลังวันยอดยกมา
 *   ยกเว้น JV ของเดือนยอดยกมา (รายการบัญชียอดยกมาใช้เลข JV งวดนั้น) และข้อมูลเดิมที่ยกยอดกลางเดือน (งวดเดียวกันยังออกต่อได้)
 */
export function openingNumberConflict(docNo: string, openingDate: ISODate): boolean {
  const parsed = parseDocNo(docNo.trim().toUpperCase());
  if (!parsed || !SYSTEM_PREFIXES.includes(parsed.prefix)) return false;
  const openingPeriod = docPeriodCode(openingDate);
  if (parsed.period > openingPeriod) return true;
  if (parsed.period < openingPeriod) return false;
  return parsed.prefix === DOC_PREFIX.journal || endOfMonth(monthKeyOf(openingDate)) !== openingDate;
}
