import { isValidThaiTaxId } from './thai-tax-id';

import type { Contact, Receipt, SalesDoc } from './types';

// ----------------------------------------------------------------------
// ชนิด/ชื่อเอกสารขาย — บริษัทไม่จด VAT ห้ามออก "ใบกำกับภาษี" (ม.86/13, โทษ ม.90/4)
// ----------------------------------------------------------------------

/** เป็นเอกสารภาษี (ใบกำกับภาษี / ใบลดหนี้ ม.86/10) หรือไม่ — เข้ารายงานภาษีขายและ e-Tax เฉพาะ true */
export function isTaxDocument(doc: Pick<SalesDoc, 'isTaxInvoice' | 'vatMode'>): boolean {
  return doc.isTaxInvoice ?? doc.vatMode !== 'none';
}

/** เอกสารคิด VAT หรือไม่ (มีบรรทัดภาษีบนเอกสาร) — ใบแจ้งหนี้งานบริการคิด VAT แต่ยังไม่ใช่ใบกำกับภาษี */
export function chargesVat(doc: Pick<SalesDoc, 'vatMode' | 'vatRate'>): boolean {
  return doc.vatMode !== 'none' && doc.vatRate > 0;
}

/**
 * เอกสารที่ภาษีขายยังไม่ถึงกำหนด (ม.78/1): ใบแจ้งหนี้งานบริการของบริษัทจด VAT และใบลดหนี้ของใบนั้นก่อนรับเงินครบ
 * VAT ลงบัญชี 2151 ภาษีขายยังไม่ถึงกำหนด ไม่เข้ารายงานภาษีขาย
 */
export function isDeferredVatDoc(doc: Pick<SalesDoc, 'saleType' | 'isTaxInvoice' | 'vatMode' | 'vatRate'>): boolean {
  return doc.saleType === 'service' && !isTaxDocument(doc) && chargesVat(doc);
}

/** ใบแจ้งหนี้งานบริการที่ภาษีขายเกิดเมื่อรับชำระ (รับเงินแล้วออกใบเสร็จรับเงิน/ใบกำกับภาษี RT) */
export function isServiceInvoice(doc: Pick<SalesDoc, 'kind' | 'saleType' | 'isTaxInvoice' | 'vatMode' | 'vatRate'>): boolean {
  return doc.kind === 'tax-invoice' && isDeferredVatDoc(doc);
}

/** ชื่อเอกสารที่ต้องพิมพ์บนหัวกระดาษ */
export function salesDocTitle(
  doc: Pick<SalesDoc, 'kind' | 'isTaxInvoice' | 'vatMode'> & Partial<Pick<SalesDoc, 'saleType' | 'vatRate' | 'opening'>>
): string {
  // ใบค้างรับจากระบบเดิม ไม่ใช่เอกสารที่ระบบนี้ออก — ห้ามพิมพ์เป็นใบแจ้งหนี้/ใบเสร็จรับเงิน (UAT U13)
  if (doc.opening) return 'ยอดลูกหนี้ยกมา';
  const tax = isTaxDocument(doc);
  if (doc.kind === 'credit-note') return tax ? 'ใบลดหนี้/ใบกำกับภาษี' : 'ใบลดหนี้';
  if (doc.kind === 'debit-note') return tax ? 'ใบเพิ่มหนี้/ใบกำกับภาษี' : 'ใบเพิ่มหนี้';
  if (tax) return 'ใบกำกับภาษี/ใบแจ้งหนี้';
  // งานบริการของบริษัทจด VAT: ใบแจ้งหนี้อย่างเดียว — ใบเสร็จรับเงิน/ใบกำกับภาษีออกตอนรับเงิน
  if (doc.saleType === 'service' && doc.vatMode !== 'none' && (doc.vatRate ?? 0) > 0) return 'ใบแจ้งหนี้';
  return 'ใบแจ้งหนี้/ใบเสร็จรับเงิน';
}

/** ชื่อใบรับเงิน: ใบเสร็จรับเงิน/ใบกำกับภาษี (งานบริการ) หรือใบเสร็จรับเงิน */
export function receiptTitle(receipt: Pick<Receipt, 'isTaxInvoice'>): string {
  return receipt.isTaxInvoice ? 'ใบเสร็จรับเงิน/ใบกำกับภาษี' : 'ใบเสร็จรับเงิน';
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
