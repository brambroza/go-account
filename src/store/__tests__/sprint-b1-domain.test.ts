import type { AccountingData, OpeningBalance } from 'src/domain';

import {
  ACC,
  balanceOf,
  calcDocument,
  trialBalance,
  buildETaxXml,
  cashBalanceOf,
  pp30ForPeriod,
  deferredVatOf,
  eTaxPurposeCode,
  creditNoteWhtNote,
  quotationVariance,
  whtPayeesForPeriod,
  purchaseOutstanding,
  supplierRefundDueOf,
  validateAccountingData,
  purchaseCreditAllocation,
  purchaseAdjustedWhtGroups,
} from 'src/domain';

import { emptyData } from '../seed';
import { readAccountingData } from '../migrations';
import { ln, pln, demo, toV1, toV6, TODAY } from './fixtures';
import { STORAGE_KEY, createAccountingStore } from '../accounting-store';
import {
  lockPeriod,
  payPurchase,
  saveQuotation,
  updateCompany,
  transferFunds,
  recordPurchase,
  receivePayment,
  issueCreditNote,
  issueTaxInvoice,
  addManualJournal,
  setOpeningBalances,
  receiveSupplierRefund,
  recordSupplierCreditNote,
} from '../actions';

// ----------------------------------------------------------------------
// Sprint B.1 (domain/store) — U2, U3, U8–U12 และการตัดสินใจ D1–D4
// เคสที่ขึ้นต้นด้วย P/B/C/D/E/F/H/M พอร์ตมาจาก probe ของ thai-accounting-expert / financial-auditor
// ----------------------------------------------------------------------

const D = '2026-10-25';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

const blank = (): AccountingData => ({ ...emptyData(), contacts: demo().contacts });

const purchase = (s: AccountingData, no: string, lines: ReturnType<typeof pln>[], claimVat = true) =>
  recordPurchase(s, {
    supplierInvoiceNo: no,
    supplierInvoiceDate: D,
    vatClaimPeriod: claimVat ? D.slice(0, 7) : undefined,
    date: D,
    contactId: 'v-resin',
    vatMode: 'exclusive',
    claimVat,
    whtCondition: '1',
    lines,
  });

const supplierCredit = (
  s: AccountingData,
  purchaseId: string,
  no: string,
  lines: ReturnType<typeof ln>[],
  date = D
) => recordSupplierCreditNote(s, { purchaseId, supplierCreditNoteNo: no, supplierCreditNoteDate: date, date, reason: 'ลดหนี้', lines });

// ---------------- U2 ยอดยกมางานบริการค้างรับ ----------------

