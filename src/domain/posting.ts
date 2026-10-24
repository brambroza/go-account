import { ACC } from './chart-of-accounts';
import { calcDocument } from './document-calc';
import { round2, sumBaht, subBaht, toSatang } from './money';

import type {
  Payment,
  Receipt,
  SalesDoc,
  VatClose,
  PurchaseDoc,
  JournalLine,
  JournalEntry,
  CustomerRefund,
} from './types';

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

/**
 * ใบเพิ่มหนี้ (ม.86/9): เพิ่มมูลค่าขาย — Dr ลูกหนี้ / Cr รายได้ + Cr ภาษีขาย (เหมือนใบกำกับ)
 * ลูกหนี้ที่เพิ่มรวมเข้ายอดค้างของใบกำกับเดิม (`outstandingOf`)
 */
export function postDebitNote(doc: SalesDoc, meta: EntryMeta, contactName: string): JournalEntry {
  const t = calcDocument(doc);
  const lines = finalize([
    dr(ACC.receivable, t.total, contactName),
    ...Object.entries(t.netByAccount).map(([code, amount]) => cr(code, amount)),
    cr(ACC.outputVat, t.vat),
  ]);
  return {
    ...meta,
    date: doc.date,
    description: `เพิ่มหนี้ ${contactName}${doc.reason ? ` — ${doc.reason}` : ''}`,
    source: 'debit-note',
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
 * จ่ายชำระตามใบสำคัญจ่าย (PV): Dr เจ้าหนี้ (ยอดที่ตัดครั้งนี้) / Cr ธนาคาร (สุทธิ) + Cr ภาษีหัก ณ ที่จ่ายค้างจ่าย
 * แบ่งจ่ายได้ — ยอดหัก ณ ที่จ่ายมาจากใบสำคัญจ่าย (คิดตามสัดส่วนไว้แล้วตอนจ่าย)
 */
export function postPurchasePayment(
  payment: Pick<Payment, 'id' | 'docNo' | 'date' | 'amount' | 'whtAmount' | 'accountCode'>,
  meta: EntryMeta,
  contactName: string,
  purchaseDocNo: string
): JournalEntry {
  const lines = finalize([
    dr(ACC.payable, payment.amount, contactName),
    cr(payment.accountCode, subBaht(payment.amount, payment.whtAmount)),
    cr(ACC.whtPayable, payment.whtAmount),
  ]);
  return {
    ...meta,
    date: payment.date,
    description: `จ่ายชำระ ${contactName} (${purchaseDocNo})`,
    source: 'payment',
    sourceId: payment.id,
    sourceDocNo: payment.docNo,
    lines,
  };
}

/** บรรทัดตามเครื่องหมาย: บวก = ด้าน `side`, ลบ = ด้านตรงข้าม */
function signed(side: 'debit' | 'credit', accountCode: string, amount: number, description?: string): JournalLine {
  const positive = toSatang(amount) >= 0;
  const value = Math.abs(amount);
  return (side === 'debit') === positive ? dr(accountCode, value, description) : cr(accountCode, value, description);
}

/**
 * ปิดภาษีเดือน (ภ.พ.30): Dr ภาษีขาย / Cr ภาษีซื้อ / Cr ภาษีชำระเกินยกมา → Cr ภาษีมูลค่าเพิ่มค้างจ่าย (ต้องชำระ)
 * หรือ Dr ภาษีชำระเกินยกไป (ชำระเกิน) — คืน null ถ้าทุกยอดเป็นศูนย์ (ไม่ต้องลงบัญชี)
 */
export function postVatClose(
  close: Pick<VatClose, 'id' | 'period' | 'date' | 'outputVat' | 'inputVat' | 'broughtForward' | 'payable' | 'carriedForward'>,
  meta: EntryMeta
): JournalEntry | null {
  const lines = finalize([
    signed('debit', ACC.outputVat, close.outputVat, 'ภาษีขาย'),
    signed('credit', ACC.inputVat, close.inputVat, 'ภาษีซื้อ'),
    signed('debit', ACC.vatCredit, subBaht(close.carriedForward, close.broughtForward), 'ภาษีชำระเกินยกมา/ยกไป'),
    cr(ACC.vatPayable, close.payable, 'ภาษีที่ต้องชำระ'),
  ]);
  if (!lines.length) return null;
  return {
    ...meta,
    date: close.date,
    description: `ปิดภาษีมูลค่าเพิ่ม เดือน ${close.period}`,
    source: 'vat-close',
    sourceId: close.id,
    sourceDocNo: `VAT-${close.period}`,
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
