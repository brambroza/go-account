import { resolveParty } from './snapshot';
import { normalizeBranch5 } from './thai-tax-id';

import type { Contact, PurchaseDoc, PurchaseCreditNote } from './types';

// ----------------------------------------------------------------------
// ตรวจใบกำกับผู้ขายซ้ำ (กันขอคืนภาษีซื้อใบเดียวสองครั้ง) และผู้ติดต่อที่เลขผู้เสียภาษีซ้ำ
// ----------------------------------------------------------------------

const THAI_DIGIT_ZERO = 0x0e50;

/**
 * ทำเลขที่ใบกำกับให้อยู่ในรูปมาตรฐานก่อนเทียบ:
 * 1. NFKC — ตัวอักษร full-width (ＩＮＶ, ０-９, －) เป็นตัวปกติ
 * 2. เลขไทย ๐-๙ เป็นเลขอารบิก, ตัวพิมพ์ใหญ่
 * 3. ตัดศูนย์นำหน้าของตัวเลขแต่ละช่วง (001 = 0001 = 1) — ผู้ขายเติมศูนย์ไม่เท่ากันในแต่ละช่องทาง
 * 4. ตัดทุกอักขระที่ไม่ใช่ A-Z / 0-9 / อักษรไทย — ช่องว่าง, ขีด (- – —), / _ . และ zero-width
 *
 * ผลคือ "INV-001", "inv 001", "INV–001", "ＩＮＶ-001", "INV-0001", "INV/001", "INV_001" เป็นเลขเดียวกัน
 * ส่วนเลขที่ต่างกันจริง (INV-001 กับ INV-010, INV-001 กับ INV-002, IV-001 กับ INV-001) ยังต่างกัน
 * ข้อจำกัด: เลขที่ต่างกันเฉพาะตำแหน่งขีด เช่น "1-10" กับ "11-0" ของผู้ขายรายเดียวกันจะถูกมองว่าซ้ำ (แทบไม่เกิดจริง)
 */
export function normalizeInvoiceNo(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - THAI_DIGIT_ZERO))
    .toUpperCase()
    .replace(/\d+/g, (run) => run.replace(/^0+(?=\d)/, ''))
    .replace(/[^0-9A-Zก-๏]/g, '');
}

/** ตัวระบุผู้ขาย: เลขผู้เสียภาษี + สาขา จาก snapshot (ผู้ติดต่อหลายรายการที่เป็นผู้ขายรายเดียวกันได้ค่าเดียวกัน) */
export function supplierKey(contactId: string, party: { taxId?: string; branchNo?: string } | undefined): string {
  const taxId = (party?.taxId ?? '').replace(/\D/g, '');
  if (!taxId) return `contact:${contactId}`;
  return `tax:${taxId}|${normalizeBranch5(party?.branchNo)}`;
}

/**
 * หาเอกสารซื้อเดิมที่เป็นใบกำกับใบเดียวกัน (ผู้ขายเดียวกันตามเลขผู้เสียภาษี+สาขา หรือผู้ติดต่อเดียวกัน + เลขที่เดียวกันหลัง normalize)
 * ใช้ทั้งใน action (ปฏิเสธ) และหน้าจอ (เตือนตั้งแต่ตอนกรอก)
 */
export function findDuplicatePurchase(
  purchases: PurchaseDoc[],
  contacts: Contact[],
  input: { contactId: string; supplierInvoiceNo: string; party?: { taxId?: string; branchNo?: string } }
): PurchaseDoc | undefined {
  const invoiceNo = normalizeInvoiceNo(input.supplierInvoiceNo);
  if (!invoiceNo) return undefined;
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const key = supplierKey(input.contactId, input.party ?? byId.get(input.contactId));
  return purchases.find((p) => {
    if (normalizeInvoiceNo(p.supplierInvoiceNo) !== invoiceNo) return false;
    if (p.contactId === input.contactId) return true;
    return supplierKey(p.contactId, resolveParty(p.supplier, byId.get(p.contactId))) === key;
  });
}

/**
 * หาใบลดหนี้จากผู้ขายที่บันทึกแล้วด้วยเลขที่เดียวกัน (หลัง normalize) ของผู้ขายเดียวกัน —
 * ผู้ติดต่อเดียวกัน หรือผู้ติดต่ออื่นที่เลขผู้เสียภาษี + สาขาเดียวกัน (U12: กันลดภาษีซื้อซ้ำผ่านผู้ติดต่ออีกรายการ)
 */
export function findDuplicateSupplierCredit(
  credits: PurchaseCreditNote[],
  contacts: Contact[],
  input: { contactId: string; supplierCreditNoteNo: string; party?: { taxId?: string; branchNo?: string } }
): PurchaseCreditNote | undefined {
  const no = normalizeInvoiceNo(input.supplierCreditNoteNo);
  if (!no) return undefined;
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const key = supplierKey(input.contactId, input.party ?? byId.get(input.contactId));
  return credits.find((c) => {
    if (normalizeInvoiceNo(c.supplierCreditNoteNo) !== no) return false;
    if (c.contactId === input.contactId) return true;
    return supplierKey(c.contactId, resolveParty(c.supplier, byId.get(c.contactId))) === key;
  });
}

/** ผู้ติดต่ออื่นที่มีเลขผู้เสียภาษี + สาขาเดียวกัน (เตือนตอนเพิ่ม/แก้ผู้ติดต่อ — ไม่บล็อก) */
export function contactsWithSameTaxId(
  contacts: Contact[],
  candidate: Pick<Contact, 'taxId' | 'branchNo'> & { id?: string }
): Contact[] {
  const key = supplierKey('', candidate);
  if (!key.startsWith('tax:')) return [];
  return contacts.filter((c) => c.id !== candidate.id && supplierKey(c.id, c) === key);
}
