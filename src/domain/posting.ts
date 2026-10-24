import { ACC } from './chart-of-accounts';
import { calcDocument } from './document-calc';
import { round2, sumBaht, subBaht, toSatang } from './money';

import type { Receipt, SalesDoc, PurchaseDoc, JournalLine, JournalEntry, CustomerRefund } from './types';

// ----------------------------------------------------------------------

export class UnbalancedEntryError extends Error {
  constructor(public debit: number, public credit: number) {
    super(`รายการบัญชีไม่สมดุล: เดบิต ${debit.toFixed(2)} ≠ เครดิต ${credit.toFixed(2)}`);
    this.name = 'UnbalancedEntryError';
    // tsconfig target es5: คืน prototype ให้ instanceof ทำงาน
    Object.setPrototypeOf(this, UnbalancedEntryError.prototype);
  }
}

export function entryTotals(lines: JournalLine[]) {
  return {
    debit: sumBaht(lines.map((l) => l.debit)),
    credit: sumBaht(lines.map((l) => l.credit)),
  };
}

export function isBalanced(lines: JournalLine[]): boolean {
  const { debit, credit } = entryTotals(lines);
  return toSatang(debit) === toSatang(credit);
}

function dr(accountCode: string, amount: number, description?: string): JournalLine {
  return { accountCode, debit: round2(amount), credit: 0, description };
}

function cr(accountCode: string, amount: number, description?: string): JournalLine {
  return { accountCode, debit: 0, credit: round2(amount), description };
}

/** ตัดบรรทัดที่เป็นศูนย์ และตรวจสมดุลก่อนคืนค่า */
function finalize(lines: JournalLine[]): JournalLine[] {
  const kept = lines.filter((l) => toSatang(l.debit) !== 0 || toSatang(l.credit) !== 0);
  if (!isBalanced(kept)) {
    const t = entryTotals(kept);
    throw new UnbalancedEntryError(t.debit, t.credit);
  }
  return kept;
}

type EntryMeta = Pick<JournalEntry, 'id' | 'docNo'>;

// ----------------------------------------------------------------------

/** ใบกำกับภาษี: Dr ลูกหนี้ / Cr รายได้ (ตามบัญชีในแต่ละบรรทัด) + Cr ภาษีขาย */
export function postSalesInvoice(doc: SalesDoc, meta: EntryMeta, contactName: string): JournalEntry {
  const t = calcDocument(doc);
  const lines = finalize([
    dr(ACC.receivable, t.total, contactName),
    ...Object.entries(t.netByAccount).map(([code, amount]) => cr(code, amount)),
    cr(ACC.outputVat, t.vat),
  ]);
  return {
    ...meta,
    date: doc.date,
    description: `ขายเชื่อ ${contactName}`,
    source: 'sales',
    sourceId: doc.id,
    sourceDocNo: doc.docNo,
    lines,
  };
}

/**
 * ใบลดหนี้: กลับรายการขาย — Dr รายได้ + Dr ภาษีขาย / Cr ลูกหนี้
 * ส่วนที่ลูกค้าจ่ายมาแล้ว (`creditToCustomer`) Cr เงินรอคืนลูกค้า แทนลูกหนี้ เพื่อไม่ให้ลูกหนี้ติดลบ
 */
export function postCreditNote(doc: SalesDoc, meta: EntryMeta, contactName: string): JournalEntry {
  const t = calcDocument(doc);
  const toCustomer = doc.creditToCustomer ?? 0;
  const lines = finalize([
    ...Object.entries(t.netByAccount).map(([code, amount]) => dr(code, amount)),
    dr(ACC.outputVat, t.vat),
    cr(ACC.receivable, subBaht(t.total, toCustomer), contactName),
    cr(ACC.customerCredit, toCustomer, contactName),
  ]);
  return {
    ...meta,
    date: doc.date,
    description: `ลดหนี้ ${contactName}${doc.reason ? ` — ${doc.reason}` : ''}`,
    source: 'credit-note',
    sourceId: doc.id,
    sourceDocNo: doc.docNo,
    lines,
  };
}

