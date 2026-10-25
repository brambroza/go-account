import { pp30ForPeriod } from './vat-close';
import { isTaxDocument } from './sales-doc';
import { calcDocument } from './document-calc';
import { purchaseOutstanding } from './purchase';
import { periodOf, shiftPeriod } from './thai-date';
import { whtTotals, whtPayeesForPeriod } from './wht';
import { ACC, isCashAccount } from './chart-of-accounts';
import { arAging, balanceOf, trialBalance } from './ledger';
import { round2, sumBaht, subBaht, toSatang } from './money';

import type { ArAgingRow } from './ledger';
import type { PP30Full } from './vat-close';
import type { ISODate, SalesDoc, ETaxStatus, PurchaseDoc, AccountingData } from './types';

// ----------------------------------------------------------------------
// ยอดลูกหนี้ / ยอดลดหนี้ / เงินรอคืนลูกค้า และตัวเลขสรุปหน้าแรก
// หน้าจอเรียกฟังก์ชันเหล่านี้แทนการคำนวณเอง
// ----------------------------------------------------------------------

type SalesState = Pick<AccountingData, 'sales'>;

function creditNotesOf(state: SalesState, invoiceId: string): SalesDoc[] {
  return state.sales.filter((s) => s.kind === 'credit-note' && s.refDocId === invoiceId);
}

function debitNotesOf(state: SalesState, invoiceId: string): SalesDoc[] {
  return state.sales.filter((s) => s.kind === 'debit-note' && s.refDocId === invoiceId);
}

/** ยอดใบลดหนี้ทั้งหมด (รวม VAT) ที่อ้างถึงใบกำกับนี้ */
export function creditedTotalOf(state: SalesState, invoice: SalesDoc): number {
  return sumBaht(creditNotesOf(state, invoice.id).map((s) => calcDocument(s).total));
}

/** ยอดใบเพิ่มหนี้ทั้งหมด (รวม VAT) ที่อ้างถึงใบกำกับนี้ */
export function debitedTotalOf(state: SalesState, invoice: SalesDoc): number {
  return sumBaht(debitNotesOf(state, invoice.id).map((s) => calcDocument(s).total));
}

/** ยอดที่ยังลดหนี้ได้ = ยอดใบกำกับ + ใบเพิ่มหนี้ − ใบลดหนี้ก่อนหน้า (ลดได้แม้รับเงินแล้ว — ส่วนเกินตั้งเป็นเงินรอคืนลูกค้า) */
export function creditableOf(state: SalesState, invoice: SalesDoc): number {
  if (invoice.kind !== 'tax-invoice') return 0;
  return subBaht(sumBaht([calcDocument(invoice).total, debitedTotalOf(state, invoice)]), creditedTotalOf(state, invoice));
}

/**
 * ยอดค้างชำระของใบกำกับ = ยอดรวม + ใบเพิ่มหนี้ − รับชำระแล้ว − ส่วนของใบลดหนี้ที่ไปลดลูกหนี้
 * (ส่วนที่ตั้งเป็นเงินรอคืนลูกค้าไม่ลดลูกหนี้ซ้ำ จึงไม่ติดลบ)
 */
export function outstandingOf(state: SalesState, doc: SalesDoc): number {
  if (doc.kind !== 'tax-invoice' || doc.status === 'cancelled') return 0;
  const appliedToAr = sumBaht(
    creditNotesOf(state, doc.id).map((s) => subBaht(calcDocument(s).total, s.creditToCustomer ?? 0))
  );
  return round2(calcDocument(doc).total + debitedTotalOf(state, doc) - doc.paidAmount - appliedToAr);
}

/** ยอดมูลค่าก่อน VAT และ VAT ของใบลดหนี้ทั้งหมดที่อ้างถึงใบกำกับนี้ */
export function creditedPartsOf(state: SalesState, invoice: SalesDoc): { net: number; vat: number } {
  const totals = creditNotesOf(state, invoice.id).map((s) => calcDocument(s));
  return { net: sumBaht(totals.map((t) => t.net)), vat: sumBaht(totals.map((t) => t.vat)) };
}

/**
 * มูลค่าก่อน VAT และ VAT ของใบกำกับหลังปรับด้วยใบเพิ่มหนี้ (ยังไม่หักใบลดหนี้) — เพดานที่ใบลดหนี้รวมลดได้ (ม.86/10)
 */
export function invoiceCeilingOf(state: SalesState, invoice: SalesDoc): { net: number; vat: number } {
  const base = calcDocument(invoice);
  const debits = debitNotesOf(state, invoice.id).map((s) => calcDocument(s));
  return {
    net: sumBaht([base.net, ...debits.map((t) => t.net)]),
    vat: sumBaht([base.vat, ...debits.map((t) => t.vat)]),
  };
}

