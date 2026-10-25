import { toSatang } from './money';
import { receiptWhtAmount } from './wht';
import { calcDocument } from './document-calc';
import { contactDisplayName } from './vat-report';

import type { Contact, ContactKind, AccountingData } from './types';

// ----------------------------------------------------------------------
// ตัวช่วยคีย์เร็วแบบ Express (B10/B11) — ฟังก์ชัน pure ที่หน้าจอใช้ ทดสอบได้โดยไม่ต้อง render
// ----------------------------------------------------------------------

/**
 * รหัสผู้ติดต่อถัดไป = ค่าตัวเลขสูงสุดของรหัสที่ขึ้นต้นด้วย prefix + 1 (ไม่ใช่จำนวนผู้ติดต่อ + 1
 * ซึ่งซ้ำได้เมื่อมีการลบ/นำเข้ารหัสข้าม) — ความยาวตัวเลขอย่างน้อย 4 หลักหรือเท่ารหัสเดิมที่ยาวที่สุด
 */
export function nextContactCode(contacts: Pick<Contact, 'code'>[], prefix = 'C'): string {
  const pattern = new RegExp(`^${prefix.replace(/[^A-Za-z0-9]/g, '')}(\\d+)$`, 'i');
  let max = 0;
  let width = 4;
  contacts.forEach((c) => {
    const m = pattern.exec(c.code.trim());
    if (!m) return;
    max = Math.max(max, Number(m[1]));
    width = Math.max(width, m[1].length);
  });
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

/** prefix รหัสตามประเภท: ผู้ขาย = V, ลูกค้า/ทั้งสอง = C */
export function contactCodePrefix(kind: ContactKind): string {
  return kind === 'vendor' ? 'V' : 'C';
}

const normalize = (s: string) => s.toLowerCase().replace(/[\s-]/g, '');

/** ผู้ติดต่อตรงกับคำค้น — ค้นจากรหัส ชื่อ (รวมคำนำหน้า/นามสกุล) และเลขผู้เสียภาษี (ไม่สนขีด/ช่องว่าง) */
export function contactMatches(contact: Contact, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return [contact.code, contactDisplayName(contact), contact.name, contact.taxId ?? ''].some((v) => normalize(v).includes(q));
}

/** กรองและเรียงผลค้นหา: รหัสตรงตัว/ขึ้นต้น ก่อนชื่อที่มีคำค้น */
export function filterContacts(contacts: Contact[], query: string, limit = 50): Contact[] {
  const q = normalize(query);
  const rank = (c: Contact) => {
    if (!q) return 2;
    const code = normalize(c.code);
    if (code === q) return 0;
    if (code.startsWith(q) || normalize(c.taxId ?? '').startsWith(q)) return 1;
    return 2;
  };
  return contacts
    .filter((c) => contactMatches(c, query))
    .sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code))
    .slice(0, limit);
}

/**
 * อัตราหัก ณ ที่จ่ายที่ลูกค้ารายนี้หักครั้งล่าสุด (จำค่าให้ฟอร์มรับชำระ) — อนุมานจากใบรับชำระล่าสุดที่ยอดภาษีตรงกับ
 * อัตราใดอัตราหนึ่งใน `rates` (ผู้ใช้แก้ยอดเองจนไม่ตรงอัตราใด = ข้ามไปใบก่อนหน้า) ไม่เคยรับชำระ = undefined
 */
export function lastReceiptWhtRate(
  data: Pick<AccountingData, 'receipts' | 'sales'>,
  contactId: string,
  rates: number[]
): number | undefined {
  const invoices = new Map(data.sales.map((s) => [s.id, s]));
  const receipts = data.receipts
    .filter((r) => r.contactId === contactId)
    .slice()
    .sort((a, b) => (b.date + b.docNo).localeCompare(a.date + a.docNo));
  for (let i = 0; i < receipts.length; i += 1) {
    const r = receipts[i];
    const invoice = invoices.get(r.invoiceId);
    if (invoice) {
      const totals = calcDocument(invoice);
      const rate = rates.find((x) => toSatang(receiptWhtAmount(totals, r.amount, x)) === toSatang(r.whtAmount));
      if (rate !== undefined) return rate;
    }
  }
  return undefined;
}

export type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

/** Ctrl+Enter (⌘+Enter บน Mac) = ส่งฟอร์ม → เปิดหน้ายืนยัน */
export function isSubmitShortcut(e: KeyLike): boolean {
  return e.key === 'Enter' && (!!e.ctrlKey || !!e.metaKey) && !e.altKey;
}

/** Enter (ไม่มีปุ่มกดร่วม) ในช่องกรอกของบรรทัดสุดท้าย = เพิ่มบรรทัดใหม่แล้วไปที่ช่องคำอธิบาย */
export function shouldAppendLineOnEnter(e: KeyLike, rowIndex: number, rowCount: number, isTextInput: boolean): boolean {
  return e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && isTextInput && rowIndex === rowCount - 1;
}
