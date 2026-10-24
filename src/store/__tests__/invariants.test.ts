import type { AccountingData } from 'src/domain';

import {
  ACC,
  addDays,
  toSatang,
  isBalanced,
  creditableOf,
  trialBalance,
  calcDocument,
  balanceSheet,
  shiftMonthKey,
  customerCreditOf,
  receiptWhtAmount,
  endOfPreviousMonth,
  trialBalanceTotals,
  purchaseOutstanding,
  hasNegativeOutstanding,
  validateAccountingData,
} from 'src/domain';

import { emptyData } from '../seed';
import { ln, pln, demo, TODAY } from './fixtures';
import {
  closeYear,
  lockPeriod,
  payPurchase,
  outstandingOf,
  setETaxStatus,
  recordPurchase,
  receivePayment,
  issueDebitNote,
  issueCreditNote,
  issueTaxInvoice,
  addManualJournal,
  BusinessRuleError,
  setOpeningBalances,
  refundCustomerCredit,
  recordSupplierCreditNote,
} from '../actions';

// ----------------------------------------------------------------------
// สุ่มลำดับ action ~200 ครั้งจากข้อมูลตัวอย่าง (seed คงที่ ผลซ้ำได้)
// หลังทุก action: รายการบัญชีสมดุล; ทุก 25 ครั้งและตอนจบ: ผ่าน validateAccountingData ทั้งก้อน
// (เลขที่ต่อเนื่องต่อ prefix/เดือน, การอ้างอิงครบ, ยอดค้าง/เงินรอคืนไม่ติดลบ)
// ----------------------------------------------------------------------

/** PRNG แบบกำหนด seed ได้ (Park–Miller minimal standard) */
function prng(seed: number) {
  let a = seed % 2147483647 || 1;
  return () => {
    a = (a * 48271) % 2147483647;
    return (a - 1) / 2147483646;
  };
}

/** รายการบัญชีที่เพิ่มขึ้นหลัง action ต้องสมดุลทุกรายการ */
function expectNewEntriesBalanced(state: AccountingData, from: number) {
  state.journal.slice(from).forEach((e) => expect(isBalanced(e.lines)).toBe(true));
}

const CUSTOMERS = ['c-abc', 'c-thairung', 'c-siammold', 'c-nakhon'];
const VENDORS = ['v-resin', 'v-express', 'v-somchai', 'v-somsri'];

/** บริษัทใหม่ที่ยกยอดมาจาก Express ณ 30 ก.ย. (ใบค้างรับ 2 ใบ ค้างจ่าย 2 ใบ หนึ่งใบหัก ณ ที่จ่าย) */
export function openingStart(): AccountingData {
  return setOpeningBalances(
    { ...emptyData(), contacts: demo().contacts },
    {
      date: '2026-09-30',
      lines: [
        { accountCode: ACC.bank, debit: 400000, credit: 0 },
        { accountCode: ACC.capital, debit: 0, credit: 400000 },
        { accountCode: ACC.retained, debit: 0, credit: 2000 },
      ],
      vatCredit: 1200,
      whtReceivable: 300,
      receivableControl: 53500,
      payableControl: 53000,
      receivables: [
        { contactId: 'c-abc', docNo: 'IV6809-0012', date: '2026-09-15', dueDate: '2026-10-15', amount: 32100 },
        { contactId: 'c-nakhon', docNo: 'IV6809-0020', date: '2026-09-28', dueDate: '2026-11-12', amount: 21400 },
      ],
      payables: [
        { contactId: 'v-resin', docNo: 'TP-0901', date: '2026-09-10', amount: 42800, vatAmount: 2800 },
        { contactId: 'v-somchai', docNo: 'SC-77', date: '2026-09-25', amount: 10200, whtIncomeType: 'ค่าบริการ', whtRate: 3 },
      ],
    }
  ).state;
}