/**
 * มูลค่าตามใบกำกับ ณ ตอนนี้ (ก่อน VAT) = ใบกำกับ + ใบเพิ่มหนี้ − ใบลดหนี้ ที่ออกไปแล้ว
 * ใช้เป็น "มูลค่าตามใบกำกับเดิม" ของใบลดหนี้/ใบเพิ่มหนี้ใบถัดไป (ม.86/9, 86/10)
 */
export function currentNetOf(state: SalesState, invoice: SalesDoc): number {
  return subBaht(invoiceCeilingOf(state, invoice).net, creditedPartsOf(state, invoice).net);
}

/** วันที่รับชำระครั้งล่าสุดของใบกำกับ (ไม่มีคืน undefined) */
export function lastReceiptDateOf(state: Pick<AccountingData, 'receipts'>, invoiceId: string): ISODate | undefined {
  return state.receipts
    .filter((r) => r.invoiceId === invoiceId)
    .reduce<ISODate | undefined>((latest, r) => (!latest || r.date > latest ? r.date : latest), undefined);
}

/**
 * เงินรอคืนลูกค้า = ส่วนเกินจากใบลดหนี้ − ที่คืนไปแล้ว
 * ส่ง `asOf` เพื่อนับเฉพาะใบลดหนี้ที่ลงวันที่ไม่เกินวันนั้น (คืนเงินได้เฉพาะยอดที่เกิดขึ้นแล้ว ณ วันคืนเงิน)
 * — การคืนเงินนับทั้งหมดเพราะเลข RF เรียงตามวันที่ ใบใหม่จึงลงวันที่ไม่ก่อนใบที่มีอยู่
 */
export function customerCreditOf(
  state: Pick<AccountingData, 'sales' | 'refunds'>,
  contactId: string,
  asOf?: ISODate
): number {
  const credited = sumBaht(
    state.sales
      .filter((s) => s.kind === 'credit-note' && s.contactId === contactId && (!asOf || s.date <= asOf))
      .map((s) => s.creditToCustomer ?? 0)
  );
  const refunded = sumBaht(state.refunds.filter((r) => r.contactId === contactId).map((r) => r.amount));
  return subBaht(credited, refunded);
}

/**
 * D2 — ลูกค้าหักภาษี ณ ที่จ่ายไว้แล้ว แล้วมีใบลดหนี้: ระบบลดยอดเต็มจำนวนตามเดิม (ส่วนที่รับเงินแล้วเข้าเงินรอคืนลูกค้า 2120)
 * ภาษีถูกหัก ณ ที่จ่าย (1160) ไม่เปลี่ยน เพราะเป็นเครดิตภาษีของบริษัทตามหนังสือรับรอง 50 ทวิ ที่ลูกค้าออกให้แล้ว
 * คืนข้อความอธิบายให้หน้าจอแสดงตอนออกใบลดหนี้ (หรือ null ถ้าใบนี้ไม่มีการหัก ณ ที่จ่าย)
 */
export function creditNoteWhtNote(state: Pick<AccountingData, 'receipts'>, invoice: Pick<SalesDoc, 'id' | 'docNo'>): string | null {
  const withheld = sumBaht(state.receipts.filter((r) => r.invoiceId === invoice.id).map((r) => r.whtAmount));
  if (!(toSatang(withheld) > 0)) return null;
  return `ลูกค้าหักภาษี ณ ที่จ่ายจาก ${invoice.docNo} ไว้แล้ว ${withheld.toFixed(2)} บาท — ใบลดหนี้ลดยอดเต็มจำนวน ส่วนที่รับเงินแล้วตั้งเป็นเงินรอคืนลูกค้า (2120) ส่วนภาษีถูกหัก ณ ที่จ่าย (1160) คงเป็นเครดิตภาษีของบริษัทตามหนังสือรับรอง 50 ทวิ ที่ลูกค้าออกให้ (ยื่นใช้เครดิตใน ภ.ง.ด.50/51) — ถ้าลูกค้าขอให้คืนภาษีส่วนนี้ ให้ตกลงกับลูกค้าแล้วคืนผ่านเงินรอคืน`;
}

// ----------------------------------------------------------------------

/** เอกสารที่ต้องออก e-Tax — ใบกำกับ/ใบลด/เพิ่มหนี้ และใบเสร็จรับเงิน/ใบกำกับภาษีของงานบริการ */
export type ETaxDocRow = {
  id: string;
  /** sales = เอกสารขาย (`state.sales`), receipt = ใบเสร็จรับเงิน/ใบกำกับภาษี (`state.receipts`) */
  source: 'sales' | 'receipt';
  docNo: string;
  date: ISODate;
  contactId: string;
  total: number;
  etax: ETaxStatus;
  etaxUploadedAt?: string;
  etaxReference?: string;
};