describe('U2 opening service AR with VAT not yet due (ม.78/1)', () => {
  const OPEN = {
    date: '2026-09-30',
    vatCredit: 0,
    whtReceivable: 0,
    receivableControl: 10700,
    payableControl: 0,
    lines: [{ accountCode: ACC.retained, debit: 0, credit: 10000 }],
    receivables: [{ contactId: 'c-abc', docNo: 'BL-6812-0001', date: '2026-09-20', dueDate: '2026-10-20', amount: 10700, serviceVat: 700 }],
    payables: [],
  };

  it('P1: 2151 comes from the open item, receipt issues RT and moves VAT to 2150 in the receipt month', () => {
    const o = setOpeningBalances(blank(), OPEN);
    const ar = o.state.sales.find((x) => x.opening);
    if (!ar) throw new Error('missing');
    expect(ar).toMatchObject({ saleType: 'service', isTaxInvoice: false, vatMode: 'exclusive', etax: 'not-required' });
    expect(deferredVatOf(o.state, ar)).toBe(700);
    const tb = trialBalance(o.state.accounts, o.state.journal);
    expect([balanceOf(tb, ACC.receivable), balanceOf(tb, ACC.deferredOutputVat)]).toEqual([10700, 700]);
    expect(validateAccountingData(o.state)).toEqual([]);

    const part = receivePayment(o.state, { invoiceId: ar.id, date: '2026-10-10', amount: 5350, whtAmount: 0, depositAccountCode: ACC.bank });
    expect(part.receipt).toMatchObject({ isTaxInvoice: true, vat: 350, etax: 'pending-sign' });
    expect(part.receipt.docNo).toMatch(/^RT6910-/);
    const rest = receivePayment(part.state, { invoiceId: ar.id, date: '2026-11-10', amount: 5350, whtAmount: 0, depositAccountCode: ACC.bank });
    expect(pp30ForPeriod(rest.state, { year: 2026, month: 10 }).outputVat).toBe(350);
    expect(pp30ForPeriod(rest.state, { year: 2026, month: 11 }).outputVat).toBe(350);
    const after = trialBalance(rest.state.accounts, rest.state.journal);
    expect([balanceOf(after, ACC.deferredOutputVat), balanceOf(after, ACC.outputVat)]).toEqual([0, 700]);
    expect(validateAccountingData(rest.state)).toEqual([]);
  });

  it('inclusive amounts work; mismatched VAT, free 2151 lines and non-VAT companies are rejected', () => {
    const odd = {
      ...OPEN,
      receivableControl: 10000,
      lines: [{ accountCode: ACC.retained, debit: 0, credit: 9345.79 }],
      receivables: [{ ...OPEN.receivables[0], amount: 10000, serviceVat: 654.21 }],
    };
    const inc = setOpeningBalances(blank(), odd).state;
    expect(inc.sales[0]).toMatchObject({ saleType: 'service', vatRate: 7 });
    expect(calcDocument(inc.sales[0])).toMatchObject({ total: 10000, vat: 654.21 });
    expect(validateAccountingData(inc)).toEqual([]);
    expect(() => setOpeningBalances(blank(), { ...odd, receivables: [{ ...odd.receivables[0], serviceVat: 600 }] })).toThrow(/ควรเป็น 654.21/);
    expect(() =>
      setOpeningBalances(blank(), { ...OPEN, lines: [...OPEN.lines, { accountCode: ACC.deferredOutputVat, debit: 0, credit: 700 }] })
    ).toThrow(/บัญชีคุม/);
    const nonVat = blank();
    nonVat.company = { ...nonVat.company, vatRegistered: false };
    expect(() => setOpeningBalances(nonVat, OPEN)).toThrow(/ไม่จด VAT/);
  });

  it('tampering the opening service item (VAT on a goods item) is detected', () => {
    const o = setOpeningBalances(blank(), OPEN).state;
    const t = clone(o);
    delete t.sales[0].saleType;
    expect(validateAccountingData(t).join()).toMatch(/ต้องไม่คิด VAT/);
  });
});

// ---------------- D4 ยอดยกมาสิ้นเดือน / U12 เลขที่ยอดยกมา ----------------

describe('D4 + U12 opening date and numbers', () => {
  const OPEN = {
    date: '2026-09-30',
    vatCredit: 0,
    whtReceivable: 0,
    receivableControl: 1000,
    payableControl: 0,
    lines: [{ accountCode: ACC.retained, debit: 0, credit: 1000 }],
    receivables: [{ contactId: 'c-abc', docNo: 'INV-OLD-1', date: '2026-09-15', dueDate: '2026-10-15', amount: 1000 }],
    payables: [],
  };

  it('opening date must be a month end; existing mid-month data stays valid', () => {
    expect(() => setOpeningBalances(blank(), { ...OPEN, date: '2026-09-15' })).toThrow(/วันสิ้นเดือน/);
    const ok = setOpeningBalances(blank(), OPEN).state;
    // ข้อมูลเดิมที่ยกยอดกลางเดือน (ก่อนกติกา D4) ยังผ่านการตรวจ
    const legacy = clone(ok);
    const opening = legacy.openingBalance as OpeningBalance;
    opening.date = '2026-09-20';
    legacy.journal.forEach((e) => {
      if (e.id === opening.journalId) e.date = '2026-09-20';
    });
    expect(validateAccountingData(legacy)).toEqual([]);
  });

  it('F6: opening numbers in this system’s format are rejected; a tampered collision is detected', () => {
    ['IV6910-0001', 'iv6910-0001', 'PV6909-0003'].forEach((docNo) =>
      expect(() => setOpeningBalances(blank(), { ...OPEN, receivables: [{ ...OPEN.receivables[0], docNo }] })).toThrow(/รูปแบบเลขที่ของระบบ/)
    );
    const s = setOpeningBalances(blank(), OPEN).state;
    const iv = issueTaxInvoice(s, { date: '2026-10-02', dueDate: '2026-10-02', contactId: 'c-abc', vatMode: 'exclusive', lines: [ln(1, 100)] });
    const t = clone(iv.state);
    const openingDoc = t.sales.find((x) => x.opening);
    if (!openingDoc) throw new Error('missing');
    openingDoc.docNo = iv.doc.docNo;
    expect(validateAccountingData(t).join()).toMatch(/ซ้ำกับเลขที่เอกสารของระบบ/);
  });
});

