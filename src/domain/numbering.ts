import { docPeriodCode } from './thai-date';

import type { ISODate } from './types';

// ----------------------------------------------------------------------

export const DOC_PREFIX = {
  taxInvoice: 'IV',
  /** ใบแจ้งหนี้ของบริษัทที่ไม่จด VAT (ไม่ใช่ใบกำกับภาษี) */
  invoice: 'BL',
  creditNote: 'CN',
  /** ใบลดหนี้ของบริษัทที่ไม่จด VAT */
  creditMemo: 'CM',
  receipt: 'RE',
  purchase: 'PI',
  payment: 'PV',
  /** หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) */
  whtCert: 'WT',
  /** คืนเงินลูกค้า */
  refund: 'RF',
  journal: 'JV',
} as const;

export type DocPrefix = (typeof DOC_PREFIX)[keyof typeof DOC_PREFIX];

/**
 * prefix ที่วันที่ต้องไม่ถอยหลังจากเอกสารใบก่อน (เลขที่เรียงตามวันที่)
 * ยกเว้น PI — วันที่ซื้อคือวันที่ในใบกำกับผู้ขายซึ่งมาถึงไม่เรียงกัน (รอ B3 แยก supplierInvoiceDate)
 * และ JV — เลขภายในของสมุดรายวัน ออกตามลำดับการบันทึก
 */
export const DATE_ORDERED_PREFIXES: readonly DocPrefix[] = ['IV', 'BL', 'CN', 'CM', 'RE', 'PV', 'WT', 'RF'];

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