/** ทุกเอกสารที่ต้องออก e-Tax เรียงตามวันที่/เลขที่ */
export function eTaxDocs(state: Pick<AccountingData, 'sales' | 'receipts'>): ETaxDocRow[] {
  const sales: ETaxDocRow[] = state.sales
    .filter((s) => s.etax !== 'not-required' && isTaxDocument(s))
    .map((s) => ({
      id: s.id,
      source: 'sales',
      docNo: s.docNo,
      date: s.date,
      contactId: s.contactId,
      total: calcDocument(s).total,
      etax: s.etax,
      etaxUploadedAt: s.etaxUploadedAt,
      etaxReference: s.etaxReference,
    }));
  const receipts: ETaxDocRow[] = state.receipts
    .filter((r) => r.isTaxInvoice && r.etax && r.etax !== 'not-required')
    .map((r) => ({
      id: r.id,
      source: 'receipt',
      docNo: r.docNo,
      date: r.date,
      contactId: r.contactId,
      total: r.amount,
      etax: r.etax ?? 'pending-sign',
      etaxUploadedAt: r.etaxUploadedAt,
      etaxReference: r.etaxReference,
    }));
  return [...sales, ...receipts].sort((a, b) => (a.date + a.docNo).localeCompare(b.date + b.docNo));
}

/** เอกสาร e-Tax ที่ยังไม่ได้นำส่ง (รอลงนาม / ลงนามแล้ว) */
export function eTaxWaiting(state: Pick<AccountingData, 'sales' | 'receipts'>): ETaxDocRow[] {
  return eTaxDocs(state).filter((d) => d.etax === 'pending-sign' || d.etax === 'signed');
}

export type DashboardStats = {
  /** เงินสดและเงินฝาก ณ วันนี้ = ทุกบัญชีเงินสด/ธนาคาร (111x เงินสด/เงินสดย่อย, 112x ธนาคาร รวมบัญชีที่เพิ่มเอง) */
  cash: number;
  receivable: number;
  overdue: ArAgingRow[];
  payable: number;
  unpaidPurchases: PurchaseDoc[];
  /** ภ.พ.30 งวดปัจจุบัน (รวมยอดชำระเกินยกมา) */
  pp30: PP30Full;
  /** ภาษีหัก ณ ที่จ่ายงวดก่อน (ภ.ง.ด.3 + 53) ที่ต้องนำส่ง */
  whtPrev: number;
  etaxWaiting: ETaxDocRow[];
  /** ลูกค้าที่ยังไม่มีเลขผู้เสียภาษี */
  badContacts: AccountingData['contacts'];
  aging: ArAgingRow[];
  /** เงินรอคืนลูกค้ารวม */
  customerCredits: number;
};

/** ตัวเลขสรุปหน้าแรก ณ วันที่ `today` */
export function dashboardStats(data: AccountingData, today: ISODate): DashboardStats {
  const period = periodOf(today);
  const tb = trialBalance(data.accounts, data.journal, today);
  const aging = arAging(data.sales, (d) => outstandingOf(data, d), today);
  const unpaidPurchases = data.purchases.filter((p) => !p.paid);
  const prev = shiftPeriod(period, -1);
  const whtPrev = sumBaht([
    whtTotals(whtPayeesForPeriod(data, prev, 'PND3')).tax,
    whtTotals(whtPayeesForPeriod(data, prev, 'PND53')).tax,
  ]);
  return {
    // ทุกบัญชีเงิน (เดิมนับเฉพาะ 1110 + 1120 — เงินสดย่อย 1111 และบัญชีธนาคารที่เพิ่ม 1121–1129 หายจากยอด)
    cash: sumBaht(tb.filter((r) => isCashAccount(r.account)).map((r) => r.balance)),
    receivable: sumBaht(aging.map((a) => a.outstanding)),
    overdue: aging.filter((a) => a.daysOverdue > 0),
    payable: sumBaht(unpaidPurchases.map((p) => purchaseOutstanding(data, p))),
    unpaidPurchases,
    pp30: pp30ForPeriod(data, period),
    whtPrev,
    etaxWaiting: eTaxWaiting(data),
    badContacts: data.contacts.filter((c) => c.kind !== 'vendor' && !c.taxId),
    aging,
    customerCredits: balanceOf(tb, ACC.customerCredit),
  };
}

/** ใช้ใน test/invariant: ยอดค้างทุกใบต้องไม่ติดลบ */
export function hasNegativeOutstanding(state: SalesState): boolean {
  return state.sales.some((s) => s.kind === 'tax-invoice' && toSatang(outstandingOf(state, s)) < 0);
}
