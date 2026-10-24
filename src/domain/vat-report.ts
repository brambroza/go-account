import { round2, sumBaht } from './money';
import { purchaseVatMonth } from './purchase';
import { calcDocument } from './document-calc';
import { normalizeBranch5 } from './thai-tax-id';
import { inPeriod, periodKey } from './thai-date';
import { salesSign, isTaxDocument } from './sales-doc';
import { resolveParty, partyDisplayName } from './snapshot';

import type { Period } from './thai-date';
import type { Contact, Receipt, SalesDoc, PurchaseDoc, PurchaseCreditNote } from './types';

// ----------------------------------------------------------------------

export type VatReportRow = {
  id: string;
  /** ขาย = วันที่เอกสาร, ซื้อ = วันที่ในใบกำกับของผู้ขาย */
  date: string;
  /** ขาย = เลขที่เอกสาร, ซื้อ = เลขที่ใบกำกับของผู้ขาย */
  docNo: string;
  /** ซื้อ: เลขที่เอกสารภายใน (PI) และวันที่บันทึก */
  refDocNo?: string;
  recordedDate?: string;
  contactName: string;
  taxId: string;
  branchNo: string;
  net: number;
  vat: number;
  /** receipt = ใบเสร็จรับเงิน/ใบกำกับภาษีของงานบริการ, purchase-credit-note = ใบลดหนี้จากผู้ขาย (ลดภาษีซื้อ) */
  kind: 'tax-invoice' | 'credit-note' | 'debit-note' | 'receipt' | 'purchase' | 'purchase-credit-note';
};

export function contactDisplayName(contact: Contact | undefined): string {
  if (!contact) return '-';
  return [contact.title, contact.name, contact.lastName].filter(Boolean).join(' ').trim();
}

/**
 * รายงานภาษีขาย: ใบกำกับ (+), ใบเพิ่มหนี้ (+) และใบลดหนี้ (−) ที่ออกในงวด (ม.86/9, 86/10 — เข้าเดือนที่ออกเอกสาร)
 * และใบเสร็จรับเงิน/ใบกำกับภาษีของงานบริการตามวันที่รับเงิน (ม.78/1) — ใบแจ้งหนี้งานบริการไม่เข้ารายงาน
 * ชื่อ/เลขผู้เสียภาษี/สาขา อ่านจาก snapshot ในเอกสาร — `contacts` ใช้เฉพาะเอกสารที่ไม่มี snapshot
 */
export function salesVatReport(
  sales: SalesDoc[],
  contacts: Contact[],
  period: Period,
  receipts: Receipt[] = []
): VatReportRow[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const docs = sales
    .filter((d) => d.vatMode !== 'none' && isTaxDocument(d) && inPeriod(d.date, period))
    .map((d): VatReportRow => {
      const t = calcDocument(d);
      const sign = salesSign(d);
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
  const taxReceipts = receipts
    .filter((r) => r.isTaxInvoice && inPeriod(r.date, period))
    .map((r): VatReportRow => {
      const party = resolveParty(r.buyer, byId.get(r.contactId));
      const vat = round2(r.vat ?? 0);
      return {
        id: r.id,
        date: r.date,
        docNo: r.docNo,
        contactName: partyDisplayName(party),
        taxId: party?.taxId ?? '',
        branchNo: normalizeBranch5(party?.branchNo),
        net: round2(r.amount - vat),
        vat,
        kind: 'receipt',
      };
    });
  return [...docs, ...taxReceipts].sort((a, b) => (a.date + a.docNo).localeCompare(b.date + b.docNo));
}

/**
 * รายงานภาษีซื้อ: เอกสารที่ขอคืนภาษีซื้อและเลือกใช้สิทธิในเดือนนี้ (`vatClaimPeriod` — ม.82/3)
 * และใบลดหนี้จากผู้ขาย (−) ในเดือนที่ได้รับ (ม.82/12)
 * แสดงวันที่และเลขที่ตามใบกำกับ/ใบลดหนี้ของผู้ขาย พร้อมเลขที่ภายใน (PI/PC)
 */
export function purchaseVatReport(
  purchases: PurchaseDoc[],
  contacts: Contact[],
  period: Period,
  credits: PurchaseCreditNote[] = []
): VatReportRow[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const month = periodKey(period);
  const creditRows = credits
    .filter((c) => c.claimVat && c.vatMode !== 'none' && c.vatClaimPeriod === month)
    .map((c): VatReportRow => {
      const t = calcDocument(c);
      const party = resolveParty(c.supplier, byId.get(c.contactId));
      return {
        id: c.id,
        date: c.supplierCreditNoteDate,
        docNo: c.supplierCreditNoteNo || c.docNo,
        refDocNo: c.docNo,
        recordedDate: c.date,
        contactName: partyDisplayName(party),
        taxId: party?.taxId ?? '',
        branchNo: normalizeBranch5(party?.branchNo),
        net: round2(-t.net),
        vat: round2(-t.vat),
        kind: 'purchase-credit-note',
      };
    });
  const rows = purchases
    .filter((d) => d.claimVat && d.vatMode !== 'none' && purchaseVatMonth(d) === month)
    .map((d) => ({ d, invoiceDate: d.supplierInvoiceDate ?? d.date }))
    .sort((a, b) => (a.invoiceDate + a.d.docNo).localeCompare(b.invoiceDate + b.d.docNo))
    .map(({ d, invoiceDate }) => {
      const t = calcDocument(d);
      const party = resolveParty(d.supplier, byId.get(d.contactId));
      return {
        id: d.id,
        date: invoiceDate,
        docNo: d.supplierInvoiceNo || d.docNo,
        refDocNo: d.docNo,
        recordedDate: d.date,
        contactName: partyDisplayName(party),
        taxId: party?.taxId ?? '',
        branchNo: normalizeBranch5(party?.branchNo),
        net: t.net,
        vat: t.vat,
        kind: 'purchase' as const,
      };
    });
  return [...rows, ...creditRows].sort((a, b) => (a.date + (a.refDocNo ?? '')).localeCompare(b.date + (b.refDocNo ?? '')));
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
  // Excel ตัดช่องว่าง/ขึ้นบรรทัดนำหน้าแล้วยังตีความเป็นสูตรได้ และ ＝ (full-width) เทียบเท่า = หลัง NFKC
  const head = value.normalize('NFKC').replace(/^[\s\u00A0\u200B-\u200D\uFEFF]+/, '');
  const safe = /^[=+\-@\t\r]/.test(value) || /^[=+\-@]/.test(head) ? `'${value}` : value;
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
