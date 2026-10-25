import { buildDemoData } from 'src/store/seed';
import { transferFunds } from 'src/store/actions';

import { ACC } from '../chart-of-accounts';
import { isValidISODate } from '../thai-date';
import { csvCell, vatReportCsv } from '../vat-report';
import { validateAccountingData } from '../integrity';
import { sumBaht, subBaht, prorateBaht } from '../money';
import { VAT_RATE, calcDocument } from '../document-calc';
import { isTaxDocument, salesDocTitle } from '../sales-doc';
import { trialBalance, trialBalanceTotals } from '../ledger';
import { receiptWhtAmount, whtPayeesForPeriod } from '../wht';
import { parseDocNo, openingNumberConflict } from '../numbering';
import { resolveParty, partySnapshot, partyDisplayName } from '../snapshot';
import { outstandingOf, dashboardStats, hasNegativeOutstanding } from '../receivables';

import type { AccountingData } from '../types';

// ----------------------------------------------------------------------

const TODAY = '2026-10-24';

function clone(data: AccountingData): AccountingData {
  return JSON.parse(JSON.stringify(data));
}

describe('validateAccountingData (A3)', () => {
  const data = buildDemoData(TODAY);

  it('passes the demo data', () => {
    expect(validateAccountingData(data)).toEqual([]);
  });

  type Case = [string, (d: AccountingData) => void, RegExp];
  const cases: Case[] = [
    ['unbalanced entry', (d) => { d.journal[0].lines[0].debit += 1; }, /ไม่สมดุล/],
    ['empty entry', (d) => { d.journal[0].lines = []; }, /ไม่มีบรรทัด/],
    ['unknown account', (d) => { d.journal[0].lines[0].accountCode = '9999'; }, /ไม่พบบัญชี 9999/],
    ['negative amount', (d) => { d.journal[0].lines[0].debit = -1; d.journal[0].lines[1].credit = -1; }, /ติดลบ/],
    ['duplicate number', (d) => { d.sales[1].docNo = d.sales[0].docNo; }, /ซ้ำ/],
    ['gap', (d) => { d.receipts[0].docNo = d.receipts[0].docNo.replace('-0001', '-0002'); }, /ไม่ต่อเนื่อง/],
    ['counter mismatch', (d) => { d.sequences.IV6910 = 9; }, /ตัวนับเลขที่ IV6910 = 9/],
    ['orphan counter', (d) => { d.sequences.IV6801 = 3; }, /ไม่พบเอกสาร/],
    ['period mismatch', (d) => { d.sales[0].date = '2026-01-15'; }, /งวดในเลขที่ไม่ตรง/],
    ['bad format', (d) => { d.purchases[0].docNo = 'XX-1'; }, /รูปแบบไม่ถูกต้อง/],
    ['invalid date', (d) => { d.journal[0].date = '2569-08-01'; }, /ไม่ถูกต้อง/],
    ['missing contact', (d) => { d.sales[0].contactId = 'gone'; }, /ไม่พบผู้ติดต่อ/],
    ['missing journal', (d) => { d.purchases[0].journalId = 'gone'; }, /ไม่พบรายการบัญชี/],
    ['credit note without invoice', (d) => { const cn = d.sales.find((s) => s.kind === 'credit-note'); if (cn) cn.refDocId = 'gone'; }, /ไม่พบใบกำกับที่อ้างถึง/],
    ['receipt without invoice', (d) => { d.receipts[0].invoiceId = 'gone'; }, /ไม่พบใบกำกับที่รับชำระ/],
    ['paid without voucher', (d) => { const p = d.purchases.find((x) => x.paid); d.payments = d.payments.filter((pv) => pv.purchaseId !== p?.id); }, /ไม่พบใบสำคัญจ่าย/],
    ['paid flag mismatch', (d) => { const p = d.purchases.find((x) => !x.paid); if (p) p.paid = true; }, /สถานะจ่ายแล้วไม่ตรง/],
    ['voucher WHT items mismatch', (d) => { const pv = d.payments.find((x) => x.whtItems.length); if (pv) pv.whtItems[0].tax += 1; }, /ไม่เท่ากับผลรวมรายการ/],
    ['voucher net mismatch', (d) => { d.payments[0].netPaid += 1; }, /ยอดจ่ายสุทธิ/],
    ['claim window', (d) => { const p = d.purchases.find((x) => x.claimVat); if (p) p.vatClaimPeriod = '2027-12'; }, /ไม่เกิน 6 เดือน/],
    ['claim without supplier date', (d) => { const p = d.purchases.find((x) => x.claimVat); if (p) p.supplierInvoiceDate = undefined; }, /วันที่ในใบกำกับ/],
    ['claim period on non-claim', (d) => { const p = d.purchases.find((x) => !x.claimVat); if (p) p.vatClaimPeriod = '2026-10'; }, /ไม่ขอคืนภาษีซื้อแต่ระบุ/],
    ['line WHT without income type', (d) => { const p = d.purchases.find((x) => x.lines[0].whtRate > 0); if (p) p.lines[0].whtIncomeType = ''; }, /ไม่ระบุประเภทเงินได้/],
    ['credit note values', (d) => { const cn = d.sales.find((s) => s.kind === 'credit-note'); if (cn) cn.correctNet = 1; }, /มูลค่าที่ถูกต้อง/],
    ['voucher without purchase', (d) => { d.payments[0].purchaseId = 'gone'; }, /ไม่พบเอกสารซื้อ/],
    ['refund without contact', (d) => { d.refunds.push({ ...d.receipts[0], id: 'rf', docNo: 'RF6910-0001', contactId: 'gone', accountCode: ACC.bank, journalId: 'gone' }); d.sequences.RF6910 = 1; }, /ไม่พบผู้ติดต่อ/],
    ['over-refund', (d) => { d.refunds.push({ id: 'rf', docNo: 'RF6910-0001', date: TODAY, contactId: 'c-abc', amount: 5, accountCode: ACC.bank, journalId: d.journal[0].id }); d.sequences.RF6910 = 1; }, /คืนเงินลูกค้าเกิน/],
    ['receipt mismatch', (d) => { const inv = d.sales.find((s) => s.paidAmount > 0); if (inv) inv.paidAmount += 1; }, /ไม่ตรงกับใบเสร็จ/],
    ['negative outstanding', (d) => { const inv = d.sales.find((s) => s.status === 'paid'); if (inv) inv.paidAmount *= 2; }, /ติดลบ/],
    ['over-credited', (d) => { const cn = d.sales.find((s) => s.kind === 'credit-note'); if (cn) cn.lines[0].qty = 1e6; }, /ลดหนี้รวมเกิน/],
    ['bad lock date', (d) => { d.company.lockedThrough = '2569-01-01'; }, /วันที่ปิดงวด/],
  ];

  it.each(cases)('detects %s', (_name, mutate, message) => {
    const d = clone(data);
    mutate(d);
    expect(validateAccountingData(d).join('\n')).toMatch(message);
  });
});

