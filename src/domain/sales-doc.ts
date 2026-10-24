import { isValidThaiTaxId } from './thai-tax-id';

import type { Contact, SalesDoc } from './types';

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
  if (doc.kind === 'debit-note') return tax ? 'ใบเพิ่มหนี้/ใบกำกับภาษี' : 'ใบเพิ่มหนี้';
  return tax ? 'ใบกำกับภาษี/ใบแจ้งหนี้' : 'ใบแจ้งหนี้/ใบเสร็จรับเงิน';
}

/** ใบลดหนี้หรือใบเพิ่มหนี้ (เอกสารปรับปรุงที่อ้างใบกำกับเดิม) */
export function isAdjustmentDoc(doc: Pick<SalesDoc, 'kind'>): boolean {
  return doc.kind === 'credit-note' || doc.kind === 'debit-note';
}

/** เครื่องหมายต่อยอดขาย/ภาษีขาย: ใบลดหนี้ −1, ใบกำกับและใบเพิ่มหนี้ +1 */
export function salesSign(doc: Pick<SalesDoc, 'kind'>): 1 | -1 {
  return doc.kind === 'credit-note' ? -1 : 1;
}

/**
 * เตือน (ไม่บล็อก) ก่อนออกใบกำกับภาษีให้ลูกค้าที่ไม่มีเลขประจำตัวผู้เสียภาษีที่ถูกต้อง
 * ม.86/4 (3): ใบกำกับเต็มรูปต้องมีเลขผู้เสียภาษีของผู้ซื้อเมื่อผู้ซื้อเป็นผู้ประกอบการจดทะเบียน — ลูกค้าจะใช้เป็นภาษีซื้อไม่ได้
 */
export function buyerTaxIdWarning(
  isTaxInvoice: boolean,
  contact: Pick<Contact, 'taxId' | 'legalForm'> | undefined
): string | null {
  if (!isTaxInvoice || !contact) return null;
  if (!contact.taxId?.trim()) {
    return contact.legalForm === 'juristic'
      ? 'ลูกค้ายังไม่มีเลขประจำตัวผู้เสียภาษี — ใบกำกับเต็มรูปต้องระบุเลขของผู้ซื้อ (ม.86/4) ลูกค้าจะใช้เป็นภาษีซื้อไม่ได้'
      : 'ลูกค้ายังไม่มีเลขประจำตัวผู้เสียภาษี — ถ้าลูกค้าเป็นผู้จด VAT ต้องระบุเลข (ม.86/4) ไม่อย่างนั้นใช้เป็นภาษีซื้อไม่ได้';
  }
  if (!isValidThaiTaxId(contact.taxId)) return 'เลขประจำตัวผู้เสียภาษีของลูกค้าไม่ถูกต้อง — ตรวจก่อนออกใบกำกับ (ม.86/4)';
  return null;
}