// ---------------- U3 ตัวระบุบริษัท ----------------

describe('U3 company identity', () => {
  it('taxId / branch cannot change once documents are issued; formatting and other fields can', () => {
    const s = demo();
    expect(() => updateCompany(s, { ...s.company, taxId: '0105561098763' })).toThrow(/เปลี่ยนเลขประจำตัวผู้เสียภาษี/);
    expect(() => updateCompany(s, { ...s.company, branchNo: '00001' })).toThrow(/สาขา/);
    const dashed = s.company.taxId.replace(/^(\d)(\d{4})(\d{5})(\d{2})(\d)$/, '$1-$2-$3-$4-$5');
    expect(updateCompany(s, { ...s.company, taxId: dashed, name: 'ชื่อใหม่' }).company.name).toBe('ชื่อใหม่');
    expect(updateCompany(blank(), { ...blank().company, taxId: '0105561098763' }).company.taxId).toBe('0105561098763');
  });

  it('B5: restoring an older backup with company.taxId edited is refused by the store', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    const store = createAccountingStore({ storage, fallback: demo });
    const older = clone(store.getSnapshot().data);
    store.run((st) => ({ state: lockPeriod(st, '2026-09-30', TODAY) }));
    store.run((st) => issueTaxInvoice(st, { date: D, dueDate: D, contactId: 'c-abc', vatMode: 'exclusive', lines: [ln(1, 5000)] }));
    older.company.taxId = '0105565099999';
    expect(() => store.replace(older)).toThrow(/กู้คืนไม่ได้/);
    expect(store.getSnapshot().data.company.lockedThrough).toBe('2026-09-30');
    expect(map.has(STORAGE_KEY)).toBe(true);
  });
});

// ---------------- U8 ฐานหัก ณ ที่จ่ายรายบรรทัด ----------------

