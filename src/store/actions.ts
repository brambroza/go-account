import type {
  Company,
  Contact,
  Receipt,
  DocLine,
  SalesDoc,
  DocPrefix,
  ETaxStatus,
  PurchaseDoc,
  JournalLine,
  JournalEntry,
  AccountingData,
} from 'src/domain';

import {
  ACC,
  round2,
  sumBaht,
  toSatang,
  nextDocNo,
  DOC_PREFIX,
  postReceipt,
  calcDocument,
  postPurchase,
  postCreditNote,
  postSalesInvoice,
  buildManualEntry,
  contactDisplayName,
  postPurchasePayment,
} from 'src/domain';

// ----------------------------------------------------------------------
// การเปลี่ยนแปลงข้อมูลทั้งหมดเป็น pure function: (state, input) → state ใหม่
// ทำให้ทดสอบได้และย้ายไปเรียก API ได้ภายหลังโดยไม่ต้องแก้หน้าจอ
// กติกา: เอกสารที่ออกแล้วแก้ไม่ได้ — แก้ด้วยใบลดหนี้ / รายการปรับปรุงเท่านั้น
// ----------------------------------------------------------------------

export class BusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessRuleError';
    Object.setPrototypeOf(this, BusinessRuleError.prototype);
  }
}

export function uid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function takeNumber(state: AccountingData, prefix: DocPrefix, date: string) {
  const n = nextDocNo(state.sequences, prefix, date);
  return { docNo: n.docNo, sequences: { ...state.sequences, [n.key]: n.value } };
}

function contactOf(state: AccountingData, id: string): Contact {
  const c = state.contacts.find((x) => x.id === id);
  if (!c) throw new BusinessRuleError('ไม่พบผู้ติดต่อ — เลือกลูกค้า/ผู้ขายใหม่อีกครั้ง');
  return c;
}

function assertLines(lines: DocLine[]) {
  if (!lines.length) throw new BusinessRuleError('ต้องมีอย่างน้อย 1 รายการ');
  lines.forEach((l, i) => {
    if (!l.description.trim()) throw new BusinessRuleError(`รายการที่ ${i + 1} ยังไม่มีคำอธิบาย`);
    if (!(l.qty > 0)) throw new BusinessRuleError(`รายการที่ ${i + 1}: จำนวนต้องมากกว่า 0`);
  });
}

/** ยอดค้างชำระของใบกำกับ = ยอดรวม − รับชำระแล้ว − ใบลดหนี้ที่อ้างถึง */
export function outstandingOf(state: Pick<AccountingData, 'sales'>, doc: SalesDoc): number {
  if (doc.kind !== 'tax-invoice' || doc.status === 'cancelled') return 0;
  const credited = sumBaht(
    state.sales
      .filter((s) => s.kind === 'credit-note' && s.refDocId === doc.id)
      .map((s) => calcDocument(s).total)
  );
  return round2(calcDocument(doc).total - doc.paidAmount - credited);
}

function withStatus(state: AccountingData, doc: SalesDoc): SalesDoc {
  if (doc.kind !== 'tax-invoice') return doc;
  const outstanding = outstandingOf(state, doc);
  let status: SalesDoc['status'] = 'issued';
  // ลดหนี้เต็มจำนวนโดยยังไม่เคยรับเงิน = ยกเลิกใบกำกับนี้ด้วยใบลดหนี้
  if (toSatang(outstanding) <= 0) status = doc.paidAmount > 0 ? 'paid' : 'cancelled';
  else if (doc.paidAmount > 0) status = 'partial';
  return { ...doc, status };
}

// ----------------------------------------------------------------------

export type SalesInput = {
  date: string;
  dueDate: string;
  contactId: string;
  lines: DocLine[];
  vatMode: SalesDoc['vatMode'];
  note?: string;
};

export function issueTaxInvoice(state: AccountingData, input: SalesInput) {
  assertLines(input.lines);
  const contact = contactOf(state, input.contactId);
  const vatRate = state.company.vatRegistered ? 7 : 0;
  const vatMode = state.company.vatRegistered ? input.vatMode : 'none';

  const n = takeNumber(state, DOC_PREFIX.taxInvoice, input.date);
  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const id = uid();
  const journalId = uid();

  const doc: SalesDoc = {
    id,
    kind: 'tax-invoice',
    docNo: n.docNo,
    date: input.date,
    dueDate: input.dueDate,
    contactId: contact.id,
    lines: input.lines,
    vatMode,
    vatRate,
    note: input.note,
    status: 'issued',
    paidAmount: 0,
    etax: vatMode === 'none' ? 'not-required' : 'pending-sign',
    journalId,
    createdAt: new Date().toISOString(),
  };
  const entry = postSalesInvoice(doc, { id: journalId, docNo: j.docNo }, contactDisplayName(contact));

  return {
    state: { ...state, sales: [...state.sales, doc], journal: [...state.journal, entry], sequences: j.sequences },
    doc,
  };
}

export type CreditNoteInput = {
  invoiceId: string;
  date: string;
  reason: string;
  lines: DocLine[];
};

