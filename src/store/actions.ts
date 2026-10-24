import type {
  Company,
  Contact,
  Payment,
  Receipt,
  DocLine,
  ISODate,
  SalesDoc,
  LineSide,
  DocPrefix,
  ETaxStatus,
  PurchaseDoc,
  JournalLine,
  JournalEntry,
  AccountingData,
  CustomerRefund,
} from 'src/domain';

import {
  ACC,
  round2,
  sumBaht,
  mulBaht,
  subBaht,
  toSatang,
  VAT_RATE,
  todayISO,
  nextDocNo,
  parseDocNo,
  DOC_PREFIX,
  postReceipt,
  calcDocument,
  postPurchase,
  creditableOf,
  partySnapshot,
  outstandingOf,
  isTaxDocument,
  isCashAccount,
  postCreditNote,
  formatThaiDate,
  isValidISODate,
  companySnapshot,
  creditedPartsOf,
  customerCreditOf,
  isControlAccount,
  postSalesInvoice,
  receiptWhtAmount,
  buildManualEntry,
  lastReceiptDateOf,
  lineAccountProblem,
  endOfPreviousMonth,
  contactDisplayName,
  postCustomerRefund,
  postPurchasePayment,
  RECEIPT_WHT_MAX_RATE,
  findDuplicatePurchase,
  PURCHASE_WHT_MAX_RATE,
  DATE_ORDERED_PREFIXES,
} from 'src/domain';

// ----------------------------------------------------------------------
// การเปลี่ยนแปลงข้อมูลทั้งหมดเป็น pure function: (state, input) → state ใหม่
// ทำให้ทดสอบได้และย้ายไปเรียก API ได้ภายหลังโดยไม่ต้องแก้หน้าจอ
// กติกา: เอกสารที่ออกแล้วแก้ไม่ได้ — แก้ด้วยใบลดหนี้ / รายการปรับปรุงเท่านั้น
// ทุก action ที่ลงบัญชีตรวจ: รูปแบบวันที่ (ค.ศ.), งวดที่ปิดแล้ว, วันที่ไม่ถอยหลังจากเอกสาร prefix เดียวกัน
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

// ---------------- ตรวจวันที่ / งวด ----------------

/** วันที่ต้องเป็น ISO ค.ศ. ที่มีอยู่จริง (กัน "2569-10-24" ที่กรอกเป็น พ.ศ. และค่าว่าง) */
export function assertISODate(date: string, label = 'วันที่'): asserts date is ISODate {
  if (!isValidISODate(date)) {
    throw new BusinessRuleError(`${label}ไม่ถูกต้อง — ใช้ปี ค.ศ. รูปแบบ YYYY-MM-DD`);
  }
}

/** ห้ามลงรายการในงวดที่ปิดแล้ว (วันที่ ≤ company.lockedThrough) */
export function assertOpenPeriod(state: Pick<AccountingData, 'company'>, date: ISODate): void {
  const lock = state.company.lockedThrough;
  if (lock && date <= lock) {
    throw new BusinessRuleError(
      `ปิดงวดถึงวันที่ ${formatThaiDate(lock)} แล้ว — ลงรายการวันที่ ${formatThaiDate(date)} ไม่ได้ ให้ลงในงวดปัจจุบันแทน`
    );
  }
}

/** ตรวจวันที่ของรายการที่จะลงบัญชี: รูปแบบถูกต้อง + งวดยังไม่ปิด */
function assertPostingDate(state: AccountingData, date: string, label?: string): asserts date is ISODate {
  assertISODate(date, label);
  assertOpenPeriod(state, date);
}

/** วันที่ของเอกสารใบล่าสุดที่ใช้ prefix นี้ (ทุกงวด) */
export function lastDocDate(state: AccountingData, prefix: DocPrefix): ISODate | undefined {
  const docs: { docNo?: string; date: ISODate }[] = [
    ...state.sales,
    ...state.receipts,
    ...state.purchases,
    ...state.payments,
    ...state.payments.map((p) => ({ docNo: p.whtCertNo, date: p.date })),
    ...state.refunds,
    ...state.journal,
  ];
  return docs.reduce<ISODate | undefined>((latest, d) => {
    if (!d.docNo || parseDocNo(d.docNo)?.prefix !== prefix) return latest;
    return !latest || d.date > latest ? d.date : latest;
  }, undefined);
}