describe('U8 supplier credit note reduces the WHT base of the credited lines only', () => {
  it('D3: crediting the goods line keeps the service WHT at 300', () => {
    const r = purchase(demo(), 'D3', [pln(1, 10000, ACC.professional, ['ค่าบริการ', 3]), pln(1, 10000, ACC.cogs)]);
    const cn = supplierCredit(r.state, r.doc.id, 'SCN-D3', [ln(1, 10000, ACC.cogs)]);
    expect(purchaseAdjustedWhtGroups(cn.state, r.doc)).toEqual([{ incomeType: 'ค่าบริการ', rate: 3, base: 10000, tax: 300 }]);
    const paid = payPurchase(cn.state, { purchaseId: r.doc.id, date: D, accountCode: ACC.bank });
    expect(paid.payment).toMatchObject({ amount: 10700, whtAmount: 300 });
    expect(validateAccountingData(paid.state)).toEqual([]);
  });

  it('D2: partial pay → credit on the service line → final pay: no negative WHT and Σ = adjusted base', () => {
    const r = purchase(demo(), 'D2', [
      pln(1, 10000, ACC.professional, ['ค่าบริการ', 3]),
      pln(1, 2000, ACC.freight, ['ค่าขนส่ง', 1]),
      pln(1, 5000, ACC.cogs),
    ]);
    let s = payPurchase(r.state, { purchaseId: r.doc.id, date: D, accountCode: ACC.bank, amount: 7777.77 }).state;
    s = supplierCredit(s, r.doc.id, 'SCN-D2', [ln(1, 3333.33, ACC.professional)]).state;
    // ครั้งถัดไปแบ่งจ่าย: ฐานคงเหลือ × ยอดจ่าย ÷ ยอดค้าง
    const outstanding = purchaseOutstanding(s, r.doc);
    s = payPurchase(s, { purchaseId: r.doc.id, date: '2026-11-01', accountCode: ACC.bank, amount: 3000 }).state;
    s = payPurchase(s, { purchaseId: r.doc.id, date: '2026-11-02', accountCode: ACC.bank }).state;
    const items = s.payments.filter((p) => p.purchaseId === r.doc.id).flatMap((p) => p.whtItems);
    expect(items.every((i) => i.base >= 0 && i.tax >= 0)).toBe(true);
    const base = (rate: number) => Math.round(items.filter((i) => i.rate === rate).reduce((a, i) => a + i.base * 100, 0)) / 100;
    expect([base(3), base(1)]).toEqual([6666.67, 2000]);
    expect(outstanding).toBeGreaterThan(3000);
    expect(validateAccountingData(s)).toEqual([]);
  });

  it('purchaseLineId targets a line; over-crediting a line or a missing line is rejected', () => {
    const r = purchase(demo(), 'L1', [pln(1, 6000, ACC.misc, ['ค่าบริการ', 3]), pln(1, 4000, ACC.misc)]);
    const [svc, goods] = r.doc.lines;
    const cn = recordSupplierCreditNote(r.state, {
      purchaseId: r.doc.id,
      supplierCreditNoteNo: 'L1-CN',
      supplierCreditNoteDate: D,
      date: D,
      reason: 'คืนของ',
      lines: [{ ...ln(1, 4000, ACC.misc), purchaseLineId: goods.id }],
    });
    expect(purchaseAdjustedWhtGroups(cn.state, r.doc)[0]).toMatchObject({ base: 6000, tax: 180 });
    // ไม่ระบุบรรทัด + บัญชีเดียวกันหลายบรรทัด: เติมบรรทัดแรกก่อน
    expect(purchaseCreditAllocation(r.doc, [{ docNo: 'x', lines: [ln(1, 1000, ACC.misc)], vatMode: 'exclusive', vatRate: 7 }]).reduced).toEqual([
      1000, 0,
    ]);
    const over = { ...ln(1, 4000.01, ACC.misc), purchaseLineId: goods.id };
    expect(() =>
      recordSupplierCreditNote(r.state, { purchaseId: r.doc.id, supplierCreditNoteNo: 'L1-X', supplierCreditNoteDate: D, date: D, reason: 'x', lines: [over] })
    ).toThrow(/เกินมูลค่าของบรรทัด/);
    expect(() =>
      recordSupplierCreditNote(r.state, {
        purchaseId: r.doc.id,
        supplierCreditNoteNo: 'L1-Y',
        supplierCreditNoteDate: D,
        date: D,
        reason: 'x',
        lines: [{ ...ln(1, 10, ACC.misc), purchaseLineId: 'gone' }],
      })
    ).toThrow(/ไม่พบบรรทัด/);
    expect(svc.whtRate).toBe(3);
    // แก้ไฟล์ให้ใบลดหนี้อ้างบรรทัดที่ไม่มี → ตรวจพบ
    const t = clone(cn.state);
    const c = t.purchaseCredits.find((x) => x.supplierCreditNoteNo === 'L1-CN');
    if (!c) throw new Error('missing');
    c.lines[0].purchaseLineId = 'gone';
    expect(validateAccountingData(t).join()).toMatch(/ไม่พบบรรทัดของเอกสารซื้อ/);
  });
});

// ---------------- D1 ใบลดหนี้ผู้ขายหลังจ่าย + รับเงินคืน ----------------

