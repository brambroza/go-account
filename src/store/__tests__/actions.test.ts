import { ACC, isBalanced, trialBalance, salesVatReport, whtPayeesForPeriod } from 'src/domain';

import { buildDemoData } from '../seed';
import { outstandingOf, receivePayment, issueCreditNote, BusinessRuleError } from '../actions';

// ----------------------------------------------------------------------

describe('demo data and actions', () => {
  const data = buildDemoData('2026-10-24');

  it('builds a consistent ledger', () => {
    expect(data.journal.every((e) => isBalanced(e.lines))).toBe(true);
    const tb = trialBalance(data.accounts, data.journal);
    const debit = tb.reduce((s, r) => s + Math.round(r.debit * 100), 0);
    const credit = tb.reduce((s, r) => s + Math.round(r.credit * 100), 0);
    expect(debit).toBe(credit);
  });

  it('numbers documents per month without gaps', () => {
    const october = data.sales.filter((s) => s.kind === 'tax-invoice' && s.date.startsWith('2026-10'));
    expect(october.map((s) => s.docNo)).toEqual(['IV6910-0001', 'IV6910-0002', 'IV6910-0003', 'IV6910-0004']);
  });

  it('feeds the tax reports for the current month', () => {
    const rows = salesVatReport(data.sales, data.contacts, { year: 2026, month: 10 });
    expect(rows.some((r) => r.kind === 'credit-note' && r.vat < 0)).toBe(true);
    const pnd3 = whtPayeesForPeriod(data.purchases, data.contacts, { year: 2026, month: 10 }, 'PND3');
    expect(pnd3.map((p) => p.contact.name).sort()).toEqual(['สมชาย', 'สมศรี']);
  });

  it('blocks over-receipt and over-credit with a clear message', () => {
    const invoice = data.sales.find((s) => s.kind === 'tax-invoice' && s.status === 'issued')!;
    const outstanding = outstandingOf(data, invoice);
    expect(() =>
      receivePayment(data, {
        invoiceId: invoice.id,
        date: '2026-10-24',
        amount: outstanding + 1,
        whtAmount: 0,
        depositAccountCode: ACC.bank,
      })
    ).toThrow(BusinessRuleError);
    expect(() =>
      issueCreditNote(data, {
        invoiceId: invoice.id,
        date: '2026-10-24',
        reason: 'ทดสอบ',
        lines: [{ id: 'x', description: 'x', qty: 1, unitPrice: outstanding, discount: 0, accountCode: ACC.sales }],
      })
    ).toThrow(/เกินยอดค้างชำระ/);
  });

  it('marks an invoice paid after full receipt', () => {
    const invoice = data.sales.find((s) => s.kind === 'tax-invoice' && s.status === 'issued')!;
    const outstanding = outstandingOf(data, invoice);
    const next = receivePayment(data, {
      invoiceId: invoice.id,
      date: '2026-10-24',
      amount: outstanding,
      whtAmount: 0,
      depositAccountCode: ACC.bank,
    }).state;
    expect(next.sales.find((s) => s.id === invoice.id)?.status).toBe('paid');
  });
});
