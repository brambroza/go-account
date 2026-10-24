import { addDays } from './thai-date';
import { calcDocument } from './document-calc';

import type { ISODate, DocLine, SaleType, Quotation, QuotationStatus } from './types';

// ----------------------------------------------------------------------
// ใบเสนอราคา — ไม่ใช่เอกสารภาษี ไม่ลงบัญชี แก้ไขได้จนกว่าจะแปลงเป็นเอกสารขาย
// สถานะ "หมดอายุ" แสดงอัตโนมัติเมื่อพ้นวันยืนราคาและยังไม่ตอบรับ (`quotationStatusOf`)
// ----------------------------------------------------------------------

export const QUOTATION_STATUS_LABEL: Record<QuotationStatus | 'converted', string> = {
  draft: 'ร่าง',
  sent: 'ส่งลูกค้าแล้ว',
  accepted: 'ลูกค้าตอบรับ',
  rejected: 'ไม่อนุมัติ',
  expired: 'หมดอายุ',
  converted: 'ออกเอกสารขายแล้ว',
};

export const QUOTATION_STATUSES: QuotationStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired'];

/** วันสุดท้ายที่ยืนราคา */
export function quotationValidUntil(q: Pick<Quotation, 'date' | 'validDays'>): ISODate {
  return addDays(q.date, q.validDays);
}

/** สถานะที่แสดง: แปลงแล้ว / หมดอายุ (พ้นวันยืนราคาขณะยังเป็นร่างหรือส่งแล้ว) / ตามที่บันทึก */
export function quotationStatusOf(
  q: Pick<Quotation, 'status' | 'date' | 'validDays' | 'convertedSalesId'>,
  today: ISODate
): QuotationStatus | 'converted' {
  if (q.convertedSalesId) return 'converted';
  if ((q.status === 'draft' || q.status === 'sent') && quotationValidUntil(q) < today) return 'expired';
  return q.status;
}

/** แปลงเป็นเอกสารขายได้หรือไม่ — คืนเหตุผลถ้าไม่ได้ */
export function quotationConvertProblem(
  q: Pick<Quotation, 'docNo' | 'status' | 'date' | 'validDays' | 'convertedSalesId'>,
  today: ISODate
): string | null {
  const status = quotationStatusOf(q, today);
  if (status === 'converted') return `${q.docNo} ออกเอกสารขายไปแล้ว`;
  if (status === 'rejected') return `${q.docNo} ลูกค้าไม่อนุมัติ — เปลี่ยนสถานะก่อนออกเอกสารขาย`;
  if (status === 'expired') return `${q.docNo} หมดอายุแล้ว — ต่ออายุ (แก้จำนวนวันยืนราคา) หรือทำใบเสนอราคาใหม่`;
  return null;
}

export function quotationTotals(q: Pick<Quotation, 'lines' | 'vatMode' | 'vatRate'>) {
  return calcDocument(q);
}

/** บรรทัดสำหรับเอกสารขายที่แปลงจากใบเสนอราคา — คัดลอกทุกช่อง ออก id ใหม่ */
export function quotationSalesLines(q: Pick<Quotation, 'lines'>, newId: () => string): DocLine[] {
  return q.lines.map((l) => ({ ...l, id: newId() }));
}

/** ค่าเริ่มต้นของฟอร์มเอกสารขายที่แปลงจากใบเสนอราคา */
export function quotationToSalesDraft(
  q: Pick<Quotation, 'contactId' | 'lines' | 'vatMode' | 'saleType' | 'note'>,
  newId: () => string
): { contactId: string; vatMode: Quotation['vatMode']; saleType: SaleType; note: string; lines: DocLine[] } {
  return {
    contactId: q.contactId,
    vatMode: q.vatMode,
    saleType: q.saleType ?? 'goods',
    note: q.note ?? '',
    lines: quotationSalesLines(q, newId),
  };
}