describe('D1 supplier credit note on paid purchases and supplier refunds (1150)', () => {
  const setup = () => {
    const r = purchase(demo(), 'P-PAID', [pln(1, 10000, ACC.professional, ['ค่าบริการ', 3])]);
    const paid = payPurchase(r.state, { purchaseId: r.doc.id, date: D, accountCode: ACC.bank });
    return { s: paid.state, id: r.doc.id, doc: r.doc };
  };

  it('credit after full payment → 1150, WHT kept with a warning, refund received later', () => {
    const { s, id, doc } = setup();
    const cn = supplierCredit(s, id, 'SCN-PAID', [ln(1, 1000, ACC.professional)], '2026-10-26');
    expect(cn.doc.refundDue).toBe(1070);
    expect(cn.warnings.join()).toMatch(/หักภาษี ณ ที่จ่ายไปแล้ว 300.00/);
    expect(cn.warnings.join()).toMatch(/1150/);
    const entry = cn.state.journal.find((e) => e.id === cn.doc.journalId);
    expect(entry?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: ACC.supplierRefundReceivable, debit: 1070 }),
        expect.objectContaining({ accountCode: ACC.inputVat, credit: 70 }),
      ])
    );
    expect(entry?.lines.some((l) => l.accountCode === ACC.payable)).toBe(false);
    expect(purchaseOutstanding(cn.state, doc)).toBe(0);
    expect(supplierRefundDueOf(cn.state, 'v-resin')).toBe(1070);
    expect(validateAccountingData(cn.state)).toEqual([]);

    expect(() => receiveSupplierRefund(cn.state, { contactId: 'v-resin', date: '2026-10-25', amount: 1070, accountCode: ACC.bank })).toThrow(
      /ลงวันที่หลังวันรับเงิน/
    );
    expect(() => receiveSupplierRefund(cn.state, { contactId: 'v-resin', date: '2026-10-27', amount: 1070.01, accountCode: ACC.bank })).toThrow(
      /เกินยอดเงินคืน/
    );
    expect(() => receiveSupplierRefund(cn.state, { contactId: 'v-resin', date: '2026-10-27', amount: 100, accountCode: ACC.receivable })).toThrow(
      /ใช้รับ\/จ่ายเงินไม่ได้/
    );
    const got = receiveSupplierRefund(cn.state, { contactId: 'v-resin', date: '2026-10-27', amount: 1070, accountCode: ACC.bank, note: 'โอนคืน' });
    expect(got.refund.docNo).toBe('SR6910-0001');
    expect(supplierRefundDueOf(got.state, 'v-resin')).toBe(0);
    expect(balanceOf(trialBalance(got.state.accounts, got.state.journal), ACC.supplierRefundReceivable)).toBe(0);
    expect(validateAccountingData(got.state)).toEqual([]);
    // เลข SR เรียงตามวันที่
    const again = supplierCredit(got.state, id, 'SCN-PAID-2', [ln(1, 500, ACC.professional)], '2026-10-28').state;
    expect(() => receiveSupplierRefund(again, { contactId: 'v-resin', date: '2026-10-26', amount: 1, accountCode: ACC.bank })).toThrow(
      /เรียงตามวันที่|ลงวันที่หลัง/
    );
    // manual JV ลง 1150 ไม่ได้ (บัญชีคุม)
    expect(() =>
      addManualJournal(got.state, {
        date: '2026-10-28',
        description: 'x',
        lines: [
          { accountCode: ACC.supplierRefundReceivable, debit: 1, credit: 0 },
          { accountCode: ACC.bank, debit: 0, credit: 1 },
        ],
      })
    ).toThrow(/บัญชีคุม/);
  });

  it('partly paid: the part above the outstanding becomes the refund; cap = total − prior credits', () => {
    const r = purchase(demo(), 'P-PART', [pln(1, 10000, ACC.cogs)]);
    const part = payPurchase(r.state, { purchaseId: r.doc.id, date: D, accountCode: ACC.bank, amount: 8000 }).state;
    const cn = supplierCredit(part, r.doc.id, 'SCN-PART', [ln(1, 5000, ACC.cogs)]);
    expect(cn.doc.refundDue).toBe(2650);
    expect(cn.warnings.join()).not.toMatch(/หักภาษี ณ ที่จ่าย/);
    expect(cn.state.purchases.find((p) => p.id === r.doc.id)?.paid).toBe(true);
    expect(() => supplierCredit(cn.state, r.doc.id, 'SCN-PART-2', [ln(1, 5000.01, ACC.cogs)])).toThrow(/เกินยอดที่ลดได้/);
    expect(validateAccountingData(cn.state)).toEqual([]);
    // แก้ไฟล์: เงินคืนจากผู้ขายเกินยอดใบลดหนี้ → ตรวจพบ
    const t = clone(cn.state);
    t.purchaseCredits[t.purchaseCredits.length - 1].refundDue = 9999;
    expect(validateAccountingData(t).length).toBeGreaterThan(0);
  });

  it('E4: the same supplier CN number through a second contact with the same taxId is rejected', () => {
    let s = demo();
    const resin = s.contacts.find((c) => c.id === 'v-resin');
    if (!resin) throw new Error('missing');
    s = { ...s, contacts: [...s.contacts, { ...resin, id: 'v-resin2', code: 'V-RESIN2' }] };
    const a = purchase(s, 'E4-a', [pln(1, 10000, ACC.cogs)]);
    const b = recordPurchase(a.state, {
      supplierInvoiceNo: 'E4-b',
      supplierInvoiceDate: D,
      vatClaimPeriod: D.slice(0, 7),
      date: D,
      contactId: 'v-resin2',
      vatMode: 'exclusive',
      claimVat: true,
      whtCondition: '1',
      lines: [pln(1, 10000, ACC.cogs)],
    });
    const first = supplierCredit(b.state, a.doc.id, 'SCN-777', [ln(1, 1000, ACC.cogs)]).state;
    expect(() => supplierCredit(first, b.doc.id, 'scn 777', [ln(1, 1000, ACC.cogs)])).toThrow(/บันทึกไปแล้ว.*เลขผู้เสียภาษีเดียวกัน/);
  });
});