export function issueCreditNote(state: AccountingData, input: CreditNoteInput) {
  assertLines(input.lines);
  const invoice = state.sales.find((s) => s.id === input.invoiceId && s.kind === 'tax-invoice');
  if (!invoice) throw new BusinessRuleError('ไม่พบใบกำกับภาษีที่อ้างถึง');
  if (!input.reason.trim()) throw new BusinessRuleError('ใบลดหนี้ต้องระบุเหตุผล');
  if (input.date < invoice.date) throw new BusinessRuleError('วันที่ใบลดหนี้ต้องไม่ก่อนวันที่ใบกำกับเดิม');

  const draft = { ...invoice, lines: input.lines };
  const creditTotal = calcDocument(draft).total;
  const outstanding = outstandingOf(state, invoice);
  if (toSatang(creditTotal) > toSatang(outstanding)) {
    throw new BusinessRuleError(
      `ยอดลดหนี้ ${creditTotal.toFixed(2)} เกินยอดค้างชำระ ${outstanding.toFixed(2)} — รับชำระแล้วต้องคืนเงินแยก`
    );
  }

  const contact = contactOf(state, invoice.contactId);
  const n = takeNumber(state, DOC_PREFIX.creditNote, input.date);
  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();

  const doc: SalesDoc = {
    ...invoice,
    id: uid(),
    kind: 'credit-note',
    docNo: n.docNo,
    date: input.date,
    dueDate: input.date,
    lines: input.lines,
    refDocId: invoice.id,
    reason: input.reason,
    status: 'issued',
    paidAmount: 0,
    etax: invoice.vatMode === 'none' ? 'not-required' : 'pending-sign',
    journalId,
    createdAt: new Date().toISOString(),
  };
  const entry = postCreditNote(doc, { id: journalId, docNo: j.docNo }, contactDisplayName(contact));

  const next: AccountingData = {
    ...state,
    sales: [...state.sales, doc],
    journal: [...state.journal, entry],
    sequences: j.sequences,
  };
  next.sales = next.sales.map((s) => (s.id === invoice.id ? withStatus(next, s) : s));
  return { state: next, doc };
}

export type ReceiptInput = {
  invoiceId: string;
  date: string;
  amount: number;
  whtAmount: number;
  depositAccountCode: string;
};

export function receivePayment(state: AccountingData, input: ReceiptInput) {
  const invoice = state.sales.find((s) => s.id === input.invoiceId);
  if (!invoice || invoice.kind !== 'tax-invoice') throw new BusinessRuleError('ไม่พบใบกำกับภาษี');
  const outstanding = outstandingOf(state, invoice);
  if (!(input.amount > 0)) throw new BusinessRuleError('ยอดรับชำระต้องมากกว่า 0');
  if (toSatang(input.amount) > toSatang(outstanding)) {
    throw new BusinessRuleError(`ยอดรับชำระเกินยอดค้าง (ค้างอยู่ ${outstanding.toFixed(2)} บาท)`);
  }
  if (input.whtAmount < 0 || toSatang(input.whtAmount) >= toSatang(input.amount)) {
    throw new BusinessRuleError('ภาษีถูกหัก ณ ที่จ่ายต้องน้อยกว่ายอดรับชำระ');
  }

  const contact = contactOf(state, invoice.contactId);
  const n = takeNumber(state, DOC_PREFIX.receipt, input.date);
  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();

  const receipt: Receipt = {
    id: uid(),
    docNo: n.docNo,
    date: input.date,
    invoiceId: invoice.id,
    contactId: invoice.contactId,
    amount: round2(input.amount),
    whtAmount: round2(input.whtAmount),
    depositAccountCode: input.depositAccountCode,
    journalId,
  };
  const entry = postReceipt(receipt, { id: journalId, docNo: j.docNo }, contactDisplayName(contact), invoice.docNo);

  const next: AccountingData = {
    ...state,
    receipts: [...state.receipts, receipt],
    journal: [...state.journal, entry],
    sequences: j.sequences,
  };
  next.sales = state.sales.map((s) =>
    s.id === invoice.id ? withStatus(next, { ...s, paidAmount: round2(s.paidAmount + receipt.amount) }) : s
  );
  return { state: next, receipt };
}

// ----------------------------------------------------------------------

export type PurchaseInput = Pick<
  PurchaseDoc,
  | 'supplierInvoiceNo'
  | 'date'
  | 'contactId'
  | 'lines'
  | 'vatMode'
  | 'claimVat'
  | 'whtRate'
  | 'whtIncomeType'
  | 'whtCondition'
  | 'note'
> & {
  /** จ่ายทันทีพร้อมบันทึก (เช่น ค่าใช้จ่ายเงินสด) */
  payNow?: { date: string; accountCode: string };
};

