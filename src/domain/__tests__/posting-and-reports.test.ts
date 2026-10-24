import { nextDocNo } from '../numbering';
import { ACC , DEFAULT_ACCOUNTS } from '../chart-of-accounts';
import { bucketOf, trialBalance, profitAndLoss } from '../ledger';
import { pp30Summary, vatReportCsv, salesVatReport, purchaseVatReport } from '../vat-report';
import { toRdDate, shiftPeriod, docPeriodCode, filingDueDates, formatThaiDate } from '../thai-date';
import { entryTotals, postReceipt, postPurchase, postCreditNote, postSalesInvoice, buildManualEntry, postPurchasePayment, UnbalancedEntryError } from '../posting';

import type { Contact, SalesDoc, PurchaseDoc } from '../types';

// ----------------------------------------------------------------------

const customer: Contact = {
  id: 'c1',
  code: 'C0001',
  kind: 'customer',
  legalForm: 'juristic',
  title: 'บริษัท',
  name: 'เอบีซี ออโต้พาร์ท จำกัด',
  taxId: '0105565012341',
  branchNo: '00000',
  address: { province: 'กรุงเทพมหานคร' },
  creditDays: 30,
};

const vendor: Contact = {
  ...customer,
  id: 'v1',
  code: 'V0001',
  kind: 'vendor',
  name: 'ขนส่งด่วน จำกัด',
  taxId: '0105559076545',
};

const invoice: SalesDoc = {
  id: 's1',
  kind: 'tax-invoice',
  docNo: 'IV6910-0001',
  date: '2026-10-21',
  dueDate: '2026-11-20',
  contactId: 'c1',
  lines: [{ id: 'l1', description: 'ชิ้นส่วน', qty: 1, unitPrice: 251000, discount: 0, accountCode: ACC.sales }],
  vatMode: 'exclusive',
  vatRate: 7,
  status: 'issued',
  paidAmount: 0,
  etax: 'pending-sign',
  journalId: 'j1',
  createdAt: '2026-10-21T00:00:00Z',
};

const creditNote: SalesDoc = {
  ...invoice,
  id: 's2',
  kind: 'credit-note',
  docNo: 'CN6910-0001',
  date: '2026-10-25',
  refDocId: 's1',
  reason: 'คืนสินค้าชำรุด',
  lines: [{ ...invoice.lines[0], unitPrice: 1000 }],
};

const purchase: PurchaseDoc = {
  id: 'p1',
  docNo: 'PI6910-0001',
  supplierInvoiceNo: 'INV-7788',
  date: '2026-10-18',
  contactId: 'v1',
  lines: [{ id: 'l1', description: 'ค่าขนส่ง', qty: 1, unitPrice: 20000, discount: 0, accountCode: ACC.freight }],
  vatMode: 'exclusive',
  vatRate: 7,
  claimVat: true,
  whtRate: 1,
  whtIncomeType: 'ค่าขนส่ง',
  whtCondition: '1',
  paid: true,
  paidDate: '2026-10-28',
  journalId: 'j3',
  createdAt: '2026-10-18T00:00:00Z',
};

const october = { year: 2026, month: 10 };