function takeNumber(state: AccountingData, prefix: DocPrefix, date: ISODate) {
  if (DATE_ORDERED_PREFIXES.includes(prefix)) {
    const last = lastDocDate(state, prefix);
    if (last && date < last) {
      throw new BusinessRuleError(
        `วันที่ ${formatThaiDate(date)} ก่อนเอกสาร ${prefix} ใบล่าสุด (${formatThaiDate(last)}) — เลขที่ต้องเรียงตามวันที่`
      );
    }
  }
  const n = nextDocNo(state.sequences, prefix, date);
  return { docNo: n.docNo, sequences: { ...state.sequences, [n.key]: n.value } };
}

function contactOf(state: AccountingData, id: string): Contact {
  const c = state.contacts.find((x) => x.id === id);
  if (!c) throw new BusinessRuleError('ไม่พบผู้ติดต่อ — เลือกลูกค้า/ผู้ขายใหม่อีกครั้ง');
  return c;
}

/** บัญชีรับ/จ่ายเงิน ต้องเป็นบัญชีเงินสด/ธนาคาร (สินทรัพย์หมวด 111x–112x) ที่มีในผังบัญชี */
function assertCashAccount(state: AccountingData, code: string) {
  const account = state.accounts.find((a) => a.code === code);
  if (!isCashAccount(account)) {
    throw new BusinessRuleError(`บัญชี ${code} ใช้รับ/จ่ายเงินไม่ได้ — เลือกบัญชีเงินสดหรือธนาคาร`);
  }
}

/**
 * ตรวจบรรทัดเอกสาร — `side` กำหนดประเภทบัญชีที่ใช้ได้ (ขาย/ลดหนี้ = รายได้, ซื้อ = ค่าใช้จ่าย/สินทรัพย์)
 * ห้ามบัญชีคุม (เช่น 2150 ภาษีขาย) เพราะทำให้ GL ไม่ตรงกับรายงานภาษีและทะเบียนย่อย
 */
function assertLines(state: AccountingData, lines: DocLine[], side: LineSide) {
  if (!lines.length) throw new BusinessRuleError('ต้องมีอย่างน้อย 1 รายการ');
  const accounts = new Map(state.accounts.map((a) => [a.code, a]));
  lines.forEach((l, i) => {
    const no = `รายการที่ ${i + 1}`;
    if (!l.description.trim()) throw new BusinessRuleError(`${no} ยังไม่มีคำอธิบาย`);
    if (!Number.isFinite(l.qty) || !(l.qty > 0)) throw new BusinessRuleError(`${no}: จำนวนต้องมากกว่า 0`);
    if (!Number.isFinite(l.unitPrice) || l.unitPrice < 0) throw new BusinessRuleError(`${no}: ราคาต่อหน่วยติดลบไม่ได้`);
    const discount = l.discount || 0;
    if (!Number.isFinite(discount) || discount < 0) throw new BusinessRuleError(`${no}: ส่วนลดติดลบไม่ได้`);
    if (toSatang(discount) > toSatang(mulBaht(l.qty, l.unitPrice))) {
      throw new BusinessRuleError(`${no}: ส่วนลดเกินมูลค่ารายการ`);
    }
    if (!accounts.has(l.accountCode)) throw new BusinessRuleError(`${no}: ไม่พบบัญชี ${l.accountCode} ในผังบัญชี`);
    const problem = lineAccountProblem(accounts.get(l.accountCode), side);
    if (problem) throw new BusinessRuleError(`${no}: ${problem}`);
  });
}

function assertPositiveTotal(total: number) {
  if (!(toSatang(total) > 0)) throw new BusinessRuleError('ยอดรวมเอกสารต้องมากกว่า 0');
}

/** ยอดค้างชำระของใบกำกับ — ย้ายไปอยู่ที่ domain (`src/domain/receivables.ts`) คง export ไว้ให้หน้าจอเดิม */
export { outstandingOf };

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

/**
 * ออกใบกำกับภาษี (บริษัทจด VAT, prefix IV) หรือใบแจ้งหนี้ (บริษัทไม่จด VAT, prefix BL, ไม่มี VAT)
 * ดู `doc.isTaxInvoice` / `salesDocTitle(doc)` สำหรับชื่อเอกสารที่ต้องพิมพ์
 */
