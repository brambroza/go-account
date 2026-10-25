import type { Contact, DocLine, AccountingData } from 'src/domain';

import { ACC, toSatang, calcDocument, outstandingOf, customerCreditOf, purchaseVatReport } from 'src/domain';

import { ln, demo, TODAY } from './fixtures';
import {
  upsertContact,
  recordPurchase,
  receivePayment,
  issueCreditNote,
  issueTaxInvoice,
  refundCustomerCredit,
} from '../actions';

import type { PurchaseInput } from '../actions';

// ----------------------------------------------------------------------
// Sprint A.1 — กฎที่ปิดช่องโหว่จากรายงานทดสอบ 2026-10-24 (T2, T3, T7, T9, T10, T12)
// แต่ละ test อ้างรหัสเคสของผู้ทดสอบ (C2, P2, PROBE-1 …) ที่เคยผ่านทั้งที่ควรถูกปฏิเสธ
// ----------------------------------------------------------------------

const D = '2026-10-25';
const CONTROL = ['1130', '1160', '1170', '2110', '2120', '2150', '2160'];

function invoice(state: AccountingData, amount = 1000, date = D, vatMode: 'exclusive' | 'inclusive' | 'none' = 'exclusive') {
  return issueTaxInvoice(state, { date, dueDate: date, contactId: 'c-abc', vatMode, lines: [ln(1, amount)] });
}

type PurchaseExtra = Partial<Omit<PurchaseInput, 'lines'>> & { lines?: DocLine[]; wht?: [string, number] };

function purchase(state: AccountingData, supplierInvoiceNo: string, { lines, wht, ...extra }: PurchaseExtra = {}) {
  return recordPurchase(state, {
    supplierInvoiceNo,
    supplierInvoiceDate: D,
    vatClaimPeriod: '2026-10',
    date: D,
    contactId: 'v-resin',
    lines: (lines ?? [ln(1, 1000, ACC.cogs)]).map((l) => ({ ...l, whtIncomeType: wht?.[0] ?? '', whtRate: wht?.[1] ?? 0 })),
    vatMode: 'exclusive',
    claimVat: true,
    whtCondition: '1',
    note: '',
    ...extra,
  });
}

describe('T2 document lines cannot use control accounts / wrong account types', () => {
  const s = demo();

  it.each(CONTROL)('C2: sales and purchase line coded to %s is rejected', (code) => {
    expect(() =>
      issueTaxInvoice(s, { date: D, dueDate: D, contactId: 'c-abc', vatMode: 'none', lines: [ln(1, 100, code)] })
    ).toThrow(/บัญชีคุม/);
    expect(() => purchase(s, `C2-${code}`, { vatMode: 'none', claimVat: false, lines: [ln(1, 100, code)] })).toThrow(
      /บัญชีคุม/
    );
  });

  it('sales lines must be revenue; purchase lines expense or non-cash asset; credit note lines revenue', () => {
    expect(() => invoice(s, 0).state).toThrow();
    expect(() =>
      issueTaxInvoice(s, { date: D, dueDate: D, contactId: 'c-abc', vatMode: 'exclusive', lines: [ln(1, 100, ACC.misc)] })
    ).toThrow(/ไม่ใช่บัญชีรายได้/);
    expect(() => purchase(s, 'T2-REV', { lines: [ln(1, 100, ACC.sales)] })).toThrow(/ไม่ใช่บัญชีค่าใช้จ่าย/);
    expect(() => purchase(s, 'T2-BANK', { lines: [ln(1, 100, ACC.bank)] })).toThrow(/ไม่ใช่บัญชีค่าใช้จ่าย/);
    expect(purchase(s, 'T2-EQ', { lines: [ln(1, 100, ACC.equipment)] }).doc.lines[0].accountCode).toBe(ACC.equipment);
    const inv = invoice(s);
    expect(() =>
      issueCreditNote(inv.state, { invoiceId: inv.doc.id, date: D, reason: 'x', lines: [ln(1, 10, ACC.outputVat)] })
    ).toThrow(/บัญชีคุม/);
  });
});

