import type { AccountingData } from 'src/domain';

import {
  ACC,
  sumBaht,
  balanceOf,
  balanceSheet,
  trialBalance,
  calcDocument,
  profitAndLoss,
  pp30ForPeriod,
  latestVatCredit,
  yearCloseProblem,
  purchaseVatReport,
  openingEntryTotals,
  purchaseOutstanding,
  planPurchasePayment,
  isOpeningReconciled,
  openingBlockedReason,
  openingReconciliation,
  suggestedFiscalYearEnd,
  validateAccountingData,
  purchaseAdjustedWhtGroups,
} from 'src/domain';

import { emptyData } from '../seed';
import { ln, pln, demo, TODAY } from './fixtures';
import {
  closeYear,
  lockPeriod,
  payPurchase,
  recordPurchase,
  receivePayment,
  issueTaxInvoice,
  addManualJournal,
  setOpeningBalances,
  recordSupplierCreditNote,
} from '../actions';

import type { OpeningBalanceInput, SupplierCreditNoteInput } from '../actions';

// ----------------------------------------------------------------------
// Sprint B batch 3 — B5 งบฐานะการเงิน / ปิดปี / ยอดยกมา และ B8 ใบลดหนี้จากผู้ขาย
// ----------------------------------------------------------------------

describe('B5 balance sheet', () => {
  it('assets = liabilities + equity including the unclosed profit (demo data)', () => {
    const data = demo();
    const bs = balanceSheet(data.accounts, data.journal, TODAY);
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssets).toBe(bs.totalLiabilitiesAndEquity);
    const pl = profitAndLoss(data.accounts, data.journal, '2000-01-01', TODAY);
    expect(bs.unclosedProfit).toBe(pl.netProfit);
    expect(bs.assets.find((r) => r.account.code === ACC.bank)?.balance).toBe(balanceOf(trialBalance(data.accounts, data.journal), ACC.bank));
    expect(bs.equity.find((r) => r.account.code === ACC.capital)?.balance).toBe(1500000);
  });
});

