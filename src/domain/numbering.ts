import { docPeriodCode } from './thai-date';

import type { ISODate } from './types';

// ----------------------------------------------------------------------

export const DOC_PREFIX = {
  taxInvoice: 'IV',
  creditNote: 'CN',
  receipt: 'RE',
  purchase: 'PI',
  payment: 'PV',
  journal: 'JV',
} as const;

export type DocPrefix = (typeof DOC_PREFIX)[keyof typeof DOC_PREFIX];

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