/** รับชำระ: Dr ธนาคาร (สุทธิ) + Dr ภาษีถูกหัก ณ ที่จ่าย / Cr ลูกหนี้ */
export function postReceipt(
  receipt: Receipt,
  meta: EntryMeta,
  contactName: string,
  invoiceNo: string
): JournalEntry {
  const lines = finalize([
    dr(receipt.depositAccountCode, subBaht(receipt.amount, receipt.whtAmount)),
    dr(ACC.whtReceivable, receipt.whtAmount),
    cr(ACC.receivable, receipt.amount, contactName),
  ]);
  return {
    ...meta,
    date: receipt.date,
    description: `รับชำระจาก ${contactName} (${invoiceNo})`,
    source: 'receipt',
    sourceId: receipt.id,
    sourceDocNo: receipt.docNo,
    lines,
  };
}

/** ซื้อ/ค่าใช้จ่าย: Dr ค่าใช้จ่าย (+ ภาษีซื้อ ถ้าขอคืนได้) / Cr เจ้าหนี้ */
export function postPurchase(doc: PurchaseDoc, meta: EntryMeta, contactName: string): JournalEntry {
  const t = calcDocument(doc);
  const expenseLines = Object.entries(t.netByAccount).map(([code, amount]) => dr(code, amount));
  // ภาษีซื้อที่ขอคืนไม่ได้ให้รวมเป็นค่าใช้จ่ายของบรรทัดแรก
  if (!doc.claimVat && t.vat !== 0 && expenseLines.length) {
    expenseLines[0] = dr(expenseLines[0].accountCode, expenseLines[0].debit + t.vat);
  }
  const lines = finalize([
    ...expenseLines,
    ...(doc.claimVat ? [dr(ACC.inputVat, t.vat)] : []),
    cr(ACC.payable, t.total, contactName),
  ]);
  return {
    ...meta,
    date: doc.date,
    description: `ซื้อ/ค่าใช้จ่าย ${contactName}${doc.supplierInvoiceNo ? ` (${doc.supplierInvoiceNo})` : ''}`,
    source: 'purchase',
    sourceId: doc.id,
    sourceDocNo: doc.docNo,
    lines,
  };
}

/**
 * จ่ายชำระ: Dr เจ้าหนี้ / Cr ธนาคาร (สุทธิ) + Cr ภาษีหัก ณ ที่จ่ายค้างจ่าย
 * `payment` = ใบสำคัญจ่าย (PV) ที่อ้างถึงในสมุดรายวัน — ไม่ส่งมาจะอ้างเลขเอกสารซื้อแทน (ข้อมูลเก่า)
 */
export function postPurchasePayment(
  doc: PurchaseDoc,
  meta: EntryMeta,
  contactName: string,
  paymentAccountCode: string,
  paidDate: string,
  payment?: { id: string; docNo: string }
): JournalEntry {
  const t = calcDocument(doc);
  const lines = finalize([
    dr(ACC.payable, t.total, contactName),
    cr(paymentAccountCode, subBaht(t.total, t.wht)),
    cr(ACC.whtPayable, t.wht),
  ]);
  return {
    ...meta,
    date: paidDate,
    description: `จ่ายชำระ ${contactName} (${doc.docNo})`,
    source: 'payment',
    sourceId: payment?.id ?? doc.id,
    sourceDocNo: payment?.docNo ?? doc.docNo,
    lines,
  };
}

/** คืนเงินลูกค้า: Dr เงินรอคืนลูกค้า / Cr เงินสด/ธนาคาร */
export function postCustomerRefund(refund: CustomerRefund, meta: EntryMeta, contactName: string): JournalEntry {
  const lines = finalize([
    dr(ACC.customerCredit, refund.amount, contactName),
    cr(refund.accountCode, refund.amount),
  ]);
  return {
    ...meta,
    date: refund.date,
    description: `คืนเงินลูกค้า ${contactName}${refund.note ? ` — ${refund.note}` : ''}`,
    source: 'refund',
    sourceId: refund.id,
    sourceDocNo: refund.docNo,
    lines,
  };
}

/** รายการปรับปรุง (คีย์มือ) — ตรวจสมดุลเหมือนกัน */
export function buildManualEntry(
  meta: EntryMeta,
  date: string,
  description: string,
  lines: JournalLine[]
): JournalEntry {
  return { ...meta, date, description, source: 'manual', lines: finalize(lines) };
}