function run(seed: number, steps: number, start: () => AccountingData = demo) {
  const rnd = prng(seed);
  const pick = <T,>(items: T[]): T => items[Math.floor(rnd() * items.length)];
  const money = (max: number) => Math.max(0.01, Math.floor(rnd() * max * 100) / 100);

  let state: AccountingData = start();
  let date = TODAY;
  let invoiceNo = 0;
  const outcome = { ok: 0, rejected: 0 };

  const invoices = () => state.sales.filter((s) => s.kind === 'tax-invoice' && s.status !== 'cancelled');

  const actions: (() => AccountingData)[] = [
    () =>
      issueTaxInvoice(state, {
        date,
        dueDate: addDays(date, 30),
        contactId: pick(CUSTOMERS),
        vatMode: pick(['exclusive', 'inclusive', 'none'] as const),
        lines: [ln(Math.ceil(rnd() * 20), money(5000)), ...(rnd() < 0.3 ? [ln(1, money(20000), ACC.service)] : [])],
      }).state,
    // งานบริการ (ม.78/1): ใบแจ้งหนี้ก่อน ภาษีขายเกิดตอนรับชำระ
    () =>
      issueTaxInvoice(state, {
        date,
        dueDate: addDays(date, 30),
        contactId: pick(CUSTOMERS),
        vatMode: pick(['exclusive', 'inclusive', 'none'] as const),
        saleType: 'service',
        lines: [ln(1, money(30000), ACC.service), ...(rnd() < 0.3 ? [ln(Math.ceil(rnd() * 5), money(3000), ACC.service)] : [])],
      }).state,
    () => {
      const inv = pick(invoices());
      const outstanding = outstandingOf(state, inv);
      // บางครั้งตั้งใจจ่ายเกินเพื่อทดสอบว่าถูกปฏิเสธ
      const amount = rnd() < 0.15 ? outstanding + 1 : Math.min(outstanding, money(outstanding || 1));
      const whtAmount = rnd() < 0.3 ? receiptWhtAmount(calcDocument(inv), amount, 3) : 0;
      return receivePayment(state, { invoiceId: inv.id, date, amount, whtAmount, depositAccountCode: pick([ACC.bank, ACC.cash]) }).state;
    },
    () => {
      const inv = pick(invoices());
      const creditable = creditableOf(state, inv);
      const share = rnd() < 0.1 ? 1.2 : rnd();
      const target = Math.floor(toSatang(creditable) * share) / 100;
      const unitPrice = inv.vatMode === 'exclusive' ? Math.floor((target * 100) / 107 * 100) / 100 : target;
      return issueCreditNote(state, { invoiceId: inv.id, date, reason: 'สุ่มลดหนี้', lines: [ln(1, unitPrice)] }).state;
    },
    () => {
      const contactId = pick(CUSTOMERS);
      const available = customerCreditOf(state, contactId);
      return refundCustomerCredit(state, { contactId, date, amount: rnd() < 0.2 ? available + 1 : money(available), accountCode: ACC.bank }).state;
    },
    () => {
      const inv = pick(invoices());
      return issueDebitNote(state, { invoiceId: inv.id, date, reason: 'สุ่มเพิ่มหนี้', lines: [ln(1, money(3000))] }).state;
    },
    () => {
      invoiceNo += 1;
      const wht = (): [string, number] | undefined => pick([undefined, undefined, ['ค่าบริการ', 3], ['ค่าขนส่ง', 1], ['ค่าเช่า', 5]]);
      // ใบกำกับผู้ขายลงวันที่ย้อนหลัง 0–220 วัน, เดือนใช้สิทธิสุ่ม −1..+7 จากเดือนในใบกำกับ (บางครั้งนอกช่วง/ปิดงวดแล้ว)
      const supplierInvoiceDate = addDays(date, -Math.floor(rnd() * 220));
      return recordPurchase(state, {
        // บางครั้งใช้เลขซ้ำเพื่อทดสอบการกันขอคืนภาษีซื้อซ้ำ
        supplierInvoiceNo: rnd() < 0.1 ? 'TP-2025-1302' : `R-${invoiceNo}`,
        supplierInvoiceDate,
        vatClaimPeriod: shiftMonthKey(supplierInvoiceDate.slice(0, 7), Math.floor(rnd() * 9) - 1),
        date,
        contactId: pick(VENDORS),
        vatMode: pick(['exclusive', 'inclusive', 'none'] as const),
        claimVat: rnd() < 0.8,
        whtCondition: '1',
        lines: [
          pln(1, money(30000), pick([ACC.cogs, ACC.freight, ACC.rent, ACC.misc]), wht()),
          ...(rnd() < 0.4 ? [pln(Math.ceil(rnd() * 5), money(3000), ACC.misc, wht())] : []),
        ],
        payNow: rnd() < 0.3 ? { date, accountCode: ACC.bank } : undefined,
      }).state;
    },
    () => {
      const doc = pick(state.purchases.filter((p) => !p.paid));
      const outstanding = purchaseOutstanding(state, doc);
      // จ่ายเต็ม / แบ่งจ่าย / บางครั้งตั้งใจจ่ายเกิน
      const r = rnd();
      const amount = r < 0.4 ? undefined : r < 0.9 ? Math.min(outstanding, money(outstanding)) : outstanding + 1;
      return payPurchase(state, { purchaseId: doc.id, date, accountCode: pick([ACC.bank, ACC.cash]), amount }).state;
    },
    () => {
      const amount = money(5000);
      return addManualJournal(state, {
        date,
        description: 'สุ่มปรับปรุง',
        lines: [
          { accountCode: pick([ACC.misc, ACC.utilities, ACC.receivable]), debit: amount, credit: 0 },
          { accountCode: ACC.bank, debit: 0, credit: amount },
        ],
      }).state;
    },
    () => {
      const docs = state.sales.filter((s) => s.etax === 'pending-sign' || s.etax === 'signed');
      return setETaxStatus(state, [pick(docs).id], pick(['signed', 'uploaded', 'pending-sign'] as const));
    },
    () => lockPeriod(state, endOfPreviousMonth(date), date),
    () => {
      // ใบลดหนี้จากผู้ขาย — บางครั้งเกินยอดค้าง / ลงก่อนการจ่ายล่าสุด (ต้องถูกปฏิเสธ)
      const doc = pick(state.purchases.filter((p) => !p.paid));
      const outstanding = purchaseOutstanding(state, doc);
      const share = rnd() < 0.15 ? 1.3 : rnd();
      const target = Math.floor(toSatang(outstanding) * share) / 100;
      const unitPrice = doc.vatMode === 'exclusive' ? Math.floor(((target * 100) / 107) * 100) / 100 : target;
      return recordSupplierCreditNote(state, {
        purchaseId: doc.id,
        supplierCreditNoteNo: `SCN-${Math.floor(rnd() * 1e6)}`,
        supplierCreditNoteDate: date,
        date,
        reason: 'สุ่มลดหนี้ผู้ขาย',
        lines: [ln(1, unitPrice, doc.lines[0]?.accountCode ?? ACC.misc)],
      }).state;
    },
    () => closeYear(state, '2026-12-31').state,
  ];

  for (let i = 0; i < steps; i += 1) {
    if (rnd() < 0.4) date = addDays(date, 1 + Math.floor(rnd() * 2));
    const journalBefore = state.journal.length;
    try {
      state = pick(actions)();
      outcome.ok += 1;
    } catch (error) {
      // ผิดกติกาได้ (ตั้งใจสุ่มให้ผิดบ้าง) แต่ต้องเป็น BusinessRuleError หรือเลือกเอกสารไม่ได้เท่านั้น
      if (!(error instanceof BusinessRuleError) && !(error instanceof TypeError)) throw error;
      outcome.rejected += 1;
    }
    expectNewEntriesBalanced(state, journalBefore);
    if (i % 25 === 0) expect(validateAccountingData(state)).toEqual([]);
  }
  return { state, outcome };
}

