import { ACC } from './chart-of-accounts';
import { calcDocument } from './document-calc';
import { periodOf, shiftPeriod } from './thai-date';
import { whtTotals, whtPayeesForPeriod } from './wht';
import { arAging, balanceOf, trialBalance } from './ledger';
import { round2, sumBaht, subBaht, toSatang } from './money';
import { pp30Summary, salesVatReport, purchaseVatReport } from './vat-report';

import type { ArAgingRow } from './ledger';
import type { PP30Summary } from './vat-report';
import type { ISODate, SalesDoc, PurchaseDoc, AccountingData } from './types';

// ----------------------------------------------------------------------
// ยอดลูกหนี้ / ยอดลดหนี้ / เงินรอคืนลูกค้า และตัวเลขสรุปหน้าแรก
// หน้าจอเรียกฟังก์ชันเหล่านี้แทนการคำนวณเอง
// ----------------------------------------------------------------------

type SalesState = Pick<AccountingData, 'sales'>;

function creditNotesOf(state: SalesState, invoiceId: string): SalesDoc[] {
  return state.sales.filter((s) => s.kind === 'credit-note' && s.refDocId === invoiceId);
}

/** ยอดใบลดหนี้ทั้งหมด (รวม VAT) ที่อ้างถึงใบกำกับนี้ */
export function creditedTotalOf(state: SalesState, invoice: SalesDoc): number {
  return sumBaht(creditNotesOf(state, invoice.id).map((s) => calcDocument(s).total));
}

/** ยอดที่ยังลดหนี้ได้ = ยอดใบกำกับ − ใบลดหนี้ก่อนหน้า (ลดได้แม้รับเงินแล้ว — ส่วนเกินตั้งเป็นเงินรอคืนลูกค้า) */
export function creditableOf(state: SalesState, invoice: SalesDoc): number {
  if (invoice.kind !== 'tax-invoice') return 0;
  return subBaht(calcDocument(invoice).total, creditedTotalOf(state, invoice));
}

/**
 * ยอดค้างชำระของใบกำกับ = ยอดรวม − รับชำระแล้ว − ส่วนของใบลดหนี้ที่ไปลดลูกหนี้
 * (ส่วนที่ตั้งเป็นเงินรอคืนลูกค้าไม่ลดลูกหนี้ซ้ำ จึงไม่ติดลบ)
 */
export function outstandingOf(state: SalesState, doc: SalesDoc): number {
  if (doc.kind !== 'tax-invoice' || doc.status === 'cancelled') return 0;
  const appliedToAr = sumBaht(
    creditNotesOf(state, doc.id).map((s) => subBaht(calcDocument(s).total, s.creditToCustomer ?? 0))
  );
  return round2(calcDocument(doc).total - doc.paidAmount - appliedToAr);
}

/** ยอดมูลค่าก่อน VAT และ VAT ของใบลดหนี้ทั้งหมดที่อ้างถึงใบกำกับนี้ */
export function creditedPartsOf(state: SalesState, invoice: SalesDoc): { net: number; vat: number } {
  const totals = creditNotesOf(state, invoice.id).map((s) => calcDocument(s));
  return { net: sumBaht(totals.map((t) => t.net)), vat: sumBaht(totals.map((t) => t.vat)) };
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

// ----------------------------------------------------------------------

export type DashboardStats = {
  /** เงินสด + ธนาคาร ณ วันนี้ */
  cash: number;
  receivable: number;
  overdue: ArAgingRow[];
  payable: number;
  unpaidPurchases: PurchaseDoc[];
  /** ภ.พ.30 งวดปัจจุบัน */
  pp30: PP30Summary;
  /** ภาษีหัก ณ ที่จ่ายงวดก่อน (ภ.ง.ด.3 + 53) ที่ต้องนำส่ง */
  whtPrev: number;
  etaxWaiting: SalesDoc[];
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
    whtTotals(whtPayeesForPeriod(data.purchases, data.contacts, prev, 'PND3')).tax,
    whtTotals(whtPayeesForPeriod(data.purchases, data.contacts, prev, 'PND53')).tax,
  ]);
  return {
    cash: sumBaht([balanceOf(tb, ACC.bank), balanceOf(tb, ACC.cash)]),
    receivable: sumBaht(aging.map((a) => a.outstanding)),
    overdue: aging.filter((a) => a.daysOverdue > 0),
    payable: sumBaht(unpaidPurchases.map((p) => calcDocument(p).total)),
    unpaidPurchases,
    pp30: pp30Summary(
      salesVatReport(data.sales, data.contacts, period),
      purchaseVatReport(data.purchases, data.contacts, period)
    ),
    whtPrev,
    etaxWaiting: data.sales.filter((s) => s.etax === 'pending-sign' || s.etax === 'signed'),
    badContacts: data.contacts.filter((c) => c.kind !== 'vendor' && !c.taxId),
    aging,
    customerCredits: balanceOf(tb, ACC.customerCredit),
  };
}

/** ใช้ใน test/invariant: ยอดค้างทุกใบต้องไม่ติดลบ */
export function hasNegativeOutstanding(state: SalesState): boolean {
  return state.sales.some((s) => s.kind === 'tax-invoice' && toSatang(outstandingOf(state, s)) < 0);
}