describe('posting engine', () => {
  it('posts a balanced sales invoice', () => {
    const e = postSalesInvoice(invoice, { id: 'j1', docNo: 'JV6910-0001' }, 'เอบีซี');
    expect(entryTotals(e.lines)).toEqual({ debit: 268570, credit: 268570 });
    expect(e.lines.find((l) => l.accountCode === ACC.outputVat)?.credit).toBe(17570);
  });

  it('reverses revenue and VAT on a credit note', () => {
    const e = postCreditNote(creditNote, { id: 'j2', docNo: 'JV6910-0002' }, 'เอบีซี');
    expect(e.lines.find((l) => l.accountCode === ACC.outputVat)?.debit).toBe(70);
    expect(e.lines.find((l) => l.accountCode === ACC.receivable)?.credit).toBe(1070);
  });

  it('splits a receipt into bank and withholding receivable', () => {
    const e = postReceipt(
      {
        id: 'r1',
        docNo: 'RE6910-0001',
        date: '2026-10-20',
        invoiceId: 's1',
        contactId: 'c1',
        amount: 105395,
        whtAmount: 2955,
        depositAccountCode: ACC.bank,
        journalId: 'j4',
      },
      { id: 'j4', docNo: 'JV6910-0004' },
      'ไทยรุ่ง',
      'IV6910-0034'
    );
    expect(e.lines.find((l) => l.accountCode === ACC.bank)?.debit).toBe(102440);
    expect(e.lines.find((l) => l.accountCode === ACC.whtReceivable)?.debit).toBe(2955);
  });

  it('posts purchase and payment with withholding payable', () => {
    const p = postPurchase(purchase, { id: 'j3', docNo: 'JV6910-0003' }, 'ขนส่งด่วน');
    expect(entryTotals(p.lines).debit).toBe(21400);
    const pay = postPurchasePayment(purchase, { id: 'j5', docNo: 'JV6910-0005' }, 'ขนส่งด่วน', ACC.bank, '2026-10-28');
    expect(pay.lines.find((l) => l.accountCode === ACC.bank)?.credit).toBe(21200);
    expect(pay.lines.find((l) => l.accountCode === ACC.whtPayable)?.credit).toBe(200);
  });

  it('adds non-claimable VAT to the expense', () => {
    const p = postPurchase({ ...purchase, claimVat: false }, { id: 'j6', docNo: 'JV' }, 'ขนส่งด่วน');
    expect(p.lines.find((l) => l.accountCode === ACC.freight)?.debit).toBe(21400);
    expect(p.lines.find((l) => l.accountCode === ACC.inputVat)).toBeUndefined();
  });

  it('refuses unbalanced manual entries', () => {
    expect(() =>
      buildManualEntry({ id: 'm', docNo: 'JV' }, '2026-10-31', 'ปรับปรุง', [
        { accountCode: ACC.misc, debit: 100, credit: 0 },
        { accountCode: ACC.cash, debit: 0, credit: 90 },
      ])
    ).toThrow(UnbalancedEntryError);
  });
});

describe('reports', () => {
  it('builds VAT reports and the PP30 summary', () => {
    const sales = salesVatReport([invoice, creditNote], [customer], october);
    expect(sales.map((r) => r.vat)).toEqual([17570, -70]);
    const purchases = purchaseVatReport([purchase], [vendor], october);
    expect(purchases[0].docNo).toBe('INV-7788');
    const s = pp30Summary(sales, purchases);
    expect(s.outputVat).toBe(17500);
    expect(s.inputVat).toBe(1400);
    expect(s.netVat).toBe(16100);
    expect(vatReportCsv(sales, 'ภาษีขาย')).toContain('IV6910-0001');
  });

  it('produces a balanced trial balance and P&L', () => {
    const j = [
      postSalesInvoice(invoice, { id: 'j1', docNo: 'JV1' }, 'a'),
      postPurchase(purchase, { id: 'j3', docNo: 'JV3' }, 'b'),
    ];
    const tb = trialBalance(DEFAULT_ACCOUNTS, j);
    const debit = tb.reduce((s, r) => s + r.debit, 0);
    const credit = tb.reduce((s, r) => s + r.credit, 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
    const pl = profitAndLoss(DEFAULT_ACCOUNTS, j, '2026-10-01', '2026-10-31');
    expect(pl.netProfit).toBe(231000);
  });

  it('buckets overdue receivables', () => {
    expect(bucketOf(0)).toBe('current');
    expect(bucketOf(15)).toBe('1-30');
    expect(bucketOf(120)).toBe('90+');
  });
});

describe('thai dates and numbering', () => {
  it('formats Buddhist-era dates', () => {
    expect(formatThaiDate('2026-10-24')).toBe('24/10/2569');
    expect(toRdDate('2025-01-01')).toBe('01012568');
    expect(docPeriodCode('2026-10-24')).toBe('6910');
  });

  it('runs document numbers per prefix and period', () => {
    expect(nextDocNo({ IV6910: 42 }, 'IV', '2026-10-24').docNo).toBe('IV6910-0043');
    expect(nextDocNo({ IV6910: 42 }, 'IV', '2026-11-01').docNo).toBe('IV6911-0001');
  });

  it('computes filing due dates for the next month', () => {
    expect(filingDueDates({ year: 2026, month: 12 })).toEqual({ wht: '2027-01-15', vat: '2027-01-23' });
    expect(shiftPeriod({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
});