describe('T3 duplicate supplier invoice (normalised number, same taxId + branch)', () => {
  const base = () => purchase(demo(), 'INV-001').state;

  it.each(['INV001', 'INV–001', 'INV-001​', 'ＩＮＶ-００１', 'INV-0001', 'INV/001', 'INV_001', ' inv - 001 ', 'INV.๐๐๑'])(
    'P2: variant %j of INV-001 is rejected',
    (variant) => {
      expect(() => purchase(base(), variant)).toThrow(/บันทึกไปแล้ว/);
    }
  );

  it.each(['INV-002', 'INV-010', 'IV-001', 'INV-001A', 'INV-1001'])('genuinely different number %j is accepted', (other) => {
    expect(purchase(base(), other).doc.supplierInvoiceNo).toBe(other);
  });

  it('P3: a second contact with the same taxId + branch cannot claim the same invoice again', () => {
    let s = base();
    const resin = s.contacts.find((c) => c.id === 'v-resin') as Contact;
    s = upsertContact(s, { ...resin, id: undefined, code: 'V9999', name: `${resin.name} (ซ้ำ)` });
    const dupId = s.contacts.find((c) => c.code === 'V9999')?.id ?? '';
    expect(() => purchase(s, 'INV-001', { contactId: dupId })).toThrow(/เลขผู้เสียภาษีเดียวกัน/);
    expect(purchaseVatReport(s.purchases, s.contacts, { year: 2026, month: 10 }).filter((r) => r.docNo === 'INV-001')).toHaveLength(1);
    // สาขาอื่นของผู้ขายเดียวกันเป็นคนละผู้ออกใบกำกับ
    s = upsertContact(s, { ...resin, id: undefined, code: 'V9998', branchNo: '00001' });
    const branchId = s.contacts.find((c) => c.code === 'V9998')?.id ?? '';
    expect(purchase(s, 'INV-001', { contactId: branchId }).doc.contactId).toBe(branchId);
  });
});

describe('T7 credit / refund dates', () => {
  it('PROBE-1 / L6: refund dated before the credit note that created the credit is rejected', () => {
    const inv = invoice(demo());
    let s = receivePayment(inv.state, { invoiceId: inv.doc.id, date: D, amount: 1070, whtAmount: 0, depositAccountCode: ACC.bank }).state;
    s = issueCreditNote(s, { invoiceId: inv.doc.id, date: '2026-11-05', reason: 'คืน', lines: [ln(1, 1000)] }).state;
    expect(customerCreditOf(s, 'c-abc')).toBe(1070);
    expect(customerCreditOf(s, 'c-abc', '2026-10-31')).toBe(0);
    expect(() =>
      refundCustomerCredit(s, { contactId: 'c-abc', date: '2026-10-26', amount: 1070, accountCode: ACC.bank })
    ).toThrow(/ณ วันที่ 26\/10\/2569/);
    const ok = refundCustomerCredit(s, { contactId: 'c-abc', date: '2026-11-05', amount: 1070, accountCode: ACC.bank });
    expect(customerCreditOf(ok.state, 'c-abc')).toBe(0);
  });

  it('PROBE-3: credit note cannot be dated before the latest receipt of the invoice', () => {
    const inv = invoice(demo());
    const s = receivePayment(inv.state, {
      invoiceId: inv.doc.id,
      date: '2026-11-10',
      amount: 500,
      whtAmount: 0,
      depositAccountCode: ACC.bank,
    }).state;
    expect(() => issueCreditNote(s, { invoiceId: inv.doc.id, date: '2026-11-06', reason: 'x', lines: [ln(1, 100)] })).toThrow(
      /ก่อนวันรับชำระครั้งล่าสุด/
    );
    const cn = issueCreditNote(s, { invoiceId: inv.doc.id, date: '2026-11-10', reason: 'x', lines: [ln(1, 100)] });
    expect(cn.doc.creditToCustomer).toBe(0);
    expect(outstandingOf(cn.state, cn.state.sales.find((x) => x.id === inv.doc.id) ?? inv.doc)).toBe(463);
  });
});

