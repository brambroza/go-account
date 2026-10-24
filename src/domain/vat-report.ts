import { inPeriod } from './thai-date';
import { round2, sumBaht } from './money';
import { isTaxDocument } from './sales-doc';
import { calcDocument } from './document-calc';
import { normalizeBranch5 } from './thai-tax-id';
import { resolveParty, partyDisplayName } from './snapshot';

import type { Period } from './thai-date';
import type { Contact, SalesDoc, PurchaseDoc } from './types';

// ----------------------------------------------------------------------

export type VatReportRow = {
  id: string;
  date: string;
  docNo: string;
  contactName: string;
  taxId: string;
  branchNo: string;
  net: number;
  vat: number;
  kind: 'tax-invoice' | 'credit-note' | 'purchase';
};

export function contactDisplayName(contact: Contact | undefined): string {
  if (!contact) return '-';
  return [contact.title, contact.name, contact.lastName].filter(Boolean).join(' ').trim();
}

/**
 * รายงานภาษีขาย: ใบกำกับ (+) และใบลดหนี้ (−) ที่ออกในงวด
 * ชื่อ/เลขผู้เสียภาษี/สาขา อ่านจาก snapshot ในเอกสาร — `contacts` ใช้เฉพาะเอกสารที่ไม่มี snapshot
 */
export function salesVatReport(
  sales: SalesDoc[],
  contacts: Contact[],
  period: Period
): VatReportRow[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  return sales
    .filter((d) => d.vatMode !== 'none' && isTaxDocument(d) && inPeriod(d.date, period))
    .sort((a, b) => (a.date + a.docNo).localeCompare(b.date + b.docNo))
    .map((d) => {
      const t = calcDocument(d);
      const sign = d.kind === 'credit-note' ? -1 : 1;
      const party = resolveParty(d.buyer, byId.get(d.contactId));
      return {
        id: d.id,
        date: d.date,
        docNo: d.docNo,
        contactName: partyDisplayName(party),
        taxId: party?.taxId ?? '',
        branchNo: normalizeBranch5(party?.branchNo),
        net: round2(sign * t.net),
        vat: round2(sign * t.vat),
        kind: d.kind,
      };
    });
}

/** รายงานภาษีซื้อ: เฉพาะเอกสารที่มีใบกำกับเต็มรูปและเลือกขอคืน */
export function purchaseVatReport(
  purchases: PurchaseDoc[],
  contacts: Contact[],
  period: Period
): VatReportRow[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  return purchases
    .filter((d) => d.claimVat && d.vatMode !== 'none' && inPeriod(d.date, period))
    .sort((a, b) => (a.date + a.docNo).localeCompare(b.date + b.docNo))
    .map((d) => {
      const t = calcDocument(d);
      const party = resolveParty(d.supplier, byId.get(d.contactId));
      return {
        id: d.id,
        date: d.date,
        docNo: d.supplierInvoiceNo || d.docNo,
        contactName: partyDisplayName(party),
        taxId: party?.taxId ?? '',
        branchNo: normalizeBranch5(party?.branchNo),
        net: t.net,
        vat: t.vat,
        kind: 'purchase' as const,
      };
    });
}

export type PP30Summary = {
  salesNet: number;
  outputVat: number;
  purchaseNet: number;
  inputVat: number;
  /** > 0 ต้องชำระ, < 0 ชำระไว้เกิน (ขอคืน/ยกไป) */
  netVat: number;
};

export function pp30Summary(salesRows: VatReportRow[], purchaseRows: VatReportRow[]): PP30Summary {
  const outputVat = sumBaht(salesRows.map((r) => r.vat));
  const inputVat = sumBaht(purchaseRows.map((r) => r.vat));
  return {
    salesNet: sumBaht(salesRows.map((r) => r.net)),
    outputVat,
    purchaseNet: sumBaht(purchaseRows.map((r) => r.net)),
    inputVat,
    netVat: round2(outputVat - inputVat),
  };
}

/**
 * ช่อง CSV ที่ปลอดภัย: ครอบด้วย " และกัน formula injection
 * ข้อความที่ขึ้นต้นด้วย = + - @ tab หรือ CR ให้เติม ' นำหน้า เพื่อไม่ให้ Excel/Sheets รันเป็นสูตร
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** ส่งออกรายงานภาษีเป็น CSV (UTF-8 + BOM เพื่อให้ Excel อ่านภาษาไทยได้) */
export function vatReportCsv(rows: VatReportRow[], title: string): string {
  const esc = csvCell;
  const header = ['ลำดับ', 'วันที่', 'เลขที่เอกสาร', 'ชื่อผู้ซื้อ/ผู้ขาย', 'เลขผู้เสียภาษี', 'สาขา', 'มูลค่า', 'ภาษี'];
  const body = rows.map((r, i) =>
    [
      String(i + 1),
      r.date,
      esc(r.docNo),
      esc(r.contactName),
      esc(r.taxId),
      esc(r.branchNo),
      r.net.toFixed(2),
      r.vat.toFixed(2),
    ].join(',')
  );
  return `\uFEFF${esc(title)}\r\n${header.join(',')}\r\n${body.join('\r\n')}\r\n`;
}