describe('B5 closeYear — closing entry into 3200 retained earnings', () => {
  const data = demo();
  const locked = lockPeriod(data, '2026-12-31', '2027-01-15');

  it('requires the periods to be locked through the year end, a month end, and a retained earnings account', () => {
    expect(() => closeYear(data, '2026-12-31')).toThrow(/ต้องปิดงวดถึง/);
    expect(() => closeYear(locked, '2026-12-30')).toThrow(/วันสิ้นเดือน/);
    expect(() => closeYear(locked, '2569-12-31')).toThrow(/ไม่ถูกต้อง/);
    expect(yearCloseProblem({ ...locked, accounts: locked.accounts.filter((a) => a.code !== ACC.retained) }, '2026-12-31')).toMatch(
      /3200/
    );
    expect(suggestedFiscalYearEnd(locked)).toBe('2026-12-31');
  });

  it('zeros revenue/expense through the year end, moves net profit to 3200, keeps the balance sheet balanced', () => {
    const before = profitAndLoss(locked.accounts, locked.journal, '2026-01-01', '2026-12-31');
    const r = closeYear(locked, '2026-12-31');
    expect(r.already).toBe(false);
    expect(r.close.netProfit).toBe(before.netProfit);
    const tb = trialBalance(r.state.accounts, r.state.journal, '2026-12-31');
    expect(tb.filter((x) => x.account.type === 'revenue' || x.account.type === 'expense').every((x) => x.balance === 0)).toBe(true);
    expect(balanceOf(tb, ACC.retained)).toBe(before.netProfit);
    // งบกำไรขาดทุนของปีที่ปิดแล้วยังแสดงตัวเลขเดิม (ไม่นับรายการปิดบัญชี)
    expect(profitAndLoss(r.state.accounts, r.state.journal, '2026-01-01', '2026-12-31').netProfit).toBe(before.netProfit);
    const bs = balanceSheet(r.state.accounts, r.state.journal, '2026-12-31');
    expect(bs.balanced).toBe(true);
    expect(bs.unclosedProfit).toBe(0);
    expect(validateAccountingData(r.state)).toEqual([]);
  });

  it('is idempotent per year and the next year must be 12 months later', () => {
    const once = closeYear(locked, '2026-12-31');
    const twice = closeYear(once.state, '2026-12-31');
    expect(twice.already).toBe(true);
    expect(twice.state).toBe(once.state);
    expect(twice.state.journal.filter((e) => e.source === 'year-close')).toHaveLength(1);
    const later = lockPeriod(once.state, '2027-06-30', '2027-07-02');
    expect(() => closeYear(later, '2027-06-30')).toThrow(/12 เดือน/);
    expect(suggestedFiscalYearEnd(later)).toBe('2027-12-31');
    // ปีถัดไปที่ไม่มียอด: บันทึกการปิดปีโดยไม่มีรายการบัญชี
    const next = closeYear(lockPeriod(once.state, '2027-12-31', '2028-01-05'), '2027-12-31');
    expect(next.close).toMatchObject({ netProfit: 0 });
    expect(next.close.journalId).toBeUndefined();
    expect(validateAccountingData(next.state)).toEqual([]);
  });

  it('integrity detects a tampered close (P&L not zero / profit mismatch / duplicate)', () => {
    const r = closeYear(locked, '2026-12-31');
    const tampered: AccountingData = { ...r.state, yearCloses: r.state.yearCloses.map((c) => ({ ...c, netProfit: c.netProfit + 1 })) };
    expect(validateAccountingData(tampered).join()).toMatch(/กำไรสุทธิ/);
    const dup: AccountingData = { ...r.state, yearCloses: [...r.state.yearCloses, { ...r.state.yearCloses[0], id: 'x' }] };
    expect(validateAccountingData(dup).join()).toMatch(/ปิดซ้ำ/);
    const unlocked: AccountingData = { ...r.state, company: { ...r.state.company, lockedThrough: '2026-11-30' } };
    expect(validateAccountingData(unlocked).join()).toMatch(/ยังไม่ได้ปิดงวดถึงวันสิ้นปี/);
  });
});

// ----------------------------------------------------------------------

function blank(): AccountingData {
  return { ...emptyData(), contacts: demo().contacts };
}

const OPENING: OpeningBalanceInput = {
  date: '2026-09-30',
  lines: [
    { accountCode: ACC.bank, debit: 500000, credit: 0 },
    { accountCode: ACC.inventory, debit: 120000, credit: 0 },
    { accountCode: ACC.capital, debit: 0, credit: 500000 },
    { accountCode: ACC.retained, debit: 0, credit: 96220 },
    { accountCode: ACC.vatPayable, debit: 0, credit: 12000 },
  ],
  vatCredit: 1500,
  whtReceivable: 720,
  receivableControl: 53500,
  payableControl: 67500,
  receivables: [
    { contactId: 'c-abc', docNo: 'IV6809-0012', date: '2026-09-15', dueDate: '2026-10-15', amount: 32100 },
    { contactId: 'c-siammold', docNo: 'IV6809-0020', date: '2026-09-28', dueDate: '2026-11-12', amount: 21400 },
  ],
  payables: [
    { contactId: 'v-resin', docNo: 'TP-0901', date: '2026-09-10', amount: 53500, vatAmount: 3500 },
    { contactId: 'v-somchai', docNo: 'SC-77', date: '2026-09-25', amount: 14000, whtIncomeType: 'ค่าบริการ', whtRate: 3 },
  ],
};