describe('T9 cumulative credit notes', () => {
  it('K1: many small credit notes on a VAT-inclusive invoice never exceed its VAT or net', () => {
    const inv = invoice(demo(), 100, D, 'inclusive');
    let s = inv.state;
    let issued = 0;
    for (let i = 0; i < 100; i += 1) {
      try {
        s = issueCreditNote(s, { invoiceId: inv.doc.id, date: D, reason: 'x', lines: [ln(1, 1)] }).state;
        issued += 1;
      } catch (error) {
        expect(String(error)).toMatch(/ภาษีที่ลดรวม|มูลค่าที่ลดรวม|เกินยอดที่ลดได้/);
        break;
      }
    }
    const cns = s.sales.filter((x) => x.refDocId === inv.doc.id).map((x) => calcDocument(x));
    const original = calcDocument(inv.doc);
    expect(issued).toBeGreaterThan(0);
    expect(cns.reduce((a, t) => a + toSatang(t.vat), 0)).toBeLessThanOrEqual(toSatang(original.vat));
    expect(cns.reduce((a, t) => a + toSatang(t.net), 0)).toBeLessThanOrEqual(toSatang(original.net));
  });
});

describe('T10 receipt WHT cap and deposit account', () => {
  const inv = invoice(demo());
  const pay = (whtAmount: number, depositAccountCode: string = ACC.bank, amount = 1070) => () =>
    receivePayment(inv.state, { invoiceId: inv.doc.id, date: D, amount, whtAmount, depositAccountCode });

  it('K4 / Z-soft: WHT above 5% of the pre-VAT base is rejected; up to 5% is accepted', () => {
    expect(pay(535)).toThrow(/ไม่เกิน 50.00/);
    expect(pay(990, ACC.bank, 1000)).toThrow(/เกิน 5%/);
    expect(pay(50)().receipt.whtAmount).toBe(50);
    expect(pay(30)().receipt.whtAmount).toBe(30);
    // รับบางส่วน: ฐาน = net × ยอดที่รับ ÷ total
    expect(pay(25.01, ACC.bank, 535)).toThrow(/ไม่เกิน 25.00/);
  });

  it('Z-soft: receipt must go to a cash / bank account', () => {
    expect(pay(0, ACC.inventory)).toThrow(/เงินสดหรือธนาคาร/);
    expect(pay(0, ACC.receivable)).toThrow(/เงินสดหรือธนาคาร/);
    expect(pay(0, ACC.cash)().receipt.depositAccountCode).toBe(ACC.cash);
  });

  it('Z-soft purWht100: purchase WHT rate above 15% is rejected', () => {
    expect(() => purchase(demo(), 'W100', { wht: ['x', 100] })).toThrow(/0–15%/);
    expect(purchase(demo(), 'W10', { wht: ['ค่าบริการ', 10] }).doc.lines[0].whtRate).toBe(10);
  });
});

describe('T12 sales documents only to customers', () => {
  it('K3: issuing an invoice to a vendor-only contact is rejected; "both" is allowed', () => {
    const s = demo();
    expect(() =>
      issueTaxInvoice(s, { date: D, dueDate: D, contactId: 'v-resin', vatMode: 'exclusive', lines: [ln(1, 1)] })
    ).toThrow(/ผู้ขายเท่านั้น/);
    const resin = s.contacts.find((c) => c.id === 'v-resin') as Contact;
    const both = upsertContact(s, { ...resin, kind: 'both' });
    expect(
      issueTaxInvoice(both, { date: TODAY, dueDate: TODAY, contactId: 'v-resin', vatMode: 'exclusive', lines: [ln(1, 1)] }).doc
        .contactId
    ).toBe('v-resin');
  });
});