// ---------------- U9 เงินสดย่อยติดลบ ----------------

describe('U9 petty cash cannot go negative through a manual JV', () => {
  const funded = () => transferFunds(demo(), { date: D, fromAccountCode: ACC.bank, toAccountCode: ACC.pettyCash, amount: 5000 }).state;

  it('H2: crediting petty cash beyond its balance is rejected; within balance / debit is fine', () => {
    const s = funded();
    const jv = (amount: number, side: 'debit' | 'credit') =>
      addManualJournal(s, {
        date: D,
        description: 'เบิก',
        lines: [
          { accountCode: ACC.misc, debit: side === 'credit' ? amount : 0, credit: side === 'debit' ? amount : 0 },
          { accountCode: ACC.pettyCash, debit: side === 'debit' ? amount : 0, credit: side === 'credit' ? amount : 0 },
        ],
      });
    expect(() => jv(9000, 'credit')).toThrow(/เงินสดย่อย .* คงเหลือไม่พอ/);
    expect(cashBalanceOf(jv(5000, 'credit').state, ACC.pettyCash)).toBe(0);
    expect(cashBalanceOf(jv(100, 'debit').state, ACC.pettyCash)).toBe(5100);
    // ธนาคารเบิกเกินบัญชีได้
    expect(() =>
      addManualJournal(s, {
        date: D,
        description: 'ค่าธรรมเนียม',
        lines: [
          { accountCode: ACC.misc, debit: 9e6, credit: 0 },
          { accountCode: ACC.bank, debit: 0, credit: 9e6 },
        ],
      })
    ).not.toThrow();
  });

  it('integrity flags a negative petty-cash balance written into the file', () => {
    const s = funded();
    const t = clone(s);
    const tr = t.journal.find((e) => e.source === 'transfer');
    if (!tr) throw new Error('missing');
    tr.lines = tr.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
    t.transfers[0] = { ...t.transfers[0], fromAccountCode: ACC.pettyCash, toAccountCode: ACC.bank };
    expect(validateAccountingData(t).join()).toMatch(/เงินสดย่อยติดลบ/);
  });
});

// ---------------- U10 v1 ที่หัก ณ ที่จ่ายปัดเป็น 0 ----------------

describe('U10 migrated payments whose WHT rounds to 0', () => {
  const tinyState = () => {
    const r = recordPurchase(demo(), {
      supplierInvoiceNo: 'S-TINY',
      date: D,
      contactId: 'v-somsri',
      vatMode: 'none',
      claimVat: false,
      whtCondition: '1',
      lines: [pln(1, 0.1, ACC.professional, ['ค่าบริการ', 3])],
    });
    return payPurchase(r.state, { purchaseId: r.doc.id, date: '2026-10-26', accountCode: ACC.cash });
  };

  it('M1/M5: v1 file migrates without problems (app not read-only) and PND keeps the 0.00 row', () => {
    const { state, payment } = tinyState();
    expect(payment.whtItems).toEqual([{ incomeType: 'ค่าบริการ', rate: 3, base: 0.1, tax: 0 }]);
    const result = readAccountingData(JSON.parse(JSON.stringify(toV1(state))));
    expect(result.migratedFrom).toBe(1);
    expect(result.problems).toEqual([]);
    const data = result.data as AccountingData;
    const pv = data.payments.find((p) => p.whtAmount === 0 && p.whtItems.some((i) => i.base === 0.1));
    expect(pv?.whtItems).toEqual([{ incomeType: 'ค่าบริการ', rate: 3, base: 0.1, tax: 0 }]);
    const legal = data.contacts.find((c) => c.id === 'v-somsri')?.legalForm === 'individual' ? 'PND3' : 'PND53';
    const rows = whtPayeesForPeriod(data, { year: 2026, month: 10 }, legal).flatMap((p) => p.items);
    expect(rows.find((i) => i.amount === 0.1)).toMatchObject({ tax: 0, certNo: undefined });

    const map = new Map<string, string>([[STORAGE_KEY, JSON.stringify(toV1(state))]]);
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    const store = createAccountingStore({ storage, fallback: demo });
    expect(store.getSnapshot()).toMatchObject({ readOnly: false, problems: [] });
    expect(store.getSnapshot().data.version).toBe(7);
  });

  it('v6 data already migrated with the empty whtItems is repaired by v6 → v7', () => {
    const { state, payment } = tinyState();
    const broken = clone(state);
    const pv = broken.payments.find((p) => p.id === payment.id);
    if (!pv) throw new Error('missing');
    pv.whtItems = [];
    expect(validateAccountingData(broken).join()).toMatch(/ในใบสำคัญจ่ายรวมไม่ตรงกับเอกสาร/);
    const result = readAccountingData(JSON.parse(JSON.stringify(toV6(broken))));
    expect(result.migratedFrom).toBe(6);
    expect(result.problems).toEqual([]);
    expect(result.data?.payments.find((p) => p.id === payment.id)?.whtItems).toEqual(payment.whtItems);
    expect(result.data?.supplierRefunds).toEqual([]);
    expect(result.data?.accounts.find((a) => a.code === ACC.supplierRefundReceivable)).toMatchObject({ type: 'asset', system: true });
    expect(readAccountingData({ ...toV6(broken), quotations: undefined }).problems[0]).toMatch(/เวอร์ชัน 6 ไม่ครบ/);
  });
});