describe('B5 opening balances (migrating from Express)', () => {
  const r = setOpeningBalances(blank(), OPENING);

  it('posts one balanced opening entry and creates open AR/AP items that reconcile to the control accounts', () => {
    expect(r.state.openingBalance?.date).toBe('2026-09-30');
    const entry = r.state.journal.find((e) => e.source === 'opening');
    expect(entry?.docNo).toBe('JV6909-0001');
    const tb = trialBalance(r.state.accounts, r.state.journal);
    expect(balanceOf(tb, ACC.receivable)).toBe(53500);
    expect(balanceOf(tb, ACC.payable)).toBe(67500);
    expect(balanceOf(tb, ACC.vatCredit)).toBe(1500);
    expect(balanceOf(tb, ACC.whtReceivable)).toBe(720);
    expect(r.state.sales.filter((s) => s.opening).map((s) => [s.docNo, calcDocument(s).total, s.vatMode, s.etax])).toEqual([
      ['IV6809-0012', 32100, 'none', 'not-required'],
      ['IV6809-0020', 21400, 'none', 'not-required'],
    ]);
    expect(balanceSheet(r.state.accounts, r.state.journal, '2026-09-30').balanced).toBe(true);
    expect(validateAccountingData(r.state)).toEqual([]);
  });

  it('entry totals and the blocked reason drive the wizard summary', () => {
    expect(openingEntryTotals(OPENING)).toEqual({ debit: 675720, credit: 675720, difference: 0 });
    expect(openingEntryTotals({ ...OPENING, vatCredit: 0 }).difference).toBe(-1500);
    expect(openingBlockedReason(blank())).toBeNull();
    expect(openingBlockedReason(r.state)).toBeNull();
    expect(openingBlockedReason(demo())).toMatch(/ก่อนมีรายการอื่น/);
  });

  it('reconciliation helper shows the difference between the old trial balance and the open items', () => {
    const rows = openingReconciliation({ ...OPENING, receivableControl: 50000 });
    expect(rows[0]).toMatchObject({ accountCode: ACC.receivable, control: 50000, items: 53500, difference: -3500 });
    expect(isOpeningReconciled(rows)).toBe(false);
    expect(isOpeningReconciled(openingReconciliation(OPENING))).toBe(true);
    expect(() => setOpeningBalances(blank(), { ...OPENING, receivableControl: 50000 })).toThrow(/ไม่เท่ากับยอดลูกหนี้การค้า/);
    expect(() => setOpeningBalances(blank(), { ...OPENING, payableControl: 1 })).toThrow(/ไม่เท่ากับยอดเจ้าหนี้การค้า/);
  });

  it('rejects unbalanced entries, control accounts in GL lines and bad items', () => {
    expect(() => setOpeningBalances(blank(), { ...OPENING, vatCredit: 1000 })).toThrow(/ไม่สมดุล/);
    expect(() =>
      setOpeningBalances(blank(), { ...OPENING, lines: [...OPENING.lines, { accountCode: ACC.outputVat, debit: 0, credit: 1 }] })
    ).toThrow(/บัญชีคุม/);
    expect(() =>
      setOpeningBalances(blank(), { ...OPENING, lines: [...OPENING.lines, { accountCode: ACC.receivable, debit: 1, credit: 0 }] })
    ).toThrow(/บัญชีคุม/);
    const dup = { ...OPENING, receivables: [OPENING.receivables[0], { ...OPENING.receivables[0], amount: 21400 }] };
    expect(() => setOpeningBalances(blank(), dup)).toThrow(/ซ้ำ/);
    const late = { ...OPENING, receivables: [{ ...OPENING.receivables[0], date: '2026-10-01' }, OPENING.receivables[1]] };
    expect(() => setOpeningBalances(blank(), late)).toThrow(/ไม่หลังวันยอดยกมา/);
    const vendorAsCustomer = { ...OPENING, receivables: [{ ...OPENING.receivables[0], contactId: 'v-resin' }, OPENING.receivables[1]] };
    expect(() => setOpeningBalances(blank(), vendorAsCustomer)).toThrow(/ผู้ขายเท่านั้น/);
    const badVat = { ...OPENING, payables: [{ ...OPENING.payables[0], vatAmount: 53500 }, OPENING.payables[1]] };
    expect(() => setOpeningBalances(blank(), badVat)).toThrow(/VAT ต้องน้อยกว่า/);
  });

  it('is allowed only before any other transaction, but can be replaced until then', () => {
    expect(() => setOpeningBalances(demo(), OPENING)).toThrow(/ก่อนมีรายการอื่น/);
    // แก้ยอดยกมาซ้ำได้ (ยังไม่มีรายการอื่น) — เลข JV เดิมคืนก่อนออกใหม่
    const ok = setOpeningBalances(r.state, { ...OPENING, date: '2026-10-05' }).state;
    expect(ok.journal.filter((e) => e.source === 'opening')).toHaveLength(1);
    expect(ok.journal[0].docNo).toBe('JV6910-0001');
    expect(ok.sequences).toEqual({ JV6910: 1 });
    expect(ok.sales.filter((s) => s.opening)).toHaveLength(2);
    expect(validateAccountingData(ok)).toEqual([]);
    const afterSale = receivePayment(ok, {
      invoiceId: ok.sales[0].id,
      date: '2026-10-10',
      amount: 1000,
      whtAmount: 0,
      depositAccountCode: ACC.bank,
    }).state;
    expect(() => setOpeningBalances(afterSale, OPENING)).toThrow(/ก่อนมีรายการอื่น/);
  });

  it('open items can be received / paid (with WHT on the pre-VAT base), new entries must be after the opening date', () => {
    const ar = r.state.sales.find((s) => s.docNo === 'IV6809-0012');
    const ap = r.state.purchases.find((p) => p.docNo === 'SC-77');
    if (!ar || !ap) throw new Error('missing');
    expect(() =>
      receivePayment(r.state, { invoiceId: ar.id, date: '2026-09-30', amount: 100, whtAmount: 0, depositAccountCode: ACC.bank })
    ).toThrow(/หลังวันยอดยกมา/);
    expect(() => addManualJournal(r.state, { date: '2026-09-29', description: 'x', lines: [] })).toThrow(/หลังวันยอดยกมา/);
    const got = receivePayment(r.state, { invoiceId: ar.id, date: '2026-10-05', amount: 32100, whtAmount: 0, depositAccountCode: ACC.bank });
    expect(got.receipt.docNo).toMatch(/^RE6910-/);
    expect(got.state.sales.find((s) => s.id === ar.id)?.status).toBe('paid');
    const paid = payPurchase(got.state, { purchaseId: ap.id, date: '2026-10-06', accountCode: ACC.bank });
    expect(paid.payment.whtAmount).toBe(420);
    expect(paid.payment.whtCertNo).toMatch(/^WT6910-/);
    const resin = r.state.purchases.find((p) => p.docNo === 'TP-0901');
    if (!resin) throw new Error('missing');
    // ใบที่มี VAT รวมอยู่: ฐานหัก ณ ที่จ่าย = ยอด − VAT (ไม่มีหักในตัวอย่างนี้)
    expect(resin.lines.map((l) => l.unitPrice)).toEqual([50000, 3500]);
    // เลขใบกำกับผู้ขายยกมาแล้ว กันบันทึกซ้ำ
    expect(() =>
      recordPurchase(paid.state, {
        supplierInvoiceNo: 'TP-0901',
        supplierInvoiceDate: '2026-09-10',
        vatClaimPeriod: '2026-10',
        date: '2026-10-07',
        contactId: 'v-resin',
        vatMode: 'exclusive',
        claimVat: true,
        whtCondition: '1',
        lines: [pln(1, 100, ACC.cogs)],
      })
    ).toThrow(/บันทึกไปแล้ว/);
    expect(validateAccountingData(paid.state)).toEqual([]);
  });

  it('VAT credit brought forward from Express feeds ภ.พ.30 and the first VAT close', () => {
    const sale = issueTaxInvoice(r.state, {
      date: '2026-10-10',
      dueDate: '2026-11-10',
      contactId: 'c-abc',
      vatMode: 'exclusive',
      lines: [ln(1, 10000)],
    }).state;
    expect(latestVatCredit(sale)).toBe(1500);
    const oct = pp30ForPeriod(sale, { year: 2026, month: 10 });
    expect(oct).toMatchObject({ outputVat: 700, broughtForward: 1500, payable: 0, carriedForward: 800 });
    const locked = lockPeriod(sale, '2026-10-31', '2026-11-05');
    expect(locked.vatCloses[0]).toMatchObject({ period: '2026-10', broughtForward: 1500, carriedForward: 800 });
    expect(validateAccountingData(locked)).toEqual([]);
    expect(yearCloseProblem(locked, '2026-09-30')).toMatch(/หลังวันยอดยกมา/);
  });

  it('closing the first year after a mid-year opening includes the opening P&L balances', () => {
    const withPl = setOpeningBalances(blank(), {
      ...OPENING,
      lines: [
        ...OPENING.lines.filter((l) => l.accountCode !== ACC.retained),
        { accountCode: ACC.retained, debit: 0, credit: 46220 },
        { accountCode: ACC.sales, debit: 0, credit: 80000 },
        { accountCode: ACC.rent, debit: 30000, credit: 0 },
      ],
    }).state;
    expect(validateAccountingData(withPl)).toEqual([]);
    const closed = closeYear(lockPeriod(withPl, '2026-12-31', '2027-01-10'), '2026-12-31');
    expect(closed.close.netProfit).toBe(50000);
    expect(balanceOf(trialBalance(closed.state.accounts, closed.state.journal), ACC.retained)).toBe(96220);
    expect(validateAccountingData(closed.state)).toEqual([]);
  });

  it('integrity flags opening items detached from the opening entry and entries dated on/before the opening date', () => {
    const detached: AccountingData = {
      ...r.state,
      sales: r.state.sales.map((s, i) => (i === 0 ? { ...s, journalId: 'x' } : s)),
    };
    expect(validateAccountingData(detached).join()).toMatch(/ไม่ได้ผูกกับรายการยอดยกมา/);
    const early = addManualJournal({ ...r.state, openingBalance: undefined }, {
      date: '2026-09-30',
      description: 'ลงก่อนวันยอดยกมา',
      lines: [
        { accountCode: ACC.misc, debit: 10, credit: 0 },
        { accountCode: ACC.bank, debit: 0, credit: 10 },
      ],
    }).state;
    expect(validateAccountingData({ ...early, openingBalance: r.state.openingBalance }).join()).toMatch(/ไม่หลังวันยอดยกมา/);
    const noOpening: AccountingData = { ...r.state, openingBalance: undefined };
    expect(validateAccountingData(noOpening).join()).toMatch(/ไม่มีข้อมูลยอดยกมา/);
  });
});