describe('random action sequences keep every invariant', () => {
  it.each([1, 7, 2026])('seed %i', (seed) => {
    const { state, outcome } = run(seed, 200);
    expect(validateAccountingData(state)).toEqual([]);
    expect(hasNegativeOutstanding(state)).toBe(false);
    expect(trialBalanceTotals(trialBalance(state.accounts, state.journal)).balanced).toBe(true);
    // งบแสดงฐานะการเงินสมดุลทุกวันสิ้นเดือนที่ผ่านมา (ก่อน/หลังปิดบัญชีสิ้นปี)
    ['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', TODAY].forEach((asOf) =>
      expect(balanceSheet(state.accounts, state.journal, asOf).balanced).toBe(true)
    );
    // ครอบคลุม action ใหม่ของ batch 3: ใบเสร็จรับเงิน/ใบกำกับภาษี, ใบลดหนี้ผู้ขาย, ปิดปี
    expect(state.receipts.some((r) => r.isTaxInvoice)).toBe(true);
    expect(state.purchaseCredits.length).toBeGreaterThan(0);
    expect(state.yearCloses.length).toBeGreaterThan(0);
    expect(state.sales.some((x) => x.kind === 'credit-note' && x.saleType === 'service')).toBe(true);
    state.contacts.forEach((c) => expect(toSatang(customerCreditOf(state, c.id))).toBeGreaterThanOrEqual(0));
    // มีทั้งรายการที่ผ่านและถูกปฏิเสธ — ทดสอบได้ทั้งสองทาง
    expect(outcome.ok).toBeGreaterThan(80);
    expect(outcome.rejected).toBeGreaterThan(5);
    expect(state.refunds.length + state.payments.length).toBeGreaterThan(0);
    // แบ่งจ่าย: ทุกเอกสารซื้อ ยอดจ่ายรวมไม่เกินยอดเอกสาร และสถานะจ่ายครบตรงกับยอด
    state.purchases.forEach((p) => {
      expect(toSatang(purchaseOutstanding(state, p))).toBeGreaterThanOrEqual(0);
      expect(p.paid).toBe(toSatang(purchaseOutstanding(state, p)) === 0);
    });
    expect(state.vatCloses.length).toBeGreaterThan(0);
    expect(state.purchases.some((p) => state.payments.filter((pv) => pv.purchaseId === p.id).length > 1)).toBe(true);
    expect(state.sales.some((s) => s.kind === 'debit-note')).toBe(true);
  });
});

describe('random action sequences after opening balances from Express', () => {
  it.each([3, 11])('seed %i', (seed) => {
    const { state, outcome } = run(seed, 150, openingStart);
    expect(validateAccountingData(state)).toEqual([]);
    expect(hasNegativeOutstanding(state)).toBe(false);
    expect(balanceSheet(state.accounts, state.journal, '2027-12-31').balanced).toBe(true);
    expect(outcome.ok).toBeGreaterThan(50);
    // ใบค้างยกมาถูกรับ/จ่ายในระหว่างทาง
    const openingIds = new Set([...state.sales, ...state.purchases].filter((d) => d.opening).map((d) => d.id));
    expect(state.receipts.some((r) => openingIds.has(r.invoiceId)) || state.payments.some((p) => openingIds.has(p.purchaseId))).toBe(true);
  });
});
