import type { AccountingData } from 'src/domain';

import {
  ACC,
  addDays,
  toSatang,
  isBalanced,
  creditableOf,
  trialBalance,
  calcDocument,
  customerCreditOf,
  receiptWhtAmount,
  endOfPreviousMonth,
  trialBalanceTotals,
  hasNegativeOutstanding,
  validateAccountingData,
} from 'src/domain';

import { ln, demo, TODAY } from './fixtures';
import {
  lockPeriod,
  payPurchase,
  outstandingOf,
  setETaxStatus,
  recordPurchase,
  receivePayment,
  issueCreditNote,
  issueTaxInvoice,
  addManualJournal,
  BusinessRuleError,
  refundCustomerCredit,
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

function run(seed: number, steps: number) {
  const rnd = prng(seed);
  const pick = <T,>(items: T[]): T => items[Math.floor(rnd() * items.length)];
  const money = (max: number) => Math.max(0.01, Math.floor(rnd() * max * 100) / 100);

  let state: AccountingData = demo();
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
      invoiceNo += 1;
      const whtRate = pick([0, 0, 1, 3, 5]);
      return recordPurchase(state, {
        // บางครั้งใช้เลขซ้ำเพื่อทดสอบการกันขอคืนภาษีซื้อซ้ำ
        supplierInvoiceNo: rnd() < 0.1 ? 'TP-2025-1302' : `R-${invoiceNo}`,
        date: addDays(date, -Math.floor(rnd() * 5)),
        contactId: pick(VENDORS),
        vatMode: pick(['exclusive', 'none'] as const),
        claimVat: rnd() < 0.8,
        whtRate,
        whtIncomeType: whtRate ? 'ค่าบริการ' : '',
        whtCondition: '1',
        lines: [ln(1, money(30000), pick([ACC.cogs, ACC.freight, ACC.rent, ACC.misc]))],
        payNow: rnd() < 0.4 ? { date, accountCode: ACC.bank } : undefined,
      }).state;
    },
    () => {
      const unpaid = state.purchases.filter((p) => !p.paid);
      return payPurchase(state, { purchaseId: pick(unpaid).id, date, accountCode: pick([ACC.bank, ACC.cash]) }).state;
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
    state.contacts.forEach((c) => expect(toSatang(customerCreditOf(state, c.id))).toBeGreaterThanOrEqual(0));
    // มีทั้งรายการที่ผ่านและถูกปฏิเสธ — ทดสอบได้ทั้งสองทาง
    expect(outcome.ok).toBeGreaterThan(80);
    expect(outcome.rejected).toBeGreaterThan(5);
    expect(state.refunds.length + state.payments.length).toBeGreaterThan(0);
  });
});