// ---------------- U11 รหัสเหตุผล e-Tax ----------------

describe('U11 e-Tax purpose codes', () => {
  it('P3: service credit notes use CDNS99, goods use CDNG99', () => {
    expect(eTaxPurposeCode({ kind: 'credit-note', saleType: 'service' })).toBe('CDNS99');
    expect(eTaxPurposeCode({ kind: 'debit-note', saleType: 'service' })).toBe('DBNS99');
    expect(eTaxPurposeCode({ kind: 'credit-note' })).toBe('CDNG99');
    expect(eTaxPurposeCode({ kind: 'debit-note', saleType: 'goods' })).toBe('DBNG99');
    const i = issueTaxInvoice(demo(), { date: D, dueDate: D, contactId: 'c-abc', lines: [ln(1, 1000, ACC.service)], vatMode: 'exclusive', saleType: 'service' });
    const s = receivePayment(i.state, { invoiceId: i.doc.id, date: D, amount: 1070, whtAmount: 0, depositAccountCode: ACC.bank }).state;
    const cn = issueCreditNote(s, { invoiceId: i.doc.id, date: D, reason: 'ลดค่าบริการ', lines: [ln(1, 100, ACC.service)] });
    const xml = buildETaxXml({ doc: cn.doc, company: cn.state.company, referenced: i.doc, referencedReceipt: cn.state.receipts[cn.state.receipts.length - 1] });
    expect(xml).toContain('<ram:PurposeCode>CDNS99</ram:PurposeCode>');
  });
});

// ---------------- U12 legacyOrderThrough / ภาษีขายในใบเสร็จ ----------------

