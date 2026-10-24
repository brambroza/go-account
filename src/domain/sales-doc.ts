import type { SalesDoc } from './types';

// ----------------------------------------------------------------------
// ชนิด/ชื่อเอกสารขาย — บริษัทไม่จด VAT ห้ามออก "ใบกำกับภาษี" (ม.86/13, โทษ ม.90/4)
// ----------------------------------------------------------------------

/** เป็นเอกสารภาษี (ใบกำกับภาษี / ใบลดหนี้ ม.86/10) หรือไม่ — เข้ารายงานภาษีขายและ e-Tax เฉพาะ true */
export function isTaxDocument(doc: Pick<SalesDoc, 'isTaxInvoice' | 'vatMode'>): boolean {
  return doc.isTaxInvoice ?? doc.vatMode !== 'none';
}

/** ชื่อเอกสารที่ต้องพิมพ์บนหัวกระดาษ */
export function salesDocTitle(doc: Pick<SalesDoc, 'kind' | 'isTaxInvoice' | 'vatMode'>): string {
  const tax = isTaxDocument(doc);
  if (doc.kind === 'credit-note') return tax ? 'ใบลดหนี้/ใบกำกับภาษี' : 'ใบลดหนี้';
  return tax ? 'ใบกำกับภาษี/ใบแจ้งหนี้' : 'ใบแจ้งหนี้/ใบเสร็จรับเงิน';
}