describe('domain helpers (A13, A14)', () => {
  it('escapes CSV formula injection', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    ['+1', '-1', '@SUM', '\tx', '\rx'].forEach((v) => expect(csvCell(v).startsWith(`"'`)).toBe(true));
    expect(csvCell('บริษัท "เอ"')).toBe('"บริษัท ""เอ"""');
    const csv = vatReportCsv(
      [{ id: '1', date: TODAY, docNo: 'IV1', contactName: '=cmd|calc', taxId: '', branchNo: '00000', net: -10, vat: -0.7, kind: 'credit-note' }],
      '+title'
    );
    expect(csv).toContain(`"'=cmd|calc"`);
    expect(csv).toContain(`"'+title"`);
    expect(csv).toContain('-10.00,-0.70');
  });

  it('validates ISO dates', () => {
    expect(isValidISODate('2026-10-24')).toBe(true);
    expect(isValidISODate('2028-02-29')).toBe(true);
    ['2569-10-24', '2026-13-01', '2026-02-29', '', '2026-1-1', 20261024, undefined, '2101-01-01'].forEach((v) =>
      expect(isValidISODate(v)).toBe(false)
    );
  });

  it('parses document numbers', () => {
    expect(parseDocNo('IV6910-0043')).toEqual({ prefix: 'IV', period: '6910', seq: 43 });
    expect(parseDocNo('IV-1')).toBeNull();
  });

  it('prorates and subtracts in satang', () => {
    expect(subBaht(0.3, 0.1)).toBe(0.2);
    expect(prorateBaht(100, 1, 3)).toBe(33.33);
    expect(prorateBaht(100, 2, 3)).toBe(66.67);
    expect(prorateBaht(-100, 2, 3)).toBe(-66.67);
    expect(prorateBaht(9_999_999.99, 9_999_999.99, 9_999_999.99)).toBe(9_999_999.99);
    expect(prorateBaht(100, 1, 0)).toBe(0);
  });

  it('computes customer withholding on receipts from the pre-VAT share', () => {
    const totals = calcDocument({ lines: [{ qty: 1, unitPrice: 98500, discount: 0, accountCode: ACC.service }], vatMode: 'exclusive', vatRate: VAT_RATE });
    expect(receiptWhtAmount(totals, totals.total, 3)).toBe(2955);
    expect(receiptWhtAmount(totals, totals.total / 2, 3)).toBe(1477.5);
    expect(receiptWhtAmount(totals, 1000, 0)).toBe(0);
    expect(receiptWhtAmount(totals, 0, 3)).toBe(0);
  });

  it('totals the trial balance and the dashboard', () => {
    const data = buildDemoData(TODAY);
    const t = trialBalanceTotals(trialBalance(data.accounts, data.journal));
    expect(t.balanced).toBe(true);
    expect(t.debit).toBe(t.credit);
    const stats = dashboardStats(data, TODAY);
    expect(stats.receivable).toBeGreaterThan(0);
    expect(stats.unpaidPurchases).toHaveLength(1);
    expect(stats.payable).toBe(333840);
    expect(stats.customerCredits).toBe(0);
    expect(stats.whtPrev).toBe(1680);
    expect(stats.pp30.netVat).toBeGreaterThan(0);
    expect(hasNegativeOutstanding(data)).toBe(false);
    const cn = data.sales.find((s) => s.kind === 'credit-note');
    expect(cn && outstandingOf(data, cn)).toBe(0);
  });

  it('counts every cash and bank account in the dashboard cash total', () => {
    const data = buildDemoData(TODAY);
    const before = dashboardStats(data, TODAY).cash;
    // โอนเข้าเงินสดย่อย 1111 = ย้ายเงินระหว่างบัญชี ยอดเงินสดและเงินฝากรวมต้องไม่เปลี่ยน (เดิมนับเฉพาะ 1110 + 1120 จึงลดลง)
    const next = transferFunds(data, { date: TODAY, fromAccountCode: ACC.bank, toAccountCode: ACC.pettyCash, amount: 1_000 }).state;
    const stats = dashboardStats(next, TODAY);
    expect(stats.cash).toBe(before);
    const cashRows = trialBalance(next.accounts, next.journal, TODAY).filter((r) => /^11[12]\d$/.test(r.account.code));
    expect(cashRows.map((r) => r.account.code)).toContain(ACC.pettyCash);
    expect(stats.cash).toBe(sumBaht(cashRows.map((r) => r.balance)));
  });

  it('names documents by tax status', () => {
    expect(isTaxDocument({ vatMode: 'none' })).toBe(false);
    expect(isTaxDocument({ vatMode: 'exclusive' })).toBe(true);
    expect(salesDocTitle({ kind: 'tax-invoice', vatMode: 'exclusive' })).toBe('ใบแจ้งหนี้/ใบกำกับภาษี');
    expect(salesDocTitle({ kind: 'credit-note', vatMode: 'exclusive', isTaxInvoice: true })).toBe('ใบลดหนี้/ใบกำกับภาษี');
    expect(salesDocTitle({ kind: 'tax-invoice', vatMode: 'none', isTaxInvoice: false, opening: true })).toBe('ยอดลูกหนี้ยกมา');
  });

  it('resolves party snapshots', () => {
    const data = buildDemoData(TODAY);
    const c = data.contacts[0];
    expect(resolveParty(undefined, undefined)).toBeUndefined();
    expect(resolveParty(undefined, c)).toEqual(partySnapshot(c));
    expect(partyDisplayName(undefined)).toBe('-');
    const p = data.purchases.find((x) => x.lines.some((l) => l.whtRate > 0) && x.paid);
    if (!p) throw new Error('fixture');
    const pvs = data.payments.filter((pv) => pv.purchaseId === p.id).map((pv) => ({ ...pv, payee: undefined }));
    // ไม่มี snapshot และไม่พบผู้ติดต่อ = ข้าม
    expect(
      whtPayeesForPeriod({ purchases: [{ ...p, supplier: undefined }], payments: pvs, contacts: [] }, { year: 2026, month: 10 }, 'PND3')
    ).toEqual([]);
  });
});

describe('openingNumberConflict', () => {
  it('only system-format numbers the system could still issue conflict', () => {
    expect(openingNumberConflict('IV6910-0001', '2026-09-30')).toBe(true);
    expect(openingNumberConflict(' iv6910-0001 ', '2026-09-30')).toBe(true);
    expect(openingNumberConflict('IV6909-0001', '2026-09-30')).toBe(false);
    expect(openingNumberConflict('IV6908-0001', '2026-09-30')).toBe(false);
    expect(openingNumberConflict('JV6909-0001', '2026-09-30')).toBe(true);
    expect(openingNumberConflict('EX6912-0001', '2026-09-30')).toBe(false);
    expect(openingNumberConflict('INV-001', '2026-09-30')).toBe(false);
    // ข้อมูลเดิมที่ยกยอดกลางเดือน: งวดเดียวกันระบบยังออกต่อได้
    expect(openingNumberConflict('IV6909-0001', '2026-09-20')).toBe(true);
  });
});