describe('U12 integrity: legacy exemption cap and receipt VAT replay', () => {
  it('B7: a far-future legacyOrderThrough cannot hide swapped invoice dates', () => {
    let s = demo();
    const a = issueTaxInvoice(s, { date: '2026-10-26', dueDate: '2026-10-26', contactId: 'c-abc', vatMode: 'exclusive', lines: [ln(1, 100)] });
    s = issueTaxInvoice(a.state, { date: '2026-10-28', dueDate: '2026-10-28', contactId: 'c-abc', vatMode: 'exclusive', lines: [ln(1, 200)] }).state;
    const t = clone(s);
    const [x, y] = t.sales.filter((d) => d.docNo.startsWith('IV6910')).slice(-2);
    const jx = t.journal.find((e) => e.id === x.journalId);
    const jy = t.journal.find((e) => e.id === y.journalId);
    if (!jx || !jy) throw new Error('missing');
    [x.date, y.date] = [y.date, x.date];
    [jx.date, jy.date] = [jy.date, jx.date];
    [x.dueDate, y.dueDate] = [y.dueDate, x.dueDate];
    expect(validateAccountingData(t).length).toBeGreaterThan(0);
    expect(validateAccountingData({ ...t, legacyOrderThrough: '2099-12-31' }).join()).toMatch(/ไฟล์ถูกแก้ไข/);
    expect(validateAccountingData({ ...s, legacyOrderThrough: '2026-01-01' }).join()).toMatch(/ไฟล์ถูกแก้ไข/);
  });

  it('C6: moving output VAT between two receipts (total preserved) is detected', () => {
    const i = issueTaxInvoice(demo(), { date: D, dueDate: D, contactId: 'c-abc', lines: [ln(1, 10000, ACC.service)], vatMode: 'exclusive', saleType: 'service' });
    let s = receivePayment(i.state, { invoiceId: i.doc.id, date: D, amount: 5350, whtAmount: 0, depositAccountCode: ACC.bank }).state;
    s = receivePayment(s, { invoiceId: i.doc.id, date: '2026-11-05', amount: 5350, whtAmount: 0, depositAccountCode: ACC.bank }).state;
    expect(validateAccountingData(s)).toEqual([]);
    const t = clone(s);
    const [r1, r2] = t.receipts.filter((r) => r.invoiceId === i.doc.id);
    const shift = (rc: typeof r1, d: number) => {
      rc.vat = Math.round(((rc.vat ?? 0) + d) * 100) / 100;
      t.journal
        .find((e) => e.id === rc.journalId)
        ?.lines.forEach((l) => {
          if (l.accountCode === ACC.outputVat) l.credit = Math.round((l.credit + d) * 100) / 100;
          if (l.accountCode === ACC.deferredOutputVat) l.debit = Math.round((l.debit + d) * 100) / 100;
        });
    };
    shift(r1, -300);
    shift(r2, 300);
    expect(validateAccountingData(t).join()).toMatch(/ไม่ตรงกับสัดส่วนภาษีรอตัด/);
  });
});

// ---------------- D2 / D3 helper ----------------

describe('D2 credit note after customer WHT, D3 quotation variance', () => {
  it('creditNoteWhtNote explains that 1160 stays a tax credit (behaviour unchanged)', () => {
    const i = issueTaxInvoice(demo(), { date: D, dueDate: D, contactId: 'c-abc', lines: [ln(1, 10000, ACC.service)], vatMode: 'exclusive' });
    expect(creditNoteWhtNote(i.state, i.doc)).toBeNull();
    const r = receivePayment(i.state, { invoiceId: i.doc.id, date: D, amount: 10700, whtAmount: 300, depositAccountCode: ACC.bank });
    expect(creditNoteWhtNote(r.state, i.doc)).toMatch(/300.00.*2120.*1160/);
    const cn = issueCreditNote(r.state, { invoiceId: i.doc.id, date: D, reason: 'ลด', lines: [ln(1, 1000, ACC.service)] });
    expect(cn.doc.creditToCustomer).toBe(1070);
    expect(balanceOf(trialBalance(cn.state.accounts, cn.state.journal), ACC.whtReceivable)).toBe(
      balanceOf(trialBalance(r.state.accounts, r.state.journal), ACC.whtReceivable)
    );
  });

  it('quotationVariance lists total and line differences without blocking', () => {
    const q = saveQuotation(demo(), { date: D, validDays: 30, contactId: 'c-abc', vatMode: 'exclusive', lines: [ln(2, 500), ln(1, 300)] }).quotation;
    const same = quotationVariance(q, { lines: q.lines, vatMode: q.vatMode });
    expect(same).toMatchObject({ hasDifference: false, totalDiff: 0, lines: [] });
    const v = quotationVariance(q, { lines: [{ ...q.lines[0], unitPrice: 999999 }, ...[], ln(1, 50)], vatMode: 'inclusive' });
    expect(v.hasDifference).toBe(true);
    expect(v.vatModeChanged).toBe(true);
    expect(v.lines.map((l) => [l.index, l.kind])).toEqual([
      [0, 'changed'],
      [1, 'changed'],
    ]);
    expect(quotationVariance(q, { lines: [q.lines[0]], vatMode: 'exclusive' }).lines).toEqual([
      { index: 1, kind: 'removed', description: q.lines[1].description, quoted: 300 },
    ]);
    expect(quotationVariance(q, { lines: [...q.lines, ln(1, 10)], vatMode: 'exclusive' }).totalDiff).toBe(10.7);
  });
});
