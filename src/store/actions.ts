import type {
  Company,
  Contact,
  Payment,
  Receipt,
  DocLine,
  ISODate,
  VatMode,
  SaleType,
  SalesDoc,
  VatClose,
  LineSide,
  Quotation,
  BankMatch,
  YearClose,
  DocPrefix,
  ETaxStatus,
  BankAccount,
  PurchaseDoc,
  JournalLine,
  BankTransfer,
  PurchaseLine,
  JournalEntry,
  AccountingData,
  CustomerRefund,
  SupplierRefund,
  OpeningBalance,
  QuotationStatus,
  BankAccountKind,
  BankStatementLine,
  PurchaseCreditLine,
  PurchaseCreditNote,
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
  monthKeyOf,
  paymentsOf,
  endOfMonth,
  postReceipt,
  calcDocument,
  postPurchase,
  postVatClose,
  creditableOf,
  currentNetOf,
  receiptVatOf,
  vatCloseDraft,
  postDebitNote,
  isMonthLocked,
  partySnapshot,
  outstandingOf,
  isTaxDocument,
  isCashAccount,
  postYearClose,
  bankAccountOf,
  docPeriodCode,
  transferTitle,
  postCreditNote,
  formatThaiDate,
  isValidISODate,
  unmatchedItems,
  normalizeTaxId,
  companySnapshot,
  creditedPartsOf,
  vatClaimProblem,
  customerCreditOf,
  isControlAccount,
  postSalesInvoice,
  receiptWhtAmount,
  buildManualEntry,
  invoiceCeilingOf,
  monthsToVatClose,
  isServiceInvoice,
  yearCloseProblem,
  sortedYearCloses,
  postBankTransfer,
  bankMatchProblem,
  normalizeBranch5,
  lastReceiptDateOf,
  yearCloseBalances,
  lastPaymentDateOf,
  lineAccountProblem,
  endOfPreviousMonth,
  contactDisplayName,
  postCustomerRefund,
  postOpeningBalance,
  autoMatchProposals,
  minCashBalanceFrom,
  QUOTATION_STATUSES,
  postSupplierRefund,
  postPurchasePayment,
  purchaseOutstanding,
  planPurchasePayment,
  nextBankAccountCode,
  supplierCreditSplit,
  supplierRefundDueOf,
  RECEIPT_WHT_MAX_RATE,
  UnbalancedEntryError,
  openingBlockedReason,
  findDuplicatePurchase,
  PURCHASE_WHT_MAX_RATE,
  DATE_ORDERED_PREFIXES,
  serviceCreditNotePlan,
  purchaseCreditedParts,
  postPurchaseCreditNote,
  supplierVatClaimProblem,
  quotationConvertProblem,
  purchaseCreditAllocation,
  findDuplicateSupplierCredit,
  isValidISODate as isISODate,
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

/** ตรวจวันที่ของรายการที่จะลงบัญชี: รูปแบบถูกต้อง + งวดยังไม่ปิด + หลังวันยอดยกมา */
function assertPostingDate(state: AccountingData, date: string, label?: string): asserts date is ISODate {
  assertISODate(date, label);
  assertOpenPeriod(state, date);
  const opening = state.openingBalance;
  if (opening && date <= opening.date) {
    throw new BusinessRuleError(
      `ยอดยกมา ณ ${formatThaiDate(opening.date)} — รายการใหม่ต้องลงวันที่หลังวันยอดยกมา (${formatThaiDate(date)})`
    );
  }
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
    ...(state.supplierRefunds ?? []),
    ...state.purchaseCredits,
    ...state.transfers,
    ...state.quotations,
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
 * เงินสดย่อยติดลบไม่ได้: จ่าย/โอนออก `amount` ณ วันที่ `date` แล้วยอดคงเหลือทุกวันตั้งแต่วันนั้นต้องไม่ติดลบ
 * (บัญชีธนาคารเบิกเกินบัญชีได้ จึงไม่ตรวจ)
 */
function assertPettyCashAvailable(state: AccountingData, code: string, date: ISODate, amount: number) {
  if (bankAccountOf(state, code)?.kind !== 'petty-cash') return;
  const available = minCashBalanceFrom(state, code, date);
  if (toSatang(amount) > toSatang(available)) {
    throw new BusinessRuleError(
      `เงินสดย่อย ${code} คงเหลือไม่พอ (ใช้ได้ ${Math.max(0, available).toFixed(2)} บาท ณ วันที่ ${formatThaiDate(date)}) — เบิกชดเชยจากธนาคารก่อน`
    );
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
  /** ขายสินค้า (ไม่ส่ง) หรืองานบริการ (ม.78/1) */
  saleType?: SaleType;
};

/**
 * ออกใบกำกับภาษี (บริษัทจด VAT, prefix IV) หรือใบแจ้งหนี้ (บริษัทไม่จด VAT, prefix BL, ไม่มี VAT)
 * งานบริการของบริษัทจด VAT (ม.78/1): ออกเป็นใบแจ้งหนี้ (BL ไม่ใช่ใบกำกับภาษี) คิด VAT แต่พักไว้ที่ 2151
 * จนรับชำระ — ใบเสร็จรับเงิน/ใบกำกับภาษี (RT) ออกตอน `receivePayment`
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
  const { vatRegistered } = state.company;
  const service = input.saleType === 'service';
  const vatRate = vatRegistered ? VAT_RATE : 0;
  const vatMode = vatRegistered ? input.vatMode : 'none';
  // งานบริการที่คิด VAT: ใบแจ้งหนี้ (ไม่ใช่ใบกำกับภาษี) — งานบริการไม่มี VAT (ยกเว้น) ก็เป็นใบแจ้งหนี้ธรรมดา
  const isTaxInvoice = vatRegistered && !service;
  assertPositiveTotal(calcDocument({ lines: input.lines, vatMode, vatRate }).total);

  const n = takeNumber(state, isTaxInvoice ? DOC_PREFIX.taxInvoice : DOC_PREFIX.invoice, input.date);
  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const id = uid();
  const journalId = uid();

  const doc: SalesDoc = {
    id,
    kind: 'tax-invoice',
    isTaxInvoice,
    ...(service ? { saleType: 'service' as const } : {}),
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

/** ตรวจร่วมของใบลดหนี้/ใบเพิ่มหนี้: วันที่ไม่ก่อนใบกำกับและไม่ก่อนการรับชำระครั้งล่าสุด, งวดเปิด, มีเหตุผล */
function assertAdjustmentDate(state: AccountingData, invoice: SalesDoc, input: { date: string; reason: string }, label: string) {
  assertPostingDate(state, input.date, `วันที่${label}`);
  if (!input.reason.trim()) throw new BusinessRuleError(`${label}ต้องระบุเหตุผล`);
  if (input.date < invoice.date) throw new BusinessRuleError(`วันที่${label}ต้องไม่ก่อนวันที่ใบกำกับเดิม`);
  // ยอดค้าง (และส่วนที่ตั้งเป็นเงินรอคืน) คิดจากการรับชำระทั้งหมด จึงห้ามลงวันที่ก่อนการรับชำระครั้งล่าสุด
  const lastReceipt = lastReceiptDateOf(state, invoice.id);
  if (lastReceipt && input.date < lastReceipt) {
    throw new BusinessRuleError(
      `วันที่${label}ต้องไม่ก่อนวันรับชำระครั้งล่าสุดของ ${invoice.docNo} (${formatThaiDate(lastReceipt)})`
    );
  }
}

export type CreditNoteInput = {
  invoiceId: string;
  date: string;
  reason: string;
  lines: DocLine[];
};

/**
 * ใบลดหนี้อ้างใบกำกับเดิม — ลดได้ไม่เกิน ยอดใบกำกับ + ใบเพิ่มหนี้ − ใบลดหนี้ก่อนหน้า (แม้รับชำระแล้ว ตาม ม.86/10)
 * เก็บมูลค่าตามใบกำกับเดิม (ณ วันออก) และมูลค่าที่ถูกต้อง สำหรับพิมพ์/XML
 * ส่วนที่เกินยอดค้างชำระตั้งเป็นเงินรอคืนลูกค้า (`doc.creditToCustomer`) แล้วคืนด้วย `refundCustomerCredit`
 */
export function issueCreditNote(state: AccountingData, input: CreditNoteInput) {
  const invoice = state.sales.find((s) => s.id === input.invoiceId && s.kind === 'tax-invoice');
  if (!invoice) throw new BusinessRuleError('ไม่พบใบกำกับภาษีที่อ้างถึง');
  if (invoice.opening) {
    throw new BusinessRuleError(`${invoice.docNo} เป็นยอดยกมาจากระบบเดิม — ออกใบลดหนี้ในระบบเดิมแล้วบันทึกเป็นรายการปรับปรุง`);
  }
  assertAdjustmentDate(state, invoice, input, 'ใบลดหนี้');
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
  // ลดหลายใบบนใบราคารวม VAT: เศษปัดของแต่ละใบสะสมได้ — VAT และมูลค่าที่ลดรวมต้องไม่เกินของใบเดิม (+ ใบเพิ่มหนี้) (ม.86/10)
  const original = invoiceCeilingOf(state, invoice);
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
  const originalNet = currentNetOf(state, invoice);
  const outstanding = outstandingOf(state, invoice);
  // งานบริการ (ม.78/1): ก่อนรับครบ = ใบลดหนี้ธรรมดากลับ VAT รอตัด, รับครบแล้ว = ใบลดหนี้/ใบกำกับภาษีอ้างใบเสร็จ (ดู service-vat.ts)
  const plan = serviceCreditNotePlan(state, invoice, credit);
  if (plan?.problem) throw new BusinessRuleError(plan.problem);
  const creditToCustomer = plan
    ? plan.creditToCustomer
    : toSatang(creditTotal) > toSatang(outstanding)
      ? subBaht(creditTotal, outstanding)
      : 0;

  const contact = contactOf(state, invoice.contactId);
  const isTaxInvoice = plan ? plan.isTaxInvoice : isTaxDocument(invoice);
  const n = takeNumber(state, isTaxInvoice ? DOC_PREFIX.creditNote : DOC_PREFIX.creditMemo, input.date);
  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();

  const doc: SalesDoc = {
    id: uid(),
    kind: 'credit-note',
    isTaxInvoice,
    ...(invoice.saleType ? { saleType: invoice.saleType } : {}),
    docNo: n.docNo,
    date: input.date,
    dueDate: input.date,
    contactId: invoice.contactId,
    lines: input.lines,
    vatMode: invoice.vatMode,
    vatRate: invoice.vatRate,
    refDocId: invoice.id,
    ...(plan?.refReceiptId ? { refReceiptId: plan.refReceiptId } : {}),
    ...(plan && toSatang(plan.deferredVatRounding) !== 0 ? { deferredVatRounding: plan.deferredVatRounding } : {}),
    reason: input.reason,
    originalNet,
    correctNet: subBaht(originalNet, credit.net),
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

export type DebitNoteInput = CreditNoteInput;

/**
 * ใบเพิ่มหนี้ (ม.86/9) อ้างใบกำกับเดิม — เพิ่มมูลค่าขาย (เพิ่มราคา / ส่งเกิน / คำนวณราคาต่ำไป)
 * กฎวันที่/งวดเหมือนใบลดหนี้ ยอดที่เพิ่มรวมเข้ายอดค้างชำระของใบกำกับเดิม, ภาษีขายเข้าเดือนที่ออกใบเพิ่มหนี้
 * บริษัทไม่จด VAT ออกเป็นใบเพิ่มหนี้ธรรมดา (prefix DM ไม่ใช่เอกสารภาษี)
 */
export function issueDebitNote(state: AccountingData, input: DebitNoteInput) {
  const invoice = state.sales.find((s) => s.id === input.invoiceId && s.kind === 'tax-invoice');
  if (!invoice) throw new BusinessRuleError('ไม่พบใบกำกับภาษีที่อ้างถึง');
  if (invoice.status === 'cancelled') throw new BusinessRuleError(`${invoice.docNo} ถูกยกเลิกด้วยใบลดหนี้แล้ว — ออกใบกำกับใหม่แทน`);
  if (invoice.opening) throw new BusinessRuleError(`${invoice.docNo} เป็นยอดยกมาจากระบบเดิม — ออกใบแจ้งหนี้/ใบกำกับใหม่แทน`);
  if (invoice.saleType === 'service' && !isTaxDocument(invoice)) {
    throw new BusinessRuleError(`${invoice.docNo} เป็นใบแจ้งหนี้งานบริการ — ค่าบริการที่เพิ่มให้ออกใบแจ้งหนี้ใบใหม่ (ภาษีขายเกิดเมื่อรับชำระ)`);
  }
  assertAdjustmentDate(state, invoice, input, 'ใบเพิ่มหนี้');
  assertLines(state, input.lines, 'sales');
  const debit = calcDocument({ ...invoice, lines: input.lines });
  assertPositiveTotal(debit.total);
  const originalNet = currentNetOf(state, invoice);

  const contact = contactOf(state, invoice.contactId);
  const isTaxInvoice = isTaxDocument(invoice);
  const n = takeNumber(state, isTaxInvoice ? DOC_PREFIX.debitNote : DOC_PREFIX.debitMemo, input.date);
  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();

  const doc: SalesDoc = {
    id: uid(),
    kind: 'debit-note',
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
    originalNet,
    correctNet: sumBaht([originalNet, debit.net]),
    note: invoice.note,
    status: 'issued',
    paidAmount: 0,
    etax: isTaxInvoice && invoice.vatMode !== 'none' ? 'pending-sign' : 'not-required',
    seller: companySnapshot(state.company),
    buyer: partySnapshot(contact),
    journalId,
    createdAt: new Date().toISOString(),
  };
  const entry = postDebitNote(doc, { id: journalId, docNo: j.docNo }, contactDisplayName(contact));

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
  // งานบริการ (ม.78/1): ใบเสร็จรับเงิน/ใบกำกับภาษี (RT) ของส่วนที่รับ — ภาษีขายเกิดในเดือนที่รับเงิน
  const service = isServiceInvoice(invoice);
  const vat = service ? receiptVatOf(state, invoice, input.amount) : 0;
  const n = takeNumber(state, service ? DOC_PREFIX.receiptTaxInvoice : DOC_PREFIX.receipt, input.date);
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
    ...(service ? { isTaxInvoice: true, vat, etax: 'pending-sign' as const } : {}),
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
  assertPettyCashAvailable(state, input.accountCode, input.date, input.amount);

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
  'supplierInvoiceNo' | 'supplierInvoiceDate' | 'vatClaimPeriod' | 'date' | 'contactId' | 'vatMode' | 'claimVat' | 'whtCondition' | 'note'
> & {
  /** บรรทัดรายการ — หัก ณ ที่จ่ายระดับบรรทัด (สินค้าไม่หัก: whtRate 0) */
  lines: PurchaseLine[];
  /** จ่ายทันทีพร้อมบันทึก (เช่น ค่าใช้จ่ายเงินสด) — จ่ายเต็มจำนวน */
  payNow?: { date: string; accountCode: string };
};

/** ตรวจหัก ณ ที่จ่ายระดับบรรทัด: อัตรา 0–15% และต้องมีประเภทเงินได้เมื่อหัก */
function assertWhtLines(lines: PurchaseLine[]) {
  lines.forEach((l, i) => {
    const no = `รายการที่ ${i + 1}`;
    if (!Number.isFinite(l.whtRate) || l.whtRate < 0 || l.whtRate > PURCHASE_WHT_MAX_RATE) {
      throw new BusinessRuleError(`${no}: อัตราหัก ณ ที่จ่ายต้องอยู่ระหว่าง 0–${PURCHASE_WHT_MAX_RATE}%`);
    }
    if (l.whtRate > 0 && !(l.whtIncomeType ?? '').trim()) {
      throw new BusinessRuleError(`${no}: หัก ณ ที่จ่ายต้องระบุประเภทเงินได้`);
    }
  });
}

/**
 * บันทึกซื้อ/ค่าใช้จ่าย — `date` = วันที่บันทึก (เลข PI เรียงตามวันที่นี้)
 * ภาษีซื้อ (ม.82/3): ขอคืนต้องมีเลขที่และวันที่ใบกำกับผู้ขาย และเลือกเดือนใช้สิทธิภายใน 6 เดือนถัดจากเดือนในใบกำกับ
 * ที่ยังไม่ปิดงวด — ผู้ขายไม่มีเลขผู้เสียภาษี/สาขาที่ถูกต้อง (ม.82/5) ภาษีซื้อเป็นค่าใช้จ่ายแทน (claimVat = false)
 * บริษัทไม่จด VAT ขอคืนภาษีซื้อไม่ได้ (VAT เป็นค่าใช้จ่าย)
 * กันเลขใบกำกับผู้ขายซ้ำ (ผู้ขายเดียวกัน + เลขเดียวกัน) เพื่อไม่ให้ขอคืนภาษีซื้อซ้ำ
 */
export function recordPurchase(
  state: AccountingData,
  input: PurchaseInput
): { state: AccountingData; doc: PurchaseDoc; payment?: Payment } {
  assertPostingDate(state, input.date, 'วันที่บันทึก');
  assertLines(state, input.lines, 'purchase');
  assertWhtLines(input.lines);
  const contact = contactOf(state, input.contactId);
  const supplier = partySnapshot(contact);
  const supplierInvoiceDate = input.supplierInvoiceDate?.slice(0, 10) || undefined;
  if (supplierInvoiceDate) assertISODate(supplierInvoiceDate, 'วันที่ใบกำกับผู้ขาย');
  // ม.82/5: ใบกำกับที่ไม่มีเลขผู้เสียภาษี/สาขาของผู้ขาย = ภาษีซื้อต้องห้าม → บันทึกเป็นค่าใช้จ่าย (หน้าจอเตือนก่อนบันทึก)
  const claimVat =
    state.company.vatRegistered && input.vatMode !== 'none' && input.claimVat && !supplierVatClaimProblem(supplier);
  const vatClaimPeriod = claimVat ? input.vatClaimPeriod : undefined;
  if (claimVat) {
    if (!input.supplierInvoiceNo.trim()) throw new BusinessRuleError('ขอคืนภาษีซื้อต้องมีเลขที่ใบกำกับภาษีของผู้ขาย');
    const problem = vatClaimProblem({ date: input.date, supplierInvoiceDate, vatClaimPeriod });
    if (problem) throw new BusinessRuleError(problem);
    if (vatClaimPeriod && isMonthLocked(vatClaimPeriod, state.company.lockedThrough)) {
      throw new BusinessRuleError(`เดือนภาษี ${vatClaimPeriod} ปิดงวดแล้ว (ยื่น ภ.พ.30 ไปแล้ว) — เลือกเดือนใช้สิทธิถัดไป`);
    }
    // เดือนของวันยอดยกมาและก่อนหน้า ยื่น ภ.พ.30 ในระบบเดิมแล้ว — ปิดภาษีเดือนนั้นในระบบนี้จะลงรายการก่อนวันยอดยกมา
    const opening = state.openingBalance;
    if (vatClaimPeriod && opening && vatClaimPeriod <= monthKeyOf(opening.date)) {
      throw new BusinessRuleError(
        `เดือนภาษี ${vatClaimPeriod} ยื่นในระบบเดิมแล้ว (ยอดยกมา ณ ${formatThaiDate(opening.date)}) — เลือกเดือนใช้สิทธิหลังวันยอดยกมา`
      );
    }
  } else if (supplierInvoiceDate && supplierInvoiceDate > input.date) {
    throw new BusinessRuleError('วันที่ใบกำกับผู้ขายต้องไม่หลังวันที่บันทึก');
  }
  const dup = findDuplicatePurchase(state.purchases, state.contacts, {
    contactId: contact.id,
    supplierInvoiceNo: input.supplierInvoiceNo,
    party: supplier,
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
    supplierInvoiceDate,
    date: input.date,
    contactId: contact.id,
    lines: input.lines.map((l) => ({
      ...l,
      whtRate: l.whtRate > 0 ? l.whtRate : 0,
      whtIncomeType: l.whtRate > 0 ? l.whtIncomeType.trim() : '',
    })),
    vatMode: input.vatMode,
    vatRate,
    claimVat,
    vatClaimPeriod,
    whtCondition: input.whtCondition,
    paid: false,
    note: input.note,
    supplier,
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

export type PayPurchaseInput = {
  purchaseId: string;
  date: string;
  accountCode: string;
  /** ยอดตัดเจ้าหนี้ครั้งนี้ (รวม VAT ก่อนหัก ณ ที่จ่าย) — ไม่ส่ง = จ่ายยอดค้างทั้งหมด */
  amount?: number;
};

/**
 * จ่ายชำระเจ้าหนี้ (แบ่งจ่ายได้) — ออกใบสำคัญจ่าย (PV) 1 ใบต่อการจ่าย 1 ครั้งใน `state.payments`
 * หัก ณ ที่จ่ายตามสัดส่วนยอดที่จ่าย (`planPurchasePayment`) เข้างวด ภ.ง.ด. ตามวันที่จ่ายครั้งนั้น
 * มีหักจึงออกเลข 50 ทวิ (prefix WT, sequence ของตัวเอง) ให้การจ่ายครั้งนั้น
 */
export function payPurchase(state: AccountingData, input: PayPurchaseInput) {
  const doc = state.purchases.find((p) => p.id === input.purchaseId);
  if (!doc) throw new BusinessRuleError('ไม่พบเอกสารซื้อ');
  const outstanding = purchaseOutstanding(state, doc);
  if (doc.paid || toSatang(outstanding) <= 0) throw new BusinessRuleError(`${doc.docNo} จ่ายชำระแล้ว`);
  assertPostingDate(state, input.date, 'วันที่จ่าย');
  if (input.date < doc.date) throw new BusinessRuleError('วันที่จ่ายต้องไม่ก่อนวันที่เอกสาร');
  const amount = input.amount === undefined ? outstanding : round2(input.amount);
  if (!Number.isFinite(amount) || !(toSatang(amount) > 0)) throw new BusinessRuleError('ยอดจ่ายต้องมากกว่า 0');
  if (toSatang(amount) > toSatang(outstanding)) {
    throw new BusinessRuleError(`ยอดจ่ายเกินยอดค้าง (ค้างอยู่ ${outstanding.toFixed(2)} บาท)`);
  }
  assertCashAccount(state, input.accountCode);

  const contact = contactOf(state, doc.contactId);
  const plan = planPurchasePayment(state, doc, amount);
  if (toSatang(plan.netPaid) < 0) throw new BusinessRuleError('ภาษีหัก ณ ที่จ่ายเกินยอดที่จ่ายครั้งนี้ — เพิ่มยอดจ่าย');
  assertPettyCashAvailable(state, input.accountCode, input.date, plan.netPaid);
  const pv = takeNumber(state, DOC_PREFIX.payment, input.date);
  let { sequences } = pv;
  let whtCertNo: string | undefined;
  if (toSatang(plan.whtAmount) > 0) {
    const wt = takeNumber({ ...state, sequences }, DOC_PREFIX.whtCert, input.date);
    whtCertNo = wt.docNo;
    ({ sequences } = wt);
  }
  const j = takeNumber({ ...state, sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();

  const payment: Payment = {
    id: uid(),
    docNo: pv.docNo,
    date: input.date,
    purchaseId: doc.id,
    contactId: doc.contactId,
    amount,
    whtAmount: plan.whtAmount,
    netPaid: plan.netPaid,
    whtItems: plan.whtItems,
    accountCode: input.accountCode,
    whtCertNo,
    payer: companySnapshot(state.company),
    payee: partySnapshot(contact),
    journalId,
  };
  const entry = postPurchasePayment(payment, { id: journalId, docNo: j.docNo }, contactDisplayName(contact), doc.docNo);
  const updated: PurchaseDoc = { ...doc, paid: plan.final };

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
  // U9: เครดิตเงินสดย่อยสุทธิเกินยอดคงเหลือไม่ได้ (เหมือนจ่าย/โอนออก) — ธนาคารเบิกเกินบัญชีได้
  Array.from(new Set(entry.lines.map((l) => l.accountCode))).forEach((code) => {
    const net = entry.lines.filter((l) => l.accountCode === code).reduce((a, l) => a + toSatang(l.credit) - toSatang(l.debit), 0);
    if (net > 0) assertPettyCashAvailable(state, code, input.date, net / 100);
  });
  return { state: { ...state, journal: [...state.journal, entry], sequences: j.sequences }, entry };
}

/** เพิ่ม/แก้ผู้ติดต่อ แล้วคืนผู้ติดต่อที่บันทึก (ใช้เลือกในฟอร์มทันทีหลัง "+ เพิ่มใหม่") */
export function saveContact(state: AccountingData, contact: Omit<Contact, 'id'> & { id?: string }): { state: AccountingData; contact: Contact } {
  if (!contact.name.trim()) throw new BusinessRuleError('ต้องระบุชื่อ');
  const duplicate = state.contacts.find((c) => c.code === contact.code && c.id !== contact.id);
  if (duplicate) throw new BusinessRuleError(`รหัส ${contact.code} ซ้ำกับ ${duplicate.name}`);
  if (contact.id) {
    const saved = contact as Contact;
    return { state: { ...state, contacts: state.contacts.map((c) => (c.id === contact.id ? saved : c)) }, contact: saved };
  }
  const saved: Contact = { ...contact, id: uid() };
  return { state: { ...state, contacts: [...state.contacts, saved] }, contact: saved };
}

export function upsertContact(state: AccountingData, contact: Omit<Contact, 'id'> & { id?: string }) {
  return saveContact(state, contact).state;
}

export function importContacts(state: AccountingData, contacts: Omit<Contact, 'id'>[]) {
  const existing = new Set(state.contacts.map((c) => c.code));
  const fresh = contacts.filter((c) => !existing.has(c.code)).map((c) => ({ ...c, id: uid() }));
  return { state: { ...state, contacts: [...state.contacts, ...fresh] }, added: fresh.length, skipped: contacts.length - fresh.length };
}

/** มีเอกสารที่ออกในนามบริษัทแล้วหรือยัง (เอกสารขาย ใบเสร็จ ใบสำคัญจ่าย/50 ทวิ ใบคืนเงิน) */
export function hasIssuedDocuments(state: AccountingData): boolean {
  return state.sales.length > 0 || state.receipts.length > 0 || state.payments.length > 0 || state.refunds.length > 0;
}

/**
 * แก้ข้อมูลบริษัท — วันที่ปิดงวดเปลี่ยนผ่าน `lockPeriod` เท่านั้น (ค่าที่ส่งมาถูกละ)
 * U3: มีเอกสารที่ออกแล้ว เปลี่ยนเลขผู้เสียภาษี/สาขาไม่ได้ (เป็นตัวระบุบริษัทในเอกสารและการกู้คืน) — แก้รูปแบบการพิมพ์ได้
 */
export function updateCompany(state: AccountingData, company: Company): AccountingData {
  const changedId =
    normalizeTaxId(company.taxId) !== normalizeTaxId(state.company.taxId) ||
    normalizeBranch5(company.branchNo) !== normalizeBranch5(state.company.branchNo);
  if (changedId && hasIssuedDocuments(state)) {
    throw new BusinessRuleError(
      'ออกเอกสารในนามบริษัทแล้ว — เปลี่ยนเลขประจำตัวผู้เสียภาษี/สาขาไม่ได้ (เป็นบริษัทใหม่ ให้ล้างข้อมูลแล้วเริ่มสมุดบัญชีใหม่)'
    );
  }
  return { ...state, company: { ...company, lockedThrough: state.company.lockedThrough } };
}

/**
 * ปิดงวดถึงวันที่ `through` (รวมวันนั้น) — เลื่อนไปข้างหน้าได้อย่างเดียว ปิดแล้วเปิดย้อนไม่ได้
 * ปิดได้ไม่เกินสิ้นเดือนก่อนหน้า `today` (ปิดล่วงหน้าแล้วจะลงรายการวันนี้ไม่ได้อีกเลย)
 * หลังปิด ทุก action ที่ลงบัญชีวันที่ ≤ through จะถูกปฏิเสธ
 *
 * ปิดภาษีเดือน (B6) พร้อมกัน: ทุกเดือนที่ปิดงวดครบทั้งเดือนและยังไม่ปิดภาษี ได้รายการปิดภาษีลงวันสิ้นเดือน
 * (Dr ภาษีขาย / Cr ภาษีซื้อ / Cr VAT ค้างจ่าย หรือ Dr ภาษีชำระเกินยกไป) — ยอดชำระเกินยกไปเดือนถัดไปอัตโนมัติ
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
  let next: AccountingData = state;
  monthsToVatClose(state, through).forEach((month) => {
    const draft = vatCloseDraft(next, month);
    const close: VatClose = { ...draft, id: uid() };
    const j = nextDocNo(next.sequences, DOC_PREFIX.journal, draft.date);
    const entry = postVatClose(close, { id: uid(), docNo: j.docNo });
    next = {
      ...next,
      vatCloses: [...next.vatCloses, entry ? { ...close, journalId: entry.id } : close],
      journal: entry ? [...next.journal, entry] : next.journal,
      sequences: entry ? { ...next.sequences, [j.key]: j.value } : next.sequences,
    };
  });
  return { ...next, company: { ...next.company, lockedThrough: through } };
}

const ETAX_ORDER: Record<ETaxStatus, number> = { 'not-required': -1, 'pending-sign': 0, signed: 1, uploaded: 2 };

/**
 * เปลี่ยนสถานะ e-Tax — เดินหน้าได้อย่างเดียว (รอลงนาม → ลงนามแล้ว → นำส่งแล้ว) ข้ามขั้นลงนามไม่ได้
 * ตอนนำส่งเก็บวันเวลา (`etaxUploadedAt`) และเลขอ้างอิง (`etaxReference`) ถ้ามี
 * `ids` เป็นได้ทั้งเอกสารขาย และใบเสร็จรับเงิน/ใบกำกับภาษีของงานบริการ
 */
export function setETaxStatus(
  state: AccountingData,
  ids: string[],
  etax: ETaxStatus,
  meta: { at?: string; reference?: string } = {}
): AccountingData {
  if (etax === 'not-required') throw new BusinessRuleError('ตั้งสถานะเป็น "ไม่ต้องออก e-Tax" ไม่ได้');
  const set = new Set(ids);
  const found = [
    ...state.sales.filter((s) => set.has(s.id)).map((s) => ({ docNo: s.docNo, etax: s.etax })),
    ...state.receipts.filter((r) => set.has(r.id)).map((r) => ({ docNo: r.docNo, etax: r.etax ?? 'not-required' })),
  ];
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
  const apply = <T extends { id: string; etax?: ETaxStatus }>(doc: T): T => {
    if (!set.has(doc.id) || doc.etax === etax) return doc;
    return etax === 'uploaded' ? { ...doc, etax, etaxUploadedAt: at, etaxReference: reference } : { ...doc, etax };
  };
  return { ...state, sales: state.sales.map(apply), receipts: state.receipts.map(apply) };
}

// ---------------- ใบลดหนี้จากผู้ขาย (B8) ----------------

export type SupplierCreditNoteInput = {
  purchaseId: string;
  /** เลขที่ใบลดหนี้ของผู้ขาย (บังคับเมื่อเอกสารเดิมขอคืนภาษีซื้อ) */
  supplierCreditNoteNo: string;
  supplierCreditNoteDate: string;
  /** วันที่ได้รับ/บันทึก — ภาษีซื้อลดในเดือนนี้ */
  date: string;
  reason: string;
  /** บรรทัดที่ลด — `purchaseLineId` อ้างบรรทัดของเอกสารซื้อ (ไม่ส่ง = จับคู่ตามบัญชี) */
  lines: PurchaseCreditLine[];
};

const normalizeDocNo = (v: string) => v.replace(/[\s\-_/.]/g, '').toUpperCase();

/**
 * บันทึกใบลดหนี้จากผู้ขาย (ม.82/12 — ⚠️ ยืนยันมาตรากับที่ปรึกษาภาษี) อ้างเอกสารซื้อเดิม
 * - D1: ลดได้ไม่เกินยอดเอกสาร − ใบลดหนี้ก่อนหน้า (แม้จ่ายแล้วบางส่วน/ทั้งหมด) — ส่วนที่เกินยอดค้างจ่าย
 *   ตั้งเป็นลูกหนี้-เงินคืนจากผู้ขาย 1150 (`doc.refundDue`) แล้วรับเงินด้วย `receiveSupplierRefund`
 * - มูลค่า/VAT ที่ลดรวมไม่เกินของเอกสารเดิม, บรรทัดที่ลดไม่เกินมูลค่าบรรทัดเดิม, วันที่ไม่ก่อนเอกสารเดิมและการจ่ายครั้งล่าสุด
 * - เอกสารเดิมขอคืนภาษีซื้อ: ลดภาษีซื้อในเดือนที่ได้รับ (`vatClaimPeriod` = เดือนของ `date`) ซึ่งต้องไม่ก่อนเดือนใช้สิทธิเดิม
 * - U8: ฐานหัก ณ ที่จ่ายลดเฉพาะบรรทัดที่ลดหนี้ (`purchaseAdjustedWhtGroups`) — การจ่ายครั้งถัดไปหักจากฐานคงเหลือ
 * - หัก ณ ที่จ่ายที่หักไปแล้วในการจ่ายก่อนหน้าไม่ปรับ (50 ทวิ ออกตามวันที่จ่ายแล้ว) — คืน `warnings` ให้หน้าจอแจ้ง
 * - U12: กันเลขใบลดหนี้ผู้ขายซ้ำ (ผู้ขายเดียวกันตามเลขผู้เสียภาษี+สาขา แม้เป็นผู้ติดต่อคนละรายการ)
 */
export function recordSupplierCreditNote(
  state: AccountingData,
  input: SupplierCreditNoteInput
): { state: AccountingData; doc: PurchaseCreditNote; warnings: string[] } {
  const purchase = state.purchases.find((p) => p.id === input.purchaseId);
  if (!purchase) throw new BusinessRuleError('ไม่พบเอกสารซื้อที่อ้างถึง');
  if (purchase.opening) {
    throw new BusinessRuleError(`${purchase.docNo} เป็นยอดยกมาจากระบบเดิม — บันทึกใบลดหนี้ด้วยรายการปรับปรุงในระบบเดิม`);
  }
  assertPostingDate(state, input.date, 'วันที่ได้รับใบลดหนี้');
  const supplierDate = input.supplierCreditNoteDate?.slice(0, 10) ?? '';
  assertISODate(supplierDate, 'วันที่ในใบลดหนี้ของผู้ขาย');
  if (supplierDate > input.date) throw new BusinessRuleError('วันที่ในใบลดหนี้ของผู้ขายต้องไม่หลังวันที่ได้รับ');
  if (input.date < purchase.date) throw new BusinessRuleError(`วันที่ได้รับใบลดหนี้ต้องไม่ก่อนวันที่บันทึก ${purchase.docNo}`);
  if (supplierDate < (purchase.supplierInvoiceDate ?? purchase.date)) {
    throw new BusinessRuleError('วันที่ในใบลดหนี้ของผู้ขายต้องไม่ก่อนวันที่ใบกำกับเดิม');
  }
  if (!input.reason.trim()) throw new BusinessRuleError('ใบลดหนี้ต้องระบุเหตุผล');
  const lastPaid = lastPaymentDateOf(state, purchase.id);
  if (lastPaid && input.date < lastPaid) {
    throw new BusinessRuleError(`วันที่ได้รับใบลดหนี้ต้องไม่ก่อนการจ่ายครั้งล่าสุดของ ${purchase.docNo} (${formatThaiDate(lastPaid)})`);
  }
  const { claimVat } = purchase;
  const supplierCreditNoteNo = input.supplierCreditNoteNo.trim();
  if (claimVat && !supplierCreditNoteNo) throw new BusinessRuleError('ลดภาษีซื้อต้องมีเลขที่ใบลดหนี้ของผู้ขาย');
  const contact = contactOf(state, purchase.contactId);
  const dup = findDuplicateSupplierCredit(state.purchaseCredits, state.contacts, {
    contactId: purchase.contactId,
    supplierCreditNoteNo,
    party: partySnapshot(contact),
  });
  if (dup) {
    throw new BusinessRuleError(
      `ใบลดหนี้ผู้ขายเลขที่ ${supplierCreditNoteNo} บันทึกไปแล้วใน ${dup.docNo}${dup.contactId === purchase.contactId ? '' : ' (ผู้ขายเลขผู้เสียภาษีเดียวกัน)'}`
    );
  }
  assertLines(state, input.lines, 'purchase');
  input.lines.forEach((l, i) => {
    if (l.purchaseLineId && !purchase.lines.some((pl) => pl.id === l.purchaseLineId)) {
      throw new BusinessRuleError(`รายการที่ ${i + 1}: ไม่พบบรรทัดของ ${purchase.docNo} ที่อ้างถึง`);
    }
  });

  const credit = calcDocument({ lines: input.lines, vatMode: purchase.vatMode, vatRate: purchase.vatRate });
  assertPositiveTotal(credit.total);
  const split = supplierCreditSplit(state, purchase, credit.total);
  if (toSatang(credit.total) > toSatang(split.limit)) {
    throw new BusinessRuleError(
      `ยอดลดหนี้ ${credit.total.toFixed(2)} เกินยอดที่ลดได้ของ ${purchase.docNo} (${split.limit.toFixed(2)} บาท = ยอดเอกสารหักใบลดหนี้ก่อนหน้า)`
    );
  }
  const original = calcDocument(purchase);
  const before = purchaseCreditedParts(state, purchase);
  if (toSatang(sumBaht([before.vat, credit.vat])) > toSatang(original.vat)) {
    throw new BusinessRuleError(`ภาษีที่ลดรวมเกินภาษีของ ${purchase.docNo} (${original.vat.toFixed(2)})`);
  }
  if (toSatang(sumBaht([before.net, credit.net])) > toSatang(original.net)) {
    throw new BusinessRuleError(`มูลค่าที่ลดรวมเกินมูลค่าของ ${purchase.docNo} (${original.net.toFixed(2)})`);
  }
  const month = monthKeyOf(input.date);
  if (claimVat) {
    const claimMonth = purchase.vatClaimPeriod ?? monthKeyOf(purchase.date);
    if (month < claimMonth) {
      throw new BusinessRuleError(
        `ภาษีซื้อของ ${purchase.docNo} ใช้สิทธิเดือน ${claimMonth} — บันทึกใบลดหนี้ (ลดภาษีซื้อ) ได้ตั้งแต่เดือนนั้น`
      );
    }
  }

  const n = takeNumber(state, DOC_PREFIX.purchaseCredit, input.date);
  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();
  const doc: PurchaseCreditNote = {
    id: uid(),
    docNo: n.docNo,
    supplierCreditNoteNo,
    supplierCreditNoteDate: supplierDate,
    date: input.date,
    purchaseId: purchase.id,
    contactId: purchase.contactId,
    lines: input.lines,
    vatMode: purchase.vatMode,
    vatRate: purchase.vatRate,
    ...(toSatang(split.refundDue) > 0 ? { refundDue: split.refundDue } : {}),
    claimVat,
    vatClaimPeriod: claimVat ? month : undefined,
    reason: input.reason.trim(),
    supplier: partySnapshot(contact),
    journalId,
    createdAt: new Date().toISOString(),
  };

  // ลดหนี้แต่ละบรรทัดได้ไม่เกินมูลค่าคงเหลือของบรรทัดเดิม (ฐานหัก ณ ที่จ่ายรายบรรทัด)
  const allocation = purchaseCreditAllocation(purchase, [...purchaseCreditsOfState(state, purchase.id), doc]);
  if (allocation.problems.length) throw new BusinessRuleError(allocation.problems[allocation.problems.length - 1]);

  const withCredit: AccountingData = { ...state, purchaseCredits: [...state.purchaseCredits, doc] };
  const warnings: string[] = [];
  const withheld = sumBaht(paymentsOf(state, purchase.id).map((pv) => pv.whtAmount));
  if (toSatang(withheld) > 0) {
    warnings.push(
      `${purchase.docNo} หักภาษี ณ ที่จ่ายไปแล้ว ${withheld.toFixed(2)} บาท ในการจ่ายก่อนหน้า — ระบบไม่ปรับภาษีที่หักและ 50 ทวิ ที่ออกไปแล้ว (เข้างวดตามวันที่จ่าย) การจ่ายครั้งถัดไปหักจากฐานคงเหลือหลังลดหนี้ ถ้าต้องคืนภาษีที่หักเกินให้ผู้ขาย ให้ตกลงกับผู้ขายและปรับปรุงเอง`
    );
  }
  if (toSatang(split.refundDue) > 0) {
    warnings.push(
      `ยอด ${split.refundDue.toFixed(2)} บาท เกินยอดค้างจ่าย (จ่ายไปแล้ว) — ตั้งเป็นลูกหนี้-เงินคืนจากผู้ขาย ${ACC.supplierRefundReceivable} บันทึกรับเงินคืนเมื่อได้รับ`
    );
  }

  const entry = postPurchaseCreditNote(doc, { id: journalId, docNo: j.docNo }, contactDisplayName(contact), purchase.docNo);
  const updated: PurchaseDoc = { ...purchase, paid: toSatang(purchaseOutstanding(withCredit, purchase)) <= 0 };
  return {
    state: {
      ...withCredit,
      purchases: state.purchases.map((p) => (p.id === purchase.id ? updated : p)),
      journal: [...state.journal, entry],
      sequences: j.sequences,
    },
    doc,
    warnings,
  };
}

const purchaseCreditsOfState = (state: AccountingData, purchaseId: string) => state.purchaseCredits.filter((c) => c.purchaseId === purchaseId);

export type SupplierRefundInput = {
  contactId: string;
  date: string;
  amount: number;
  /** บัญชีเงินสด/ธนาคารที่รับเงิน */
  accountCode: string;
  note?: string;
};

/**
 * D1 — รับเงินคืนจากผู้ขาย (ใบลดหนี้หลังจ่ายเงินแล้ว): Dr เงินสด/ธนาคาร / Cr ลูกหนี้-เงินคืนจากผู้ขาย 1150 — เลขที่ SR เรียงตามวันที่
 * รับได้ไม่เกินยอดคงค้าง ณ วันที่รับ (เฉพาะใบลดหนี้ที่ลงวันที่ไม่เกินวันนั้น — วันที่รับต้องไม่ก่อนวันที่ใบลดหนี้)
 */
export function receiveSupplierRefund(state: AccountingData, input: SupplierRefundInput): { state: AccountingData; refund: SupplierRefund } {
  const contact = contactOf(state, input.contactId);
  assertPostingDate(state, input.date, 'วันที่รับเงินคืน');
  if (!Number.isFinite(input.amount) || !(toSatang(input.amount) > 0)) throw new BusinessRuleError('ยอดรับเงินคืนต้องมากกว่า 0');
  const n = takeNumber(state, DOC_PREFIX.supplierRefund, input.date);
  const available = supplierRefundDueOf(state, contact.id, input.date);
  if (toSatang(input.amount) > toSatang(available)) {
    const total = supplierRefundDueOf(state, contact.id);
    throw new BusinessRuleError(
      toSatang(total) > toSatang(available)
        ? `ยอดรับคืนเกินยอดเงินคืนจากผู้ขาย ณ วันที่ ${formatThaiDate(input.date)} (รับได้ ${Math.max(0, available).toFixed(2)} บาท — ใบลดหนี้บางใบลงวันที่หลังวันรับเงิน)`
        : `ยอดรับคืนเกินยอดเงินคืนจากผู้ขาย (รับได้ ${Math.max(0, available).toFixed(2)} บาท)`
    );
  }
  assertCashAccount(state, input.accountCode);
  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();
  const refund: SupplierRefund = {
    id: uid(),
    docNo: n.docNo,
    date: input.date,
    contactId: contact.id,
    amount: round2(input.amount),
    accountCode: input.accountCode,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    supplier: partySnapshot(contact),
    journalId,
    createdAt: new Date().toISOString(),
  };
  const entry = postSupplierRefund(refund, { id: journalId, docNo: j.docNo }, contactDisplayName(contact));
  return {
    state: {
      ...state,
      supplierRefunds: [...(state.supplierRefunds ?? []), refund],
      journal: [...state.journal, entry],
      sequences: j.sequences,
    },
    refund,
  };
}

// ---------------- ปิดบัญชีสิ้นปี (B5) ----------------

/**
 * ปิดบัญชีสิ้นปี: โอนยอดรายได้/ค่าใช้จ่ายสะสมถึง `fiscalYearEnd` เข้า 3200 กำไรสะสม (ลงวันสิ้นปี)
 * ต้องปิดงวดถึงวันสิ้นปีก่อน (ไม่มีรายการเข้าปีนั้นได้อีก) — เรียกซ้ำปีเดิมได้ผลเดิม (`already: true`, ไม่ลงซ้ำ)
 * ปีถัดไปต้องต่อจากปีที่ปิดล่าสุด 12 เดือนพอดี
 */
export function closeYear(
  state: AccountingData,
  fiscalYearEnd: string
): { state: AccountingData; close: YearClose; already: boolean } {
  const existing = state.yearCloses.find((c) => c.fiscalYearEnd === fiscalYearEnd);
  if (existing) return { state, close: existing, already: true };
  const problem = yearCloseProblem(state, fiscalYearEnd);
  if (problem) throw new BusinessRuleError(problem);
  const { balances, netProfit } = yearCloseBalances(state, fiscalYearEnd);
  const id = uid();
  // JV ไม่บังคับเรียงตามวันที่ (เหมือนปิดภาษีเดือน) — รายการปิดบัญชีลงวันสิ้นปีที่ปิดงวดแล้ว
  const j = nextDocNo(state.sequences, DOC_PREFIX.journal, fiscalYearEnd);
  const entry = postYearClose({ id, fiscalYearEnd }, balances, { id: uid(), docNo: j.docNo });
  const close: YearClose = { id, fiscalYearEnd, netProfit, ...(entry ? { journalId: entry.id } : {}) };
  return {
    state: {
      ...state,
      yearCloses: [...sortedYearCloses(state), close],
      journal: entry ? [...state.journal, entry] : state.journal,
      sequences: entry ? { ...state.sequences, [j.key]: j.value } : state.sequences,
    },
    close,
    already: false,
  };
}

// ---------------- ยอดยกมาจากระบบเดิม (B5) ----------------

export type OpeningReceivableInput = {
  contactId: string;
  /** เลขที่ใบกำกับ/ใบแจ้งหนี้ในระบบเดิม (ห้ามรูปแบบเลขที่ของระบบนี้ เช่น IV6910-0001) */
  docNo: string;
  date: string;
  dueDate: string;
  /** ยอดค้างรับ (รวม VAT) */
  amount: number;
  /**
   * U2 — ใบแจ้งหนี้งานบริการ (ม.78/1) ที่ภาษีขายยังไม่ถึงกำหนด: VAT ที่รวมอยู่ในยอดค้าง (ยังไม่ได้ยื่นในระบบเดิม)
   * ยกมาเป็น 2151 รับเงินแล้วออกใบเสร็จรับเงิน/ใบกำกับภาษี (RT) และย้าย VAT เข้า 2150 ในเดือนที่รับเงิน
   * ไม่ส่ง/0 = ใบค้างรับธรรมดา (ภาษีขายยื่นในระบบเดิมแล้ว รับเงินออกใบเสร็จ RE)
   */
  serviceVat?: number;
};

export type OpeningPayableInput = {
  contactId: string;
  /** เลขที่ใบกำกับของผู้ขาย */
  docNo: string;
  date: string;
  /** ยอดค้างจ่าย (รวม VAT) */
  amount: number;
  /** VAT ที่รวมอยู่ในยอดค้าง (ภาษีซื้อใช้สิทธิในระบบเดิมแล้ว) — ใช้แยกฐานหัก ณ ที่จ่าย */
  vatAmount?: number;
  /** หัก ณ ที่จ่ายเมื่อจ่าย (เช่น ค่าบริการ 3%) — ฐาน = ยอด − VAT */
  whtIncomeType?: string;
  whtRate?: number;
};

export type OpeningBalanceInput = {
  /** ยอดยกมา ณ สิ้นวันนี้ */
  date: string;
  /** ยอดคงเหลือบัญชีอื่นตามงบทดลองของระบบเดิม (ห้ามบัญชีคุม) */
  lines: JournalLine[];
  vatCredit: number;
  whtReceivable: number;
  /** ยอดลูกหนี้/เจ้าหนี้การค้าตามงบทดลองของระบบเดิม — ต้องเท่ากับผลรวมรายการค้าง */
  receivableControl: number;
  payableControl: number;
  receivables: OpeningReceivableInput[];
  payables: OpeningPayableInput[];
};

/**
 * ใบค้างรับงานบริการยกมา: VAT ที่ยังไม่ถึงกำหนดต้องเท่ากับ VAT ตามอัตราของมูลค่า (คิดแยก หรือรวมในยอด) —
 * คืนวิธีคิด VAT ที่ให้ VAT ตรงกับที่กรอก หรือ null ถ้าไม่ตรง (ต่างกันเกินเศษปัด)
 */
export function openingServiceVatMode(amount: number, serviceVat: number): { vatMode: VatMode; unitPrice: number } | null {
  const net = subBaht(amount, serviceVat);
  const exclusive = calcDocument({ lines: [{ qty: 1, unitPrice: net, discount: 0, accountCode: ACC.service }], vatMode: 'exclusive', vatRate: VAT_RATE });
  if (toSatang(exclusive.vat) === toSatang(serviceVat) && toSatang(exclusive.total) === toSatang(amount)) return { vatMode: 'exclusive', unitPrice: net };
  const inclusive = calcDocument({ lines: [{ qty: 1, unitPrice: round2(amount), discount: 0, accountCode: ACC.service }], vatMode: 'inclusive', vatRate: VAT_RATE });
  if (toSatang(inclusive.vat) === toSatang(serviceVat)) return { vatMode: 'inclusive', unitPrice: round2(amount) };
  return null;
}

/** บัญชีที่กรอกในยอดยกมาผ่านช่องเฉพาะ (ลูกหนี้/เจ้าหนี้จากรายการค้าง, 1180, 1160) */
const OPENING_FIELD_ACCOUNTS: readonly string[] = [ACC.receivable, ACC.payable, ACC.vatCredit, ACC.whtReceivable];

function assertAmount(value: number, label: string, positive = false) {
  if (!Number.isFinite(value) || value < 0 || (positive && !(toSatang(value) > 0))) {
    throw new BusinessRuleError(`${label}${positive ? 'ต้องมากกว่า 0' : 'ติดลบไม่ได้'}`);
  }
}

/**
 * บันทึกยอดยกมาจากระบบเดิม (เช่น Express) — ทำได้ก่อนมีรายการอื่นเท่านั้น (แก้ไขซ้ำได้จนกว่าจะมีรายการแรก)
 * - บรรทัดบัญชีแยกประเภท (ไม่รวมบัญชีคุม) + ลูกหนี้/เจ้าหนี้จากรายการค้างทีละใบ + ภาษีชำระเกินยกมา + ภาษีถูกหัก ณ ที่จ่าย ต้องสมดุล
 * - ผลรวมใบค้างรับ/ค้างจ่ายต้องเท่ากับยอดลูกหนี้/เจ้าหนี้ตามงบทดลองของระบบเดิม (กระทบยอดบัญชีคุม)
 * - ใบค้างเป็นเอกสาร `opening: true` ใช้รับชำระ (RE) / จ่ายชำระ (PV + 50 ทวิ) ได้ตามปกติ ไม่เข้ารายงานภาษี
 * - หลังบันทึก รายการใหม่ทุกประเภทต้องลงวันที่หลังวันยอดยกมา
 */
export function setOpeningBalances(state: AccountingData, input: OpeningBalanceInput) {
  assertISODate(input.date, 'วันที่ยอดยกมา');
  // D4: ยกยอด ณ สิ้นเดือนเท่านั้น — เดือนถัดไปเริ่มในระบบนี้ทั้งเดือน (ภาษีขาย/ซื้อของเดือนยกยอดยื่นในระบบเดิม)
  // ข้อมูลเดิมที่ยกยอดกลางเดือนไว้แล้วยังใช้ได้ (ไม่ตรวจย้อนหลังใน validateAccountingData)
  if (endOfMonth(monthKeyOf(input.date)) !== input.date) {
    throw new BusinessRuleError(
      `วันที่ยอดยกมาต้องเป็นวันสิ้นเดือน (เช่น ${formatThaiDate(endOfMonth(monthKeyOf(input.date)))}) — ภาษีของเดือนยกยอดยื่นในระบบเดิมทั้งเดือน`
    );
  }
  assertOpenPeriod(state, input.date);
  const prior = state.openingBalance;
  const blocked = openingBlockedReason(state);
  if (blocked) throw new BusinessRuleError(blocked);

  const accounts = new Map(state.accounts.map((a) => [a.code, a]));
  const lines = input.lines.filter((l) => toSatang(l.debit) !== 0 || toSatang(l.credit) !== 0);
  lines.forEach((l, i) => {
    const no = `บรรทัดที่ ${i + 1}`;
    const account = accounts.get(l.accountCode);
    if (!account) throw new BusinessRuleError(`${no}: ไม่พบบัญชี ${l.accountCode}`);
    if (isControlAccount(l.accountCode) || OPENING_FIELD_ACCOUNTS.includes(l.accountCode)) {
      throw new BusinessRuleError(
        `${no}: ${account.code} ${account.name} เป็นบัญชีคุม — ลูกหนี้/เจ้าหนี้กรอกเป็นรายการค้างทีละใบ ภาษีชำระเกิน/ภาษีถูกหักกรอกในช่องเฉพาะ`
      );
    }
    assertAmount(l.debit, `${no}: เดบิต`);
    assertAmount(l.credit, `${no}: เครดิต`);
  });
  assertAmount(input.vatCredit, 'ภาษีชำระเกินยกมา');
  assertAmount(input.whtReceivable, 'ภาษีถูกหัก ณ ที่จ่ายยกมา');

  const seen = new Set<string>();
  const uniqueKey = (side: string, contactId: string, docNo: string) => {
    const key = `${side}|${contactId}|${normalizeDocNo(docNo)}`;
    if (seen.has(key)) throw new BusinessRuleError(`เลขที่ ${docNo} ของผู้ติดต่อเดียวกันซ้ำในรายการค้าง`);
    seen.add(key);
  };
  const checkItem = (item: { contactId: string; docNo: string; date: string; amount: number }, side: 'ar' | 'ap', i: number) => {
    const no = `${side === 'ar' ? 'ลูกหนี้' : 'เจ้าหนี้'}รายการที่ ${i + 1}`;
    const contact = contactOf(state, item.contactId);
    if (side === 'ar' && contact.kind === 'vendor') throw new BusinessRuleError(`${no}: ${contactDisplayName(contact)} เป็นผู้ขายเท่านั้น`);
    if (side === 'ap' && contact.kind === 'customer') throw new BusinessRuleError(`${no}: ${contactDisplayName(contact)} เป็นลูกค้าเท่านั้น`);
    if (!item.docNo.trim()) throw new BusinessRuleError(`${no}: ระบุเลขที่เอกสารในระบบเดิม`);
    // U12: เลขที่รูปแบบเดียวกับระบบนี้ (PREFIX + งวด + ลำดับ) จะชนกับเลขที่ที่ระบบออกภายหลัง
    if (parseDocNo(item.docNo.trim().toUpperCase())) {
      throw new BusinessRuleError(
        `${no}: เลขที่ ${item.docNo.trim()} ซ้ำรูปแบบเลขที่ของระบบนี้ (เช่น IV6910-0001) — เติมคำนำหน้า เช่น EX-${item.docNo.trim()}`
      );
    }
    assertISODate(item.date, `${no}: วันที่เอกสาร`);
    if (item.date > input.date) throw new BusinessRuleError(`${no}: วันที่เอกสารต้องไม่หลังวันยอดยกมา`);
    assertAmount(item.amount, `${no}: ยอดค้าง`, true);
    uniqueKey(side, item.contactId, item.docNo);
    return contact;
  };

  const sumOf = (items: { amount: number }[]) => sumBaht(items.map((x) => round2(x.amount)));
  const receivable = sumOf(input.receivables);
  const payable = sumOf(input.payables);
  if (toSatang(receivable) !== toSatang(input.receivableControl)) {
    throw new BusinessRuleError(
      `ลูกหนี้คงค้างรวม ${receivable.toFixed(2)} ไม่เท่ากับยอดลูกหนี้การค้าตามงบทดลองเดิม ${round2(input.receivableControl).toFixed(2)} (ต่าง ${subBaht(input.receivableControl, receivable).toFixed(2)})`
    );
  }
  if (toSatang(payable) !== toSatang(input.payableControl)) {
    throw new BusinessRuleError(
      `เจ้าหนี้คงค้างรวม ${payable.toFixed(2)} ไม่เท่ากับยอดเจ้าหนี้การค้าตามงบทดลองเดิม ${round2(input.payableControl).toFixed(2)} (ต่าง ${subBaht(input.payableControl, payable).toFixed(2)})`
    );
  }

  const journalId = prior?.journalId ?? uid();
  const seller = companySnapshot(state.company);
  const createdAt = new Date().toISOString();
  const sales: SalesDoc[] = input.receivables.map((item, i) => {
    const contact = checkItem(item, 'ar', i);
    assertISODate(item.dueDate, `ลูกหนี้รายการที่ ${i + 1}: วันครบกำหนด`);
    if (item.dueDate < item.date) throw new BusinessRuleError(`ลูกหนี้รายการที่ ${i + 1}: วันครบกำหนดต้องไม่ก่อนวันที่เอกสาร`);
    const docNo = item.docNo.trim();
    const serviceVat = round2(item.serviceVat ?? 0);
    assertAmount(serviceVat, `ลูกหนี้รายการที่ ${i + 1}: ภาษีขายยังไม่ถึงกำหนด`);
    let service: { vatMode: VatMode; unitPrice: number } | null = null;
    if (toSatang(serviceVat) > 0) {
      if (!state.company.vatRegistered) throw new BusinessRuleError(`ลูกหนี้รายการที่ ${i + 1}: บริษัทไม่จด VAT — ไม่มีภาษีขายยังไม่ถึงกำหนด`);
      service = openingServiceVatMode(item.amount, serviceVat);
      if (!service) {
        const expected = calcDocument({ lines: [{ qty: 1, unitPrice: round2(item.amount), discount: 0, accountCode: ACC.service }], vatMode: 'inclusive', vatRate: VAT_RATE }).vat;
        throw new BusinessRuleError(
          `ลูกหนี้รายการที่ ${i + 1}: ภาษีขายยังไม่ถึงกำหนด ${serviceVat.toFixed(2)} ไม่ตรงกับ VAT ${VAT_RATE}% ของยอดค้าง (ควรเป็น ${expected.toFixed(2)})`
        );
      }
    }
    return {
      id: uid(),
      kind: 'tax-invoice',
      isTaxInvoice: false,
      ...(service ? { saleType: 'service' as const } : {}),
      opening: true,
      docNo,
      date: item.date,
      dueDate: item.dueDate,
      contactId: contact.id,
      lines: [
        {
          id: uid(),
          description: `ยอดยกมา ${docNo}${service ? ' (งานบริการ ภาษีขายยังไม่ถึงกำหนด)' : ''}`,
          qty: 1,
          unitPrice: service ? service.unitPrice : round2(item.amount),
          discount: 0,
          accountCode: service ? ACC.service : ACC.sales,
        },
      ],
      vatMode: service ? service.vatMode : 'none',
      vatRate: service ? VAT_RATE : 0,
      status: 'issued',
      paidAmount: 0,
      etax: 'not-required',
      seller,
      buyer: partySnapshot(contact),
      journalId,
      createdAt,
    };
  });
  const purchases: PurchaseDoc[] = input.payables.map((item, i) => {
    const no = `เจ้าหนี้รายการที่ ${i + 1}`;
    const contact = checkItem(item, 'ap', i);
    const vatAmount = round2(item.vatAmount ?? 0);
    assertAmount(vatAmount, `${no}: VAT ที่รวมอยู่`);
    if (toSatang(vatAmount) >= toSatang(item.amount)) throw new BusinessRuleError(`${no}: VAT ต้องน้อยกว่ายอดค้าง`);
    const whtRate = item.whtRate ?? 0;
    if (!Number.isFinite(whtRate) || whtRate < 0 || whtRate > PURCHASE_WHT_MAX_RATE) {
      throw new BusinessRuleError(`${no}: อัตราหัก ณ ที่จ่ายต้องอยู่ระหว่าง 0–${PURCHASE_WHT_MAX_RATE}%`);
    }
    const whtIncomeType = whtRate > 0 ? (item.whtIncomeType ?? '').trim() : '';
    if (whtRate > 0 && !whtIncomeType) throw new BusinessRuleError(`${no}: หัก ณ ที่จ่ายต้องระบุประเภทเงินได้`);
    const docNo = item.docNo.trim();
    const line = (description: string, amount: number, wht: boolean): PurchaseLine => ({
      id: uid(),
      description,
      qty: 1,
      unitPrice: amount,
      discount: 0,
      accountCode: ACC.misc,
      whtIncomeType: wht ? whtIncomeType : '',
      whtRate: wht ? whtRate : 0,
    });
    return {
      id: uid(),
      docNo,
      opening: true,
      supplierInvoiceNo: docNo,
      supplierInvoiceDate: item.date,
      date: item.date,
      contactId: contact.id,
      lines: [
        line(`ยอดยกมา ${docNo}`, subBaht(item.amount, vatAmount), true),
        ...(toSatang(vatAmount) > 0 ? [line(`ภาษีมูลค่าเพิ่ม (ใช้สิทธิในระบบเดิมแล้ว) ${docNo}`, vatAmount, false)] : []),
      ],
      vatMode: 'none',
      vatRate: 0,
      claimVat: false,
      whtCondition: '1',
      paid: false,
      supplier: partySnapshot(contact),
      journalId,
      createdAt,
    };
  });

  const opening: OpeningBalance = {
    date: input.date,
    journalId,
    lines: lines.map((l) => ({ accountCode: l.accountCode, description: l.description, debit: round2(l.debit), credit: round2(l.credit) })),
    vatCredit: round2(input.vatCredit),
    whtReceivable: round2(input.whtReceivable),
  };

  // แทนยอดยกมาเดิม (ยังไม่มีรายการอื่น): คืนเลข JV ของรายการเดิมก่อนออกใหม่
  let sequences = { ...state.sequences };
  const priorEntry = prior ? state.journal.find((e) => e.id === prior.journalId) : undefined;
  if (priorEntry) {
    const parsed = parseDocNo(priorEntry.docNo);
    if (parsed) {
      const key = `${parsed.prefix}${parsed.period}`;
      const value = (sequences[key] ?? 1) - 1;
      if (value > 0) sequences[key] = value;
      else delete sequences[key];
    }
  }
  const j = nextDocNo(sequences, DOC_PREFIX.journal, input.date);
  sequences = { ...sequences, [j.key]: j.value };
  const deferredVat = sumBaht(sales.filter((x) => x.saleType === 'service').map((x) => calcDocument(x).vat));
  let entry: JournalEntry;
  try {
    entry = postOpeningBalance(opening, { receivable, payable, deferredVat }, { id: journalId, docNo: j.docNo });
  } catch (error) {
    if (error instanceof UnbalancedEntryError) {
      throw new BusinessRuleError(
        `ยอดยกมาไม่สมดุล: เดบิต ${error.debit.toFixed(2)} ≠ เครดิต ${error.credit.toFixed(2)} (ต่าง ${subBaht(error.debit, error.credit).toFixed(2)}) — ตรวจกับงบทดลองของระบบเดิม`
      );
    }
    throw error;
  }
  if (!entry.lines.length) throw new BusinessRuleError('ยังไม่มียอดยกมา');

  return {
    state: {
      ...state,
      openingBalance: opening,
      sales: [...state.sales.filter((s) => !s.opening), ...sales],
      purchases: [...state.purchases.filter((p) => !p.opening), ...purchases],
      journal: [...state.journal.filter((e) => e.id !== journalId), entry],
      sequences,
    },
    opening,
  };
}

/** @deprecated ใช้ `cashAccountsOf(data)` — บัญชีเงินสด/ธนาคารทั้งหมดในผังบัญชี (รวมบัญชีธนาคารที่เพิ่มเอง) */
export const DEPOSIT_ACCOUNTS = [ACC.bank, ACC.cash];

// ---------------- ธนาคาร / เงินสดย่อย (B9) ----------------

export type BankAccountInput = {
  kind: BankAccountKind;
  bankName: string;
  accountNo: string;
  branch?: string;
  /** ชื่อบัญชีในผังบัญชี (ไม่ส่ง = ตั้งจากชื่อธนาคาร/เลขที่บัญชี) */
  accountName?: string;
};

/**
 * เพิ่มบัญชีธนาคาร (บัญชีแยกประเภท 1121–1129) หรือเงินสดย่อย (1112–1119) พร้อมลงทะเบียน
 * เลขที่บัญชีธนาคารเดียวกันซ้ำไม่ได้
 */
export function addBankAccount(state: AccountingData, input: BankAccountInput): { state: AccountingData; bank: BankAccount } {
  const bankName = input.bankName.trim();
  const accountNo = input.accountNo.trim();
  if (input.kind === 'bank' && (!bankName || !accountNo)) throw new BusinessRuleError('ระบุชื่อธนาคารและเลขที่บัญชี');
  if (input.kind === 'petty-cash' && !bankName) throw new BusinessRuleError('ระบุชื่อผู้ถือเงินสดย่อย / แผนก');
  const norm = (v: string) => v.replace(/[\s-]/g, '');
  const dup = state.bankAccounts.find((b) => b.kind === 'bank' && input.kind === 'bank' && b.bankName === bankName && norm(b.accountNo) === norm(accountNo));
  if (dup) throw new BusinessRuleError(`${bankName} เลขที่ ${accountNo} ลงทะเบียนแล้ว (บัญชี ${dup.accountCode})`);
  const code = nextBankAccountCode(state.accounts, input.kind);
  if (!code) throw new BusinessRuleError(`เพิ่ม${input.kind === 'bank' ? 'บัญชีธนาคาร' : 'เงินสดย่อย'}ได้ไม่เกิน 9 บัญชี`);
  const name =
    input.accountName?.trim() || (input.kind === 'bank' ? `เงินฝากธนาคาร ${bankName} ${accountNo}` : `เงินสดย่อย ${bankName}`);
  const bank: BankAccount = { accountCode: code, kind: input.kind, bankName, accountNo, ...(input.branch?.trim() ? { branch: input.branch.trim() } : {}) };
  return {
    state: {
      ...state,
      accounts: [...state.accounts, { code, name, nameEn: input.kind === 'bank' ? 'Bank deposit' : 'Petty cash', type: 'asset' }],
      bankAccounts: [...state.bankAccounts, bank],
    },
    bank,
  };
}

/** แก้ข้อมูลประกอบของบัญชีธนาคาร (ชื่อธนาคาร เลขที่ สาขา วันเริ่มกระทบยอด) — ไม่กระทบรายการบัญชี */
export function updateBankAccount(
  state: AccountingData,
  accountCode: string,
  patch: Partial<Pick<BankAccount, 'bankName' | 'accountNo' | 'branch' | 'reconcileFrom'>>
): AccountingData {
  const current = bankAccountOf(state, accountCode);
  if (!current) throw new BusinessRuleError(`ไม่พบบัญชี ${accountCode} ในทะเบียนธนาคาร`);
  if (patch.reconcileFrom !== undefined && patch.reconcileFrom !== '' && !isISODate(patch.reconcileFrom)) {
    throw new BusinessRuleError('วันที่เริ่มกระทบยอดไม่ถูกต้อง');
  }
  const next: BankAccount = { ...current };
  if (patch.bankName !== undefined) next.bankName = patch.bankName.trim();
  if (patch.accountNo !== undefined) next.accountNo = patch.accountNo.trim();
  if (patch.branch !== undefined) {
    if (patch.branch.trim()) next.branch = patch.branch.trim();
    else delete next.branch;
  }
  if (patch.reconcileFrom !== undefined) {
    if (patch.reconcileFrom) next.reconcileFrom = patch.reconcileFrom;
    else delete next.reconcileFrom;
  }
  return { ...state, bankAccounts: state.bankAccounts.map((b) => (b.accountCode === accountCode ? next : b)) };
}

export type TransferInput = {
  date: string;
  fromAccountCode: string;
  toAccountCode: string;
  amount: number;
  note?: string;
};

/**
 * โอนเงินระหว่างบัญชีเงินสด/ธนาคารของบริษัท (รวมเบิกชดเชยเงินสดย่อยจากธนาคาร) — เลขที่ TR + รายการบัญชี JV
 * Dr ปลายทาง / Cr ต้นทาง, เงินสดย่อยต้นทางต้องมียอดพอ
 */
export function transferFunds(state: AccountingData, input: TransferInput): { state: AccountingData; transfer: BankTransfer } {
  assertPostingDate(state, input.date, 'วันที่โอน');
  if (!Number.isFinite(input.amount) || !(toSatang(input.amount) > 0)) throw new BusinessRuleError('ยอดโอนต้องมากกว่า 0');
  assertCashAccount(state, input.fromAccountCode);
  assertCashAccount(state, input.toAccountCode);
  if (input.fromAccountCode === input.toAccountCode) throw new BusinessRuleError('บัญชีต้นทางและปลายทางต้องต่างกัน');
  const amount = round2(input.amount);
  assertPettyCashAvailable(state, input.fromAccountCode, input.date, amount);
  const n = takeNumber(state, DOC_PREFIX.transfer, input.date);
  const j = takeNumber({ ...state, sequences: n.sequences }, DOC_PREFIX.journal, input.date);
  const journalId = uid();
  const transfer: BankTransfer = {
    id: uid(),
    docNo: n.docNo,
    date: input.date,
    fromAccountCode: input.fromAccountCode,
    toAccountCode: input.toAccountCode,
    amount,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    journalId,
    createdAt: new Date().toISOString(),
  };
  const entry = postBankTransfer(transfer, { id: journalId, docNo: j.docNo }, transferTitle(transfer, state));
  return {
    state: { ...state, transfers: [...state.transfers, transfer], journal: [...state.journal, entry], sequences: j.sequences },
    transfer,
  };
}

/** รหัสผู้ติดต่อของผู้รับเงินทั่วไปของเงินสดย่อย (ค่าใช้จ่ายที่ไม่ขอคืนภาษีซื้อและไม่ระบุผู้ขาย) */
export const PETTY_CASH_PAYEE_CODE = 'PETTY';

export type PettyCashExpenseInput = {
  pettyAccountCode: string;
  date: string;
  /** ผู้ขาย — บังคับเมื่อขอคืนภาษีซื้อ (ต้องมีเลขผู้เสียภาษี/สาขา) ไม่ส่ง = ผู้รับเงินทั่วไป */
  contactId?: string;
  lines: { id?: string; description: string; accountCode: string; amount: number }[];
  vatMode: VatMode;
  claimVat: boolean;
  supplierInvoiceNo?: string;
  supplierInvoiceDate?: string;
  vatClaimPeriod?: string;
  note?: string;
};

/**
 * ใบสำคัญจ่ายเงินสดย่อย — บันทึกเป็นเอกสารซื้อ (PI) ที่จ่ายทันทีจากบัญชีเงินสดย่อย (PV) จึงใช้กติกาภาษีซื้อชุดเดียวกัน
 * (ม.82/3 วันที่ใบกำกับ/เดือนใช้สิทธิ, ม.82/5 เลขผู้เสียภาษีผู้ขาย, กันเลขใบกำกับซ้ำ) ไม่มีหัก ณ ที่จ่าย
 * ยอดเงินสดย่อยต้องพอจ่าย
 */
export function recordPettyCashExpense(state: AccountingData, input: PettyCashExpenseInput) {
  const bank = bankAccountOf(state, input.pettyAccountCode);
  if (!bank || bank.kind !== 'petty-cash') throw new BusinessRuleError(`บัญชี ${input.pettyAccountCode} ไม่ใช่เงินสดย่อย`);
  if (!input.lines.length) throw new BusinessRuleError('ต้องมีอย่างน้อย 1 รายการ');
  input.lines.forEach((l, i) => {
    if (!Number.isFinite(l.amount) || !(toSatang(l.amount) > 0)) throw new BusinessRuleError(`รายการที่ ${i + 1}: จำนวนเงินต้องมากกว่า 0`);
  });
  const claimVat = state.company.vatRegistered && input.vatMode !== 'none' && input.claimVat;
  let next = state;
  let {contactId} = input;
  if (claimVat) {
    if (!contactId) throw new BusinessRuleError('ขอคืนภาษีซื้อต้องเลือกผู้ขาย (มีเลขผู้เสียภาษีและสาขา)');
    const problem = supplierVatClaimProblem(partySnapshot(contactOf(state, contactId)));
    if (problem) throw new BusinessRuleError(`${problem} — ขอคืนภาษีซื้อไม่ได้ (ม.82/5)`);
  }
  if (!contactId) {
    const payee = state.contacts.find((c) => c.code === PETTY_CASH_PAYEE_CODE);
    if (payee) contactId = payee.id;
    else {
      const created = saveContact(state, {
        code: PETTY_CASH_PAYEE_CODE,
        kind: 'vendor',
        legalForm: 'juristic',
        title: '',
        name: 'ผู้รับเงินทั่วไป (เงินสดย่อย)',
        address: {},
        creditDays: 0,
      });
      next = created.state;
      contactId = created.contact.id;
    }
  }
  return recordPurchase(next, {
    supplierInvoiceNo: input.supplierInvoiceNo ?? '',
    supplierInvoiceDate: input.supplierInvoiceDate,
    vatClaimPeriod: input.vatClaimPeriod,
    date: input.date,
    contactId,
    vatMode: input.vatMode,
    claimVat,
    whtCondition: '1',
    note: input.note?.trim() || `เงินสดย่อย ${bank.bankName}`.trim(),
    lines: input.lines.map((l) => ({
      id: l.id ?? uid(),
      description: l.description,
      qty: 1,
      unitPrice: round2(l.amount),
      discount: 0,
      accountCode: l.accountCode,
      whtIncomeType: '',
      whtRate: 0,
    })),
    payNow: { date: input.date, accountCode: input.pettyAccountCode },
  });
}

// ---------------- กระทบยอดธนาคาร ----------------

export type StatementLineInput = { date: string; description: string; amount: number; balance?: number };

const statementKey = (l: { date: string; amount: number; description: string }) =>
  `${l.date}|${toSatang(l.amount)}|${l.description.trim()}`;

/**
 * เพิ่มรายการ statement (นำเข้า CSV / คีย์เอง) — รายการที่มีอยู่แล้ว (วันที่ + ยอด + คำอธิบายเดียวกัน) ถูกข้าม
 * จึงนำเข้าไฟล์เดิมซ้ำได้โดยไม่เกิดรายการซ้ำ
 */
export function addBankStatementLines(
  state: AccountingData,
  input: { accountCode: string; lines: StatementLineInput[]; imported?: boolean }
): { state: AccountingData; added: number; skipped: number } {
  const bank = bankAccountOf(state, input.accountCode);
  if (!bank || bank.kind !== 'bank') throw new BusinessRuleError(`บัญชี ${input.accountCode} ไม่ใช่บัญชีธนาคารที่ลงทะเบียน`);
  if (!input.lines.length) throw new BusinessRuleError('ไม่มีรายการ statement');
  const existing = new Map<string, number>();
  state.bankStatements
    .filter((l) => l.accountCode === input.accountCode)
    .forEach((l) => existing.set(statementKey(l), (existing.get(statementKey(l)) ?? 0) + 1));
  const batchId = input.imported ? uid() : undefined;
  const createdAt = new Date().toISOString();
  const fresh: BankStatementLine[] = [];
  let skipped = 0;
  input.lines.forEach((l, i) => {
    const no = `แถวที่ ${i + 1}`;
    assertISODate(l.date, `${no}: วันที่`);
    if (!Number.isFinite(l.amount) || toSatang(l.amount) === 0) throw new BusinessRuleError(`${no}: จำนวนเงินต้องไม่เป็นศูนย์`);
    if (l.balance !== undefined && !Number.isFinite(l.balance)) throw new BusinessRuleError(`${no}: ยอดคงเหลือไม่ถูกต้อง`);
    const key = statementKey(l);
    const seen = existing.get(key) ?? 0;
    if (seen > 0) {
      existing.set(key, seen - 1);
      skipped += 1;
      return;
    }
    fresh.push({
      id: uid(),
      accountCode: input.accountCode,
      date: l.date,
      description: l.description.trim(),
      amount: round2(l.amount),
      ...(l.balance !== undefined ? { balance: round2(l.balance) } : {}),
      ...(batchId ? { batchId } : {}),
      createdAt,
    });
  });
  return { state: { ...state, bankStatements: [...state.bankStatements, ...fresh] }, added: fresh.length, skipped };
}

/** ลบรายการ statement ที่ยังไม่ได้จับคู่ (นำเข้าผิดไฟล์/คีย์ผิด) */
export function deleteBankStatementLines(state: AccountingData, ids: string[]): AccountingData {
  const set = new Set(ids);
  const matched = state.bankMatches.some((m) => m.statementLineIds.some((id) => set.has(id)));
  if (matched) throw new BusinessRuleError('รายการที่จับคู่แล้วลบไม่ได้ — ยกเลิกการจับคู่ก่อน');
  return { ...state, bankStatements: state.bankStatements.filter((l) => !set.has(l.id)) };
}

/** จับคู่ด้วยมือ: statement ≥ 1 กับรายการในสมุด ≥ 1 ยอดรวมเท่ากัน (ไม่ลงบัญชี) */
export function matchBankItems(
  state: AccountingData,
  input: { accountCode: string; statementLineIds: string[]; journalIds: string[] },
  auto = false
): { state: AccountingData; match: BankMatch } {
  const problem = bankMatchProblem(state, input);
  if (problem) throw new BusinessRuleError(problem);
  const match: BankMatch = {
    id: uid(),
    accountCode: input.accountCode,
    statementLineIds: input.statementLineIds.slice(),
    journalIds: input.journalIds.slice(),
    auto,
    matchedAt: new Date().toISOString(),
  };
  return { state: { ...state, bankMatches: [...state.bankMatches, match] }, match };
}

/** จับคู่อัตโนมัติ (ยอดเท่ากัน + วันที่ห่างไม่เกิน `windowDays`) เฉพาะรายการที่ยังไม่จับคู่ */
export function autoMatchBank(state: AccountingData, accountCode: string, windowDays = 3): { state: AccountingData; matched: number } {
  const bank = bankAccountOf(state, accountCode);
  if (!bank || bank.kind !== 'bank') throw new BusinessRuleError(`บัญชี ${accountCode} ไม่ใช่บัญชีธนาคารที่ลงทะเบียน`);
  const { lines, movements } = unmatchedItems(state, accountCode);
  const from = bank.reconcileFrom;
  const proposals = autoMatchProposals(lines, movements.filter((m) => !from || m.date >= from), windowDays);
  const matchedAt = new Date().toISOString();
  const matches: BankMatch[] = proposals.map((p) => ({
    id: uid(),
    accountCode,
    statementLineIds: [p.statementLineId],
    journalIds: [p.journalId],
    auto: true,
    matchedAt,
  }));
  return { state: { ...state, bankMatches: [...state.bankMatches, ...matches] }, matched: matches.length };
}

export function unmatchBank(state: AccountingData, matchId: string): AccountingData {
  if (!state.bankMatches.some((m) => m.id === matchId)) throw new BusinessRuleError('ไม่พบการจับคู่');
  return { ...state, bankMatches: state.bankMatches.filter((m) => m.id !== matchId) };
}

// ---------------- ใบเสนอราคา ----------------

export type QuotationInput = {
  /** ไม่ส่ง = สร้างใหม่ */
  id?: string;
  date: string;
  validDays: number;
  contactId: string;
  lines: DocLine[];
  vatMode: VatMode;
  saleType?: SaleType;
  note?: string;
};

/**
 * สร้าง/แก้ใบเสนอราคา (QT) — ไม่ลงบัญชี ไม่ตรวจงวดที่ปิด
 * ข้อยกเว้นของกติกา "เอกสารที่ออกแล้วแก้ไม่ได้": ใบเสนอราคาไม่ใช่เอกสารภาษีและไม่มีผลทางบัญชี จึงแก้ได้
 * จนกว่าจะแปลงเป็นเอกสารขาย (หลังแปลงแล้วล็อก เพื่อให้ตรงกับใบกำกับที่ออกไป) — แก้วันที่ได้ภายในเดือนของเลขที่เดิม
 */
export function saveQuotation(state: AccountingData, input: QuotationInput): { state: AccountingData; quotation: Quotation } {
  assertISODate(input.date, 'วันที่ใบเสนอราคา');
  if (!Number.isInteger(input.validDays) || input.validDays < 0 || input.validDays > 365) {
    throw new BusinessRuleError('ยืนราคาได้ 0–365 วัน');
  }
  assertLines(state, input.lines, 'sales');
  const contact = contactOf(state, input.contactId);
  if (contact.kind === 'vendor') throw new BusinessRuleError(`${contactDisplayName(contact)} เป็นผู้ขายเท่านั้น — ตั้งเป็นลูกค้าหรือทั้งสองก่อน`);
  const { vatRegistered } = state.company;
  const vatMode = vatRegistered ? input.vatMode : 'none';
  const vatRate = vatRegistered ? VAT_RATE : 0;
  assertPositiveTotal(calcDocument({ lines: input.lines, vatMode, vatRate }).total);
  const now = new Date().toISOString();
  const fields = {
    date: input.date,
    validDays: input.validDays,
    contactId: contact.id,
    lines: input.lines.map((l) => ({ ...l, description: l.description.trim() })),
    vatMode,
    vatRate,
    ...(input.saleType === 'service' ? { saleType: 'service' as const } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    buyer: partySnapshot(contact),
    updatedAt: now,
  };

  if (input.id) {
    const current = state.quotations.find((q) => q.id === input.id);
    if (!current) throw new BusinessRuleError('ไม่พบใบเสนอราคา');
    if (current.convertedSalesId) throw new BusinessRuleError(`${current.docNo} ออกเอกสารขายแล้ว แก้ไขไม่ได้ — ทำใบเสนอราคาใหม่`);
    if (parseDocNo(current.docNo)?.period !== docPeriodCode(input.date)) {
      throw new BusinessRuleError(`เลขที่ ${current.docNo} เป็นของเดือนเดิม — แก้วันที่ได้ภายในเดือนเดียวกัน หรือทำใบเสนอราคาใหม่`);
    }
    // คงเลขที่/สถานะ/วันที่สร้างเดิม — ฟิลด์ที่เหลือมาจากข้อมูลใหม่ทั้งหมด (ลบหมายเหตุ/ประเภทการขายได้)
    const quotation: Quotation = { id: current.id, docNo: current.docNo, status: current.status, createdAt: current.createdAt, ...fields };
    return { state: { ...state, quotations: state.quotations.map((q) => (q.id === current.id ? quotation : q)) }, quotation };
  }

  const n = takeNumber(state, DOC_PREFIX.quotation, input.date);
  const quotation: Quotation = { id: uid(), docNo: n.docNo, ...fields, status: 'draft', createdAt: now };
  return { state: { ...state, quotations: [...state.quotations, quotation], sequences: n.sequences }, quotation };
}

/** เปลี่ยนสถานะใบเสนอราคา (ร่าง → ส่งแล้ว → ตอบรับ/ไม่อนุมัติ/หมดอายุ) — แปลงแล้วเปลี่ยนไม่ได้ */
export function setQuotationStatus(state: AccountingData, id: string, status: QuotationStatus): AccountingData {
  const current = state.quotations.find((q) => q.id === id);
  if (!current) throw new BusinessRuleError('ไม่พบใบเสนอราคา');
  if (!QUOTATION_STATUSES.includes(status)) throw new BusinessRuleError('สถานะไม่ถูกต้อง');
  if (current.convertedSalesId) throw new BusinessRuleError(`${current.docNo} ออกเอกสารขายแล้ว เปลี่ยนสถานะไม่ได้`);
  const updated: Quotation = { ...current, status, updatedAt: new Date().toISOString() };
  return { ...state, quotations: state.quotations.map((q) => (q.id === id ? updated : q)) };
}

/**
 * ออกเอกสารขาย (ใบกำกับภาษี/ใบแจ้งหนี้ ตามประเภทการขาย) จากใบเสนอราคา — ลูกค้าต้องตรงกัน, ใบเสนอราคายังไม่หมดอายุ
 * ณ วันที่เอกสาร / ไม่ถูกปฏิเสธ / ยังไม่เคยแปลง; หลังออกแล้วใบเสนอราคา = ตอบรับ + ผูกกับเอกสารขาย (ล็อก)
 */
export function issueFromQuotation(state: AccountingData, quotationId: string, input: SalesInput) {
  const quotation = state.quotations.find((q) => q.id === quotationId);
  if (!quotation) throw new BusinessRuleError('ไม่พบใบเสนอราคา');
  assertISODate(input.date, 'วันที่เอกสาร');
  const problem = quotationConvertProblem(quotation, input.date);
  if (problem) throw new BusinessRuleError(problem);
  if (input.contactId !== quotation.contactId) throw new BusinessRuleError(`ลูกค้าต้องตรงกับใบเสนอราคา ${quotation.docNo}`);
  if (input.date < quotation.date) throw new BusinessRuleError(`วันที่เอกสารต้องไม่ก่อนวันที่ใบเสนอราคา ${quotation.docNo}`);
  const r = issueTaxInvoice(state, input);
  const updated: Quotation = { ...quotation, status: 'accepted', convertedSalesId: r.doc.id, updatedAt: new Date().toISOString() };
  return {
    state: { ...r.state, quotations: r.state.quotations.map((q) => (q.id === quotation.id ? updated : q)) },
    doc: r.doc,
    quotation: updated,
  };
}