export function recordPurchase(state: AccountingData, input: PurchaseInput) {
  assertLines(input.lines);
  const contact = contactOf(state, input.contactId);
  if (input.whtRate > 0 && !input.whtIncomeType.trim()) {
    throw new BusinessRuleError('หัก ณ ที่จ่ายต้องระบุประเภทเงินได้');
  }
  if (input.claimVat && input.vatMode !== 'none' && !input.supplierInvoiceNo.trim()) {
    throw new BusinessRuleError('ขอคืนภาษีซื้อต้องมีเลขที่ใบกำกับภาษีของผู้ขาย');
  }

  const n = takeNumber(state, DOC_PREFIX.purchase, input.date);
  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();

  const doc: PurchaseDoc = {
    id: uid(),
    docNo: n.docNo,
    supplierInvoiceNo: input.supplierInvoiceNo,
    date: input.date,
    contactId: contact.id,
    lines: input.lines,
    vatMode: input.vatMode,
    vatRate: input.vatMode === 'none' ? 0 : 7,
    claimVat: input.vatMode === 'none' ? false : input.claimVat,
    whtRate: input.whtRate,
    whtIncomeType: input.whtIncomeType,
    whtCondition: input.whtCondition,
    paid: false,
    note: input.note,
    journalId,
    createdAt: new Date().toISOString(),
  };
  const entry = postPurchase(doc, { id: journalId, docNo: j.docNo }, contactDisplayName(contact));

  const next: AccountingData = {
    ...state,
    purchases: [...state.purchases, doc],
    journal: [...state.journal, entry],
    sequences: j.sequences,
  };

  if (input.payNow) {
    return payPurchase(next, { purchaseId: doc.id, ...input.payNow });
  }
  return { state: next, doc };
}

export type PayPurchaseInput = { purchaseId: string; date: string; accountCode: string };

export function payPurchase(state: AccountingData, input: PayPurchaseInput) {
  const doc = state.purchases.find((p) => p.id === input.purchaseId);
  if (!doc) throw new BusinessRuleError('ไม่พบเอกสารซื้อ');
  if (doc.paid) throw new BusinessRuleError(`${doc.docNo} จ่ายชำระแล้ว`);
  if (input.date < doc.date) throw new BusinessRuleError('วันที่จ่ายต้องไม่ก่อนวันที่เอกสาร');

  const contact = contactOf(state, doc.contactId);
  const pv = takeNumber(state, DOC_PREFIX.payment, input.date);
  const j = takeNumber({ ...state, sequences: pv.sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();
  const entry = postPurchasePayment(
    doc,
    { id: journalId, docNo: j.docNo },
    contactDisplayName(contact),
    input.accountCode,
    input.date
  );

  const updated: PurchaseDoc = {
    ...doc,
    paid: true,
    paidDate: input.date,
    paymentAccountCode: input.accountCode,
    paymentJournalId: journalId,
    whtCertNo: doc.whtRate > 0 ? pv.docNo.replace(DOC_PREFIX.payment, 'WT') : undefined,
  };

  return {
    state: {
      ...state,
      purchases: state.purchases.map((p) => (p.id === doc.id ? updated : p)),
      journal: [...state.journal, entry],
      sequences: j.sequences,
    },
    doc: updated,
  };
}

// ----------------------------------------------------------------------

export function addManualJournal(
  state: AccountingData,
  input: { date: string; description: string; lines: JournalLine[] }
) {
  const j = takeNumber(state, DOC_PREFIX.journal, input.date);
  const entry: JournalEntry = buildManualEntry({ id: uid(), docNo: j.docNo }, input.date, input.description, input.lines);
  return { state: { ...state, journal: [...state.journal, entry], sequences: j.sequences }, entry };
}

export function upsertContact(state: AccountingData, contact: Omit<Contact, 'id'> & { id?: string }) {
  if (!contact.name.trim()) throw new BusinessRuleError('ต้องระบุชื่อ');
  const duplicate = state.contacts.find((c) => c.code === contact.code && c.id !== contact.id);
  if (duplicate) throw new BusinessRuleError(`รหัส ${contact.code} ซ้ำกับ ${duplicate.name}`);
  if (contact.id) {
    return { ...state, contacts: state.contacts.map((c) => (c.id === contact.id ? (contact as Contact) : c)) };
  }
  return { ...state, contacts: [...state.contacts, { ...contact, id: uid() }] };
}

export function importContacts(state: AccountingData, contacts: Omit<Contact, 'id'>[]) {
  const existing = new Set(state.contacts.map((c) => c.code));
  const fresh = contacts.filter((c) => !existing.has(c.code)).map((c) => ({ ...c, id: uid() }));
  return { state: { ...state, contacts: [...state.contacts, ...fresh] }, added: fresh.length, skipped: contacts.length - fresh.length };
}

export function updateCompany(state: AccountingData, company: Company): AccountingData {
  return { ...state, company };
}

export function setETaxStatus(state: AccountingData, ids: string[], etax: ETaxStatus): AccountingData {
  const set = new Set(ids);
  return { ...state, sales: state.sales.map((s) => (set.has(s.id) && s.etax !== 'not-required' ? { ...s, etax } : s)) };
}

export const DEPOSIT_ACCOUNTS = [ACC.bank, ACC.cash];
