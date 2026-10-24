import { ACC, balanceOf, isBalanced, trialBalance, creditableOf, customerCreditOf, validateAccountingData } from 'src/domain';

import { ln, demo, TODAY } from './fixtures';
import {
  outstandingOf,
  receivePayment,
  issueCreditNote,
  issueTaxInvoice,
  refundCustomerCredit,
} from '../actions';

// ----------------------------------------------------------------------
// B1: ใบลดหนี้หลังรับเงิน — ลดได้ถึงยอดใบกำกับ − ใบลดหนี้ก่อนหน้า ส่วนเกินยอดค้างตั้งเป็นเงินรอคืนลูกค้า
// ----------------------------------------------------------------------

function paidInvoice(partial?: number) {
  const issued = issueTaxInvoice(demo(), {
    date: TODAY,
    dueDate: TODAY,
    contactId: 'c-nakhon',
    vatMode: 'exclusive',
    lines: [ln(1, 1000)],
  });
  const paid = receivePayment(issued.state, {
    invoiceId: issued.doc.id,
    date: TODAY,
    amount: partial ?? 1070,
    whtAmount: 0,
    depositAccountCode: ACC.bank,
  });
  return { state: paid.state, invoice: issued.doc };
}

describe('credit note after payment (B1)', () => {
  it('moves the credit to customer credit when the invoice is fully paid', () => {
    const { state, invoice } = paidInvoice();
    const cn = issueCreditNote(state, { invoiceId: invoice.id, date: TODAY, reason: 'คืนสินค้า', lines: [ln(1, 200)] });
    expect(cn.doc.creditToCustomer).toBe(214);
    const entry = cn.state.journal[cn.state.journal.length - 1];
    expect(isBalanced(entry.lines)).toBe(true);
    expect(entry.lines.find((l) => l.accountCode === ACC.customerCredit)?.credit).toBe(214);
    expect(entry.lines.some((l) => l.accountCode === ACC.receivable)).toBe(false);
    const inv = cn.state.sales.find((s) => s.id === invoice.id);
    expect(inv && outstandingOf(cn.state, inv)).toBe(0);
    expect(inv?.status).toBe('paid');
    expect(customerCreditOf(cn.state, 'c-nakhon')).toBe(214);
    expect(validateAccountingData(cn.state)).toEqual([]);
  });

  it('splits between receivable and customer credit on a partly paid invoice', () => {
    const { state, invoice } = paidInvoice(500);
    const cn = issueCreditNote(state, { invoiceId: invoice.id, date: TODAY, reason: 'ยกเลิก', lines: [ln(1, 1000)] });
    const entry = cn.state.journal[cn.state.journal.length - 1];
    expect(entry.lines.find((l) => l.accountCode === ACC.receivable)?.credit).toBe(570);
    expect(entry.lines.find((l) => l.accountCode === ACC.customerCredit)?.credit).toBe(500);
    const inv = cn.state.sales.find((s) => s.id === invoice.id);
    expect(inv && creditableOf(cn.state, inv)).toBe(0);
    expect(() =>
      issueCreditNote(cn.state, { invoiceId: invoice.id, date: TODAY, reason: 'ซ้ำ', lines: [ln(1, 1)] })
    ).toThrow(/เกินยอดที่ลดได้ 0.00/);
  });

  it('refunds the customer credit and keeps every entry balanced', () => {
    const { state, invoice } = paidInvoice();
    const cn = issueCreditNote(state, { invoiceId: invoice.id, date: TODAY, reason: 'คืน', lines: [ln(1, 1000)] });
    const base = { contactId: 'c-nakhon', date: TODAY, amount: 1000, accountCode: ACC.bank };
    const r = refundCustomerCredit(cn.state, { ...base, note: 'โอนคืน' });
    expect(r.refund.docNo).toBe('RF6910-0001');
    const entry = r.state.journal[r.state.journal.length - 1];
    expect(entry.source).toBe('refund');
    expect(entry.sourceDocNo).toBe('RF6910-0001');
    expect(entry.lines.find((l) => l.accountCode === ACC.customerCredit)?.debit).toBe(1000);
    expect(entry.lines.find((l) => l.accountCode === ACC.bank)?.credit).toBe(1000);
    expect(customerCreditOf(r.state, 'c-nakhon')).toBe(70);
    expect(balanceOf(trialBalance(r.state.accounts, r.state.journal), ACC.customerCredit)).toBe(70);
    expect(validateAccountingData(r.state)).toEqual([]);

    expect(() => refundCustomerCredit(r.state, { ...base, amount: 70.01 })).toThrow(/คืนได้ 70.00/);
    expect(() => refundCustomerCredit(r.state, { ...base, amount: 0 })).toThrow(/มากกว่า 0/);
    expect(() => refundCustomerCredit(r.state, { ...base, amount: 10, accountCode: ACC.customerCredit })).toThrow(
      /รับ\/จ่ายเงินไม่ได้/
    );
    expect(() => refundCustomerCredit(r.state, { ...base, contactId: 'nope' })).toThrow(/ไม่พบผู้ติดต่อ/);
    expect(() => refundCustomerCredit(r.state, { ...base, date: '2026-10-23', amount: 10 })).toThrow(/เรียงตามวันที่/);
  });
});