export function issueTaxInvoice(state: AccountingData, input: SalesInput) {
  assertPostingDate(state, input.date, 'วันที่เอกสาร');
  assertISODate(input.dueDate, 'วันครบกำหนด');
  if (input.dueDate < input.date) throw new BusinessRuleError('วันครบกำหนดต้องไม่ก่อนวันที่เอกสาร');
  assertLines(state, input.lines, 'sales');
  const contact = contactOf(state, input.contactId);
  if (contact.kind === 'vendor') {
    throw new BusinessRuleError(`${contactDisplayName(contact)} เป็นผู้ขายเท่านั้น — ตั้งประเภทผู้ติดต่อเป็นลูกค้าหรือทั้งสองก่อนออกเอกสารขาย`);
  }
  const isTaxInvoice = state.company.vatRegistered;
  const vatRate = isTaxInvoice ? VAT_RATE : 0;
  const vatMode = isTaxInvoice ? input.vatMode : 'none';
  assertPositiveTotal(calcDocument({ lines: input.lines, vatMode, vatRate }).total);

  const n = takeNumber(state, isTaxInvoice ? DOC_PREFIX.taxInvoice : DOC_PREFIX.invoice, input.date);
  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const id = uid();
  const journalId = uid();

  const doc: SalesDoc = {
    id,
    kind: 'tax-invoice',
    isTaxInvoice,
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
    etax: isTaxInvoice && vatMode !== 'none' ? 'pending-sign' : 'not-required',
    seller: companySnapshot(state.company),
    buyer: partySnapshot(contact),
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

/**
 * ใบลดหนี้อ้างใบกำกับเดิม — ลดได้ไม่เกิน ยอดใบกำกับ − ใบลดหนี้ก่อนหน้า (แม้รับชำระแล้ว ตาม ม.86/10)
 * ส่วนที่เกินยอดค้างชำระตั้งเป็นเงินรอคืนลูกค้า (`doc.creditToCustomer`) แล้วคืนด้วย `refundCustomerCredit`
 */
export function issueCreditNote(state: AccountingData, input: CreditNoteInput) {
  const invoice = state.sales.find((s) => s.id === input.invoiceId && s.kind === 'tax-invoice');
  if (!invoice) throw new BusinessRuleError('ไม่พบใบกำกับภาษีที่อ้างถึง');
  assertPostingDate(state, input.date, 'วันที่ใบลดหนี้');
  if (!input.reason.trim()) throw new BusinessRuleError('ใบลดหนี้ต้องระบุเหตุผล');
  if (input.date < invoice.date) throw new BusinessRuleError('วันที่ใบลดหนี้ต้องไม่ก่อนวันที่ใบกำกับเดิม');
  // ยอดค้าง (และส่วนที่ตั้งเป็นเงินรอคืน) คิดจากการรับชำระทั้งหมด จึงห้ามลงวันที่ก่อนการรับชำระครั้งล่าสุด
  const lastReceipt = lastReceiptDateOf(state, invoice.id);
  if (lastReceipt && input.date < lastReceipt) {
    throw new BusinessRuleError(
      `วันที่ใบลดหนี้ต้องไม่ก่อนวันรับชำระครั้งล่าสุดของ ${invoice.docNo} (${formatThaiDate(lastReceipt)})`
    );
  }
  assertLines(state, input.lines, 'sales');

  const credit = calcDocument({ ...invoice, lines: input.lines });
  const creditTotal = credit.total;
  assertPositiveTotal(creditTotal);
  const creditable = creditableOf(state, invoice);
  if (toSatang(creditTotal) > toSatang(creditable)) {
    throw new BusinessRuleError(
      `ยอดลดหนี้ ${creditTotal.toFixed(2)} เกินยอดที่ลดได้ ${creditable.toFixed(2)} (ยอดใบกำกับหักใบลดหนี้ก่อนหน้า)`
    );
  }
  // ลดหลายใบบนใบราคารวม VAT: เศษปัดของแต่ละใบสะสมได้ — VAT และมูลค่าที่ลดรวมต้องไม่เกินของใบเดิม (ม.86/10)
  const original = calcDocument(invoice);
  const before = creditedPartsOf(state, invoice);
  if (toSatang(sumBaht([before.vat, credit.vat])) > toSatang(original.vat)) {
    throw new BusinessRuleError(
      `ภาษีที่ลดรวม ${sumBaht([before.vat, credit.vat]).toFixed(2)} เกินภาษีขายของ ${invoice.docNo} (${original.vat.toFixed(2)}) — ปรับยอดใบลดหนี้`
    );
  }
  if (toSatang(sumBaht([before.net, credit.net])) > toSatang(original.net)) {
    throw new BusinessRuleError(
      `มูลค่าที่ลดรวม ${sumBaht([before.net, credit.net]).toFixed(2)} เกินมูลค่าของ ${invoice.docNo} (${original.net.toFixed(2)}) — ปรับยอดใบลดหนี้`
    );
  }
  const outstanding = outstandingOf(state, invoice);
  const creditToCustomer = toSatang(creditTotal) > toSatang(outstanding) ? subBaht(creditTotal, outstanding) : 0;

  const contact = contactOf(state, invoice.contactId);
  const isTaxInvoice = isTaxDocument(invoice);
  const n = takeNumber(state, isTaxInvoice ? DOC_PREFIX.creditNote : DOC_PREFIX.creditMemo, input.date);
  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();

  const doc: SalesDoc = {
    id: uid(),
    kind: 'credit-note',
    isTaxInvoice,
    docNo: n.docNo,
    date: input.date,
    dueDate: input.date,
    contactId: invoice.contactId,
    lines: input.lines,
    vatMode: invoice.vatMode,
    vatRate: invoice.vatRate,
    refDocId: invoice.id,
    reason: input.reason,
    creditToCustomer,
    note: invoice.note,
    status: 'issued',
    paidAmount: 0,
    etax: isTaxInvoice && invoice.vatMode !== 'none' ? 'pending-sign' : 'not-required',
    seller: companySnapshot(state.company),
    buyer: partySnapshot(contact),
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
  assertPostingDate(state, input.date, 'วันที่รับชำระ');
  if (input.date < invoice.date) throw new BusinessRuleError('วันที่รับชำระต้องไม่ก่อนวันที่ใบกำกับ');
  const outstanding = outstandingOf(state, invoice);
  if (!Number.isFinite(input.amount) || !(input.amount > 0)) throw new BusinessRuleError('ยอดรับชำระต้องมากกว่า 0');
  if (toSatang(input.amount) > toSatang(outstanding)) {
    throw new BusinessRuleError(`ยอดรับชำระเกินยอดค้าง (ค้างอยู่ ${outstanding.toFixed(2)} บาท)`);
  }
  if (!Number.isFinite(input.whtAmount) || input.whtAmount < 0 || toSatang(input.whtAmount) >= toSatang(input.amount)) {
    throw new BusinessRuleError('ภาษีถูกหัก ณ ที่จ่ายต้องน้อยกว่ายอดรับชำระ');
  }
  // ฐาน = มูลค่าก่อน VAT ตามสัดส่วนยอดที่รับ × อัตราสูงสุดในตารางเงินได้
  const maxWht = receiptWhtAmount(calcDocument(invoice), input.amount, RECEIPT_WHT_MAX_RATE);
  if (toSatang(input.whtAmount) > toSatang(maxWht)) {
    throw new BusinessRuleError(
      `ภาษีถูกหัก ณ ที่จ่ายเกิน ${RECEIPT_WHT_MAX_RATE}% ของมูลค่าก่อน VAT ที่รับครั้งนี้ (หักได้ไม่เกิน ${maxWht.toFixed(2)} บาท)`
    );
  }
  assertCashAccount(state, input.depositAccountCode);

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
    seller: companySnapshot(state.company),
    buyer: partySnapshot(contact),
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
    s.id === invoice.id ? withStatus(next, { ...s, paidAmount: sumBaht([s.paidAmount, receipt.amount]) }) : s
  );
  return { state: next, receipt };
}

export type RefundInput = {
  contactId: string;
  date: string;
  amount: number;
  /** บัญชีเงินสด/ธนาคารที่จ่ายคืน */
  accountCode: string;
  note?: string;
};

/** คืนเงินลูกค้าจากยอดเงินรอคืน (Dr เงินรอคืนลูกค้า / Cr เงินสด/ธนาคาร) — เลขที่ RF */
export function refundCustomerCredit(state: AccountingData, input: RefundInput) {
  const contact = contactOf(state, input.contactId);
  assertPostingDate(state, input.date, 'วันที่คืนเงิน');
  if (!Number.isFinite(input.amount) || !(input.amount > 0)) throw new BusinessRuleError('ยอดคืนเงินต้องมากกว่า 0');
  // ตรวจลำดับวันที่ของเลข RF ก่อน — ข้อความชัดกว่าเมื่อผู้ใช้ลงวันที่ย้อนหลัง
  const n = takeNumber(state, DOC_PREFIX.refund, input.date);
  // คืนได้เฉพาะเงินรอคืนที่เกิดแล้ว ณ วันคืนเงิน (ใบลดหนี้ลงวันที่ไม่เกินวันคืน) — กัน 2120 ติดลบระหว่างงวด
  const available = customerCreditOf(state, contact.id, input.date);
  if (toSatang(input.amount) > toSatang(available)) {
    const total = customerCreditOf(state, contact.id);
    throw new BusinessRuleError(
      toSatang(total) > toSatang(available)
        ? `ยอดคืนเงินเกินยอดรอคืน ณ วันที่ ${formatThaiDate(input.date)} (คืนได้ ${Math.max(0, available).toFixed(2)} บาท — ใบลดหนี้บางใบลงวันที่หลังวันคืนเงิน)`
        : `ยอดคืนเงินเกินยอดรอคืน (คืนได้ ${available.toFixed(2)} บาท)`
    );
  }
  assertCashAccount(state, input.accountCode);

  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();
  const refund: CustomerRefund = {
    id: uid(),
    docNo: n.docNo,
    date: input.date,
    contactId: contact.id,
    amount: round2(input.amount),
    accountCode: input.accountCode,
    note: input.note,
    buyer: partySnapshot(contact),
    journalId,
  };
  const entry = postCustomerRefund(refund, { id: journalId, docNo: j.docNo }, contactDisplayName(contact));
  return {
    state: { ...state, refunds: [...state.refunds, refund], journal: [...state.journal, entry], sequences: j.sequences },
    refund,
  };
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

/**
 * บันทึกซื้อ/ค่าใช้จ่าย — บริษัทไม่จด VAT ขอคืนภาษีซื้อไม่ได้ (claimVat = false เสมอ, VAT เป็นค่าใช้จ่าย)
 * กันเลขใบกำกับผู้ขายซ้ำ (ผู้ขายเดียวกัน + เลขเดียวกัน) เพื่อไม่ให้ขอคืนภาษีซื้อซ้ำ
 */
export function recordPurchase(
  state: AccountingData,
  input: PurchaseInput
): { state: AccountingData; doc: PurchaseDoc; payment?: Payment } {
  assertPostingDate(state, input.date, 'วันที่เอกสาร');
  assertLines(state, input.lines, 'purchase');
  const contact = contactOf(state, input.contactId);
  if (!Number.isFinite(input.whtRate) || input.whtRate < 0 || input.whtRate > PURCHASE_WHT_MAX_RATE) {
    throw new BusinessRuleError(`อัตราหัก ณ ที่จ่ายต้องอยู่ระหว่าง 0–${PURCHASE_WHT_MAX_RATE}%`);
  }
  if (input.whtRate > 0 && !input.whtIncomeType.trim()) {
    throw new BusinessRuleError('หัก ณ ที่จ่ายต้องระบุประเภทเงินได้');
  }
  const claimVat = state.company.vatRegistered && input.vatMode !== 'none' && input.claimVat;
  if (claimVat && !input.supplierInvoiceNo.trim()) {
    throw new BusinessRuleError('ขอคืนภาษีซื้อต้องมีเลขที่ใบกำกับภาษีของผู้ขาย');
  }
  const dup = findDuplicatePurchase(state.purchases, state.contacts, {
    contactId: contact.id,
    supplierInvoiceNo: input.supplierInvoiceNo,
    party: partySnapshot(contact),
  });
  if (dup) {
    throw new BusinessRuleError(
      `ใบกำกับผู้ขายเลขที่ ${input.supplierInvoiceNo.trim()} บันทึกไปแล้วใน ${dup.docNo} (เลขที่ ${dup.supplierInvoiceNo}${dup.contactId === contact.id ? '' : ' ผู้ขายเลขผู้เสียภาษีเดียวกัน'})`
    );
  }
  const vatRate = input.vatMode === 'none' ? 0 : VAT_RATE;
  assertPositiveTotal(calcDocument({ lines: input.lines, vatMode: input.vatMode, vatRate }).total);

  const n = takeNumber(state, DOC_PREFIX.purchase, input.date);
  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();

  const doc: PurchaseDoc = {
    id: uid(),
    docNo: n.docNo,
    supplierInvoiceNo: input.supplierInvoiceNo.trim(),
    date: input.date,
    contactId: contact.id,
    lines: input.lines,
    vatMode: input.vatMode,
    vatRate,
    claimVat,
    whtRate: input.whtRate,
    whtIncomeType: input.whtIncomeType,
    whtCondition: input.whtCondition,
    paid: false,
    note: input.note,
    supplier: partySnapshot(contact),
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

/**
 * จ่ายชำระเจ้าหนี้ — เก็บใบสำคัญจ่าย (PV) ใน `state.payments`
 * มีหัก ณ ที่จ่ายจึงออกเลข 50 ทวิ (prefix WT, sequence ของตัวเอง)
 */
export function payPurchase(state: AccountingData, input: PayPurchaseInput) {
  const doc = state.purchases.find((p) => p.id === input.purchaseId);
  if (!doc) throw new BusinessRuleError('ไม่พบเอกสารซื้อ');
  if (doc.paid) throw new BusinessRuleError(`${doc.docNo} จ่ายชำระแล้ว`);
  assertPostingDate(state, input.date, 'วันที่จ่าย');
  if (input.date < doc.date) throw new BusinessRuleError('วันที่จ่ายต้องไม่ก่อนวันที่เอกสาร');
  assertCashAccount(state, input.accountCode);

  const contact = contactOf(state, doc.contactId);
  const t = calcDocument(doc);
  const pv = takeNumber(state, DOC_PREFIX.payment, input.date);
  let {sequences} = pv;
  let whtCertNo: string | undefined;
  if (toSatang(t.wht) > 0) {
    const wt = takeNumber({ ...state, sequences }, DOC_PREFIX.whtCert, input.date);
    whtCertNo = wt.docNo;
    ({ sequences } = wt);
  }
  const j = takeNumber({ ...state, sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();
  const paymentId = uid();
  const entry = postPurchasePayment(
    doc,
    { id: journalId, docNo: j.docNo },
    contactDisplayName(contact),
    input.accountCode,
    input.date,
    { id: paymentId, docNo: pv.docNo }
  );

  const payment: Payment = {
    id: paymentId,
    docNo: pv.docNo,
    date: input.date,
    purchaseId: doc.id,
    contactId: doc.contactId,
    amount: t.total,
    whtAmount: t.wht,
    netPaid: subBaht(t.total, t.wht),
    accountCode: input.accountCode,
    whtCertNo,
    payer: companySnapshot(state.company),
    payee: partySnapshot(contact),
    journalId,
  };

  const updated: PurchaseDoc = {
    ...doc,
    paid: true,
    paidDate: input.date,
    paymentAccountCode: input.accountCode,
    paymentJournalId: journalId,
    paymentId,
    paymentDocNo: pv.docNo,
    whtCertNo,
  };

  return {
    state: {
      ...state,
      purchases: state.purchases.map((p) => (p.id === doc.id ? updated : p)),
      payments: [...state.payments, payment],
      journal: [...state.journal, entry],
      sequences: j.sequences,
    },
    doc: updated,
    payment,
  };
}

// ----------------------------------------------------------------------

/**
 * รายการปรับปรุง (คีย์มือ) — ห้ามลงบัญชีคุม (ลูกหนี้ เจ้าหนี้ ภาษีซื้อ/ขาย หัก ณ ที่จ่าย เงินรอคืนลูกค้า)
 * เพราะยอดบัญชีเหล่านั้นต้องกระทบกับทะเบียนเอกสารได้
 */
export function addManualJournal(
  state: AccountingData,
  input: { date: string; description: string; lines: JournalLine[] }
) {
  assertPostingDate(state, input.date);
  if (!input.description.trim()) throw new BusinessRuleError('ระบุคำอธิบายรายการ');
  const accounts = new Map(state.accounts.map((a) => [a.code, a]));
  input.lines.forEach((l, i) => {
    const account = accounts.get(l.accountCode);
    if (!account) throw new BusinessRuleError(`บรรทัดที่ ${i + 1}: ไม่พบบัญชี ${l.accountCode}`);
    if (isControlAccount(l.accountCode)) {
      throw new BusinessRuleError(
        `บรรทัดที่ ${i + 1}: ${account.code} ${account.name} เป็นบัญชีคุม ลงด้วยเอกสาร (ขาย/ซื้อ/รับ/จ่าย/ลดหนี้) เท่านั้น`
      );
    }
    if (!Number.isFinite(l.debit) || !Number.isFinite(l.credit) || l.debit < 0 || l.credit < 0) {
      throw new BusinessRuleError(`บรรทัดที่ ${i + 1}: จำนวนเงินติดลบไม่ได้`);
    }
  });
  const j = takeNumber(state, DOC_PREFIX.journal, input.date);
  const entry: JournalEntry = buildManualEntry({ id: uid(), docNo: j.docNo }, input.date, input.description, input.lines);
  if (!entry.lines.length) throw new BusinessRuleError('ยอดรวมต้องมากกว่า 0');
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

/** แก้ข้อมูลบริษัท — วันที่ปิดงวดเปลี่ยนผ่าน `lockPeriod` เท่านั้น (ค่าที่ส่งมาถูกละ) */
export function updateCompany(state: AccountingData, company: Company): AccountingData {
  return { ...state, company: { ...company, lockedThrough: state.company.lockedThrough } };
}

/**
 * ปิดงวดถึงวันที่ `through` (รวมวันนั้น) — เลื่อนไปข้างหน้าได้อย่างเดียว ปิดแล้วเปิดย้อนไม่ได้
 * ปิดได้ไม่เกินสิ้นเดือนก่อนหน้า `today` (ปิดล่วงหน้าแล้วจะลงรายการวันนี้ไม่ได้อีกเลย)
 * หลังปิด ทุก action ที่ลงบัญชีวันที่ ≤ through จะถูกปฏิเสธ
 */
export function lockPeriod(state: AccountingData, through: string, today: ISODate = todayISO()): AccountingData {
  assertISODate(through, 'วันที่ปิดงวด');
  const max = endOfPreviousMonth(today);
  if (through > max) {
    throw new BusinessRuleError(
      `ปิดงวดได้ถึงสิ้นเดือนที่ผ่านมาแล้วเท่านั้น (ไม่เกิน ${formatThaiDate(max)}) — ปิดล่วงหน้าแล้วจะลงรายการของเดือนนี้ไม่ได้`
    );
  }
  const current = state.company.lockedThrough;
  if (current && through < current) {
    throw new BusinessRuleError(`ปิดงวดถึง ${formatThaiDate(current)} แล้ว — เลื่อนวันที่ปิดงวดย้อนหลังไม่ได้`);
  }
  return { ...state, company: { ...state.company, lockedThrough: through } };
}

const ETAX_ORDER: Record<ETaxStatus, number> = { 'not-required': -1, 'pending-sign': 0, signed: 1, uploaded: 2 };

/**
 * เปลี่ยนสถานะ e-Tax — เดินหน้าได้อย่างเดียว (รอลงนาม → ลงนามแล้ว → นำส่งแล้ว) ข้ามขั้นลงนามไม่ได้
 * ตอนนำส่งเก็บวันเวลา (`etaxUploadedAt`) และเลขอ้างอิง (`etaxReference`) ถ้ามี
 */
export function setETaxStatus(
  state: AccountingData,
  ids: string[],
  etax: ETaxStatus,
  meta: { at?: string; reference?: string } = {}
): AccountingData {
  if (etax === 'not-required') throw new BusinessRuleError('ตั้งสถานะเป็น "ไม่ต้องออก e-Tax" ไม่ได้');
  const set = new Set(ids);
  const found = state.sales.filter((s) => set.has(s.id));
  if (found.length !== set.size) throw new BusinessRuleError('ไม่พบเอกสารบางใบ');
  found.forEach((s) => {
    if (s.etax === 'not-required') throw new BusinessRuleError(`${s.docNo} ไม่ต้องออก e-Tax`);
    if (ETAX_ORDER[etax] < ETAX_ORDER[s.etax]) {
      throw new BusinessRuleError(`${s.docNo}: สถานะ e-Tax ย้อนกลับไม่ได้`);
    }
    if (etax === 'uploaded' && s.etax === 'pending-sign') {
      throw new BusinessRuleError(`${s.docNo}: ต้องลงนามก่อนนำส่ง e-Tax`);
    }
  });
  const at = meta.at ?? new Date().toISOString();
  const reference = meta.reference?.trim() || undefined;
  return {
    ...state,
    sales: state.sales.map((s) => {
      if (!set.has(s.id) || s.etax === etax) return s;
      return etax === 'uploaded' ? { ...s, etax, etaxUploadedAt: at, etaxReference: reference } : { ...s, etax };
    }),
  };
}

export const DEPOSIT_ACCOUNTS = [ACC.bank, ACC.cash];