// ----------------------------------------------------------------------

const purchase = (state: AccountingData, lines = [pln(1, 10000, ACC.cogs)], claimVat = true) =>
  recordPurchase(state, {
    supplierInvoiceNo: `INV-${Math.random().toString(36).slice(2, 8)}`,
    supplierInvoiceDate: '2026-10-20',
    vatClaimPeriod: '2026-10',
    date: TODAY,
    contactId: 'v-resin',
    vatMode: 'exclusive',
    claimVat,
    whtCondition: '1',
    lines,
  });

const supplierCredit = (state: AccountingData, purchaseId: string, input: Partial<SupplierCreditNoteInput> = {}) =>
  recordSupplierCreditNote(state, {
    purchaseId,
    supplierCreditNoteNo: `CN-${Math.random().toString(36).slice(2, 8)}`,
    supplierCreditNoteDate: '2026-11-03',
    date: '2026-11-05',
    reason: 'คืนสินค้าชำรุด',
    lines: [ln(1, 2000, ACC.cogs)],
    ...input,
  });

describe('B8 supplier credit note (ใบลดหนี้จากผู้ขาย)', () => {
  const p = purchase(demo());

  it('reduces the payable and input VAT in the month received (PC number, negative row in the purchase VAT report)', () => {
    const r = supplierCredit(p.state, p.doc.id);
    expect(r.doc.docNo).toBe('PC6911-0001');
    expect(r.doc).toMatchObject({ claimVat: true, vatClaimPeriod: '2026-11' });
    expect(purchaseOutstanding(r.state, p.doc)).toBe(8560);
    const entry = r.state.journal.find((e) => e.id === r.doc.journalId);
    expect(entry?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: ACC.payable, debit: 2140 }),
        expect.objectContaining({ accountCode: ACC.cogs, credit: 2000 }),
        expect.objectContaining({ accountCode: ACC.inputVat, credit: 140 }),
      ])
    );
    const nov = purchaseVatReport(r.state.purchases, r.state.contacts, { year: 2026, month: 11 }, r.state.purchaseCredits);
    expect(nov.find((x) => x.id === r.doc.id)).toMatchObject({ kind: 'purchase-credit-note', net: -2000, vat: -140, refDocNo: r.doc.docNo });
    expect(pp30ForPeriod(r.state, { year: 2026, month: 11 }).inputVat).toBe(-140);
    expect(validateAccountingData(r.state)).toEqual([]);
  });

  it('enforces date, lock, amount and duplicate rules', () => {
    expect(() => supplierCredit(p.state, p.doc.id, { date: '2026-10-23', supplierCreditNoteDate: '2026-10-22' })).toThrow(/ไม่ก่อนวันที่บันทึก/);
    expect(() => supplierCredit(p.state, p.doc.id, { supplierCreditNoteDate: '2026-11-06' })).toThrow(/ไม่หลังวันที่ได้รับ/);
    expect(() => supplierCredit(p.state, p.doc.id, { supplierCreditNoteDate: '2026-10-19', date: '2026-10-24' })).toThrow(/ไม่ก่อนวันที่ใบกำกับเดิม/);
    expect(() => supplierCredit(p.state, p.doc.id, { lines: [ln(1, 10001, ACC.cogs)] })).toThrow(/เกินยอดค้างจ่าย/);
    expect(() => supplierCredit(p.state, p.doc.id, { reason: ' ' })).toThrow(/เหตุผล/);
    expect(() => supplierCredit(p.state, p.doc.id, { supplierCreditNoteNo: '' })).toThrow(/เลขที่ใบลดหนี้ของผู้ขาย/);
    expect(() => supplierCredit(p.state, p.doc.id, { lines: [ln(1, 100, ACC.receivable)] })).toThrow(/บัญชีคุม/);
    const once = supplierCredit(p.state, p.doc.id, { supplierCreditNoteNo: 'CN-001' });
    expect(() => supplierCredit(once.state, p.doc.id, { supplierCreditNoteNo: 'cn 001' })).toThrow(/บันทึกไปแล้ว/);
    const locked = lockPeriod(p.state, '2026-10-31', '2026-11-10');
    expect(() => supplierCredit(locked, p.doc.id, { date: '2026-10-30', supplierCreditNoteDate: '2026-10-30' })).toThrow(/ปิดงวด/);
    // ใช้สิทธิภาษีซื้อเดือน ธ.ค.: ลดภาษีซื้อในเดือน พ.ย. ไม่ได้
    const dec = recordPurchase(p.state, {
      supplierInvoiceNo: 'D-1',
      supplierInvoiceDate: '2026-10-20',
      vatClaimPeriod: '2026-12',
      date: TODAY,
      contactId: 'v-resin',
      vatMode: 'exclusive',
      claimVat: true,
      whtCondition: '1',
      lines: [pln(1, 1000, ACC.cogs)],
    });
    expect(() => supplierCredit(dec.state, dec.doc.id, { lines: [ln(1, 100, ACC.cogs)] })).toThrow(/ได้ตั้งแต่เดือนนั้น/);
  });

  it('must not be dated before the latest payment; crediting the rest marks the purchase paid', () => {
    const paidPart = payPurchase(p.state, { purchaseId: p.doc.id, date: '2026-11-10', accountCode: ACC.bank, amount: 5350 });
    expect(() => supplierCredit(paidPart.state, p.doc.id)).toThrow(/การจ่ายครั้งล่าสุด/);
    const rest = supplierCredit(paidPart.state, p.doc.id, { date: '2026-11-12', supplierCreditNoteDate: '2026-11-12', lines: [ln(1, 5000, ACC.cogs)] });
    expect(purchaseOutstanding(rest.state, p.doc)).toBe(0);
    expect(rest.state.purchases.find((x) => x.id === p.doc.id)?.paid).toBe(true);
    expect(() => payPurchase(rest.state, { purchaseId: p.doc.id, date: '2026-11-13', accountCode: ACC.bank })).toThrow(/จ่ายชำระแล้ว/);
    expect(validateAccountingData(rest.state)).toEqual([]);
  });

  it('WHT on later payments uses the base after the credit note', () => {
    const svc = purchase(demo(), [pln(1, 10000, ACC.professional, ['ค่าบริการ', 3])]);
    const cn = supplierCredit(svc.state, svc.doc.id, { lines: [ln(1, 4000, ACC.professional)] });
    expect(purchaseAdjustedWhtGroups(cn.state, svc.doc)).toEqual([{ incomeType: 'ค่าบริการ', rate: 3, base: 6000, tax: 180 }]);
    const plan = planPurchasePayment(cn.state, svc.doc, purchaseOutstanding(cn.state, svc.doc));
    expect(plan).toMatchObject({ final: true, whtAmount: 180 });
    const paid = payPurchase(cn.state, { purchaseId: svc.doc.id, date: '2026-11-06', accountCode: ACC.bank });
    expect(paid.payment).toMatchObject({ amount: 6420, whtAmount: 180, netPaid: 6240 });
    expect(validateAccountingData(paid.state)).toEqual([]);
    // จ่ายบางส่วนแล้วลดหนี้ส่วนที่เหลือ: หัก ณ ที่จ่ายรวมต้องเท่าฐานหลังลดหนี้ (เผื่อเศษปัด)
    const part = payPurchase(svc.state, { purchaseId: svc.doc.id, date: '2026-11-01', accountCode: ACC.bank, amount: 3333.33 });
    const settle = supplierCredit(part.state, svc.doc.id, {
      date: '2026-11-02',
      supplierCreditNoteDate: '2026-11-02',
      lines: [ln(1, sumBaht([10000, -3115.26]), ACC.professional)],
    });
    expect(purchaseOutstanding(settle.state, svc.doc)).toBe(0);
    expect(validateAccountingData(settle.state)).toEqual([]);
  });

  it('non-claimable purchase: the VAT part reduces the expense, nothing in the VAT report', () => {
    const noClaim = purchase(demo(), [pln(1, 10000, ACC.cogs)], false);
    const r = supplierCredit(noClaim.state, noClaim.doc.id);
    expect(r.doc.claimVat).toBe(false);
    expect(r.doc.vatClaimPeriod).toBeUndefined();
    const entry = r.state.journal.find((e) => e.id === r.doc.journalId);
    expect(entry?.lines.find((l) => l.accountCode === ACC.cogs)?.credit).toBe(2140);
    expect(purchaseVatReport(r.state.purchases, r.state.contacts, { year: 2026, month: 11 }, r.state.purchaseCredits)).toEqual([]);
    expect(validateAccountingData(r.state)).toEqual([]);
  });

  it('opening (Express) payables cannot take a supplier credit note', () => {
    const o = setOpeningBalances(blank(), OPENING).state;
    const ap = o.purchases[0];
    expect(() => supplierCredit(o, ap.id, { date: '2026-10-05', supplierCreditNoteDate: '2026-10-05' })).toThrow(/ยอดยกมา/);
  });
});
