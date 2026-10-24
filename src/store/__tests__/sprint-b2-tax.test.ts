import type { Contact, PurchaseLine, AccountingData } from 'src/domain';

import {
  ACC,
  sumBaht,
  bahtText,
  balanceOf,
  trialBalance,
  buildETaxXml,
  calcDocument,
  creditableOf,
  pp30ForPeriod,
  salesDocTitle,
  salesVatReport,
  purchaseTotals,
  whtCertificateOf,
  purchaseWhtGroups,
  purchaseVatReport,
  buyerTaxIdWarning,
  whtPayeesForPeriod,
  planPurchasePayment,
  vatClaimPeriodOptions,
  defaultVatClaimPeriod,
  whtSmallPaymentWarning,
  validateAccountingData,
} from 'src/domain';

import { emptyData } from '../seed';
import { ln, pln, demo, TODAY } from './fixtures';
import {
  lockPeriod,
  payPurchase,
  updateCompany,
  upsertContact,
  outstandingOf,
  issueDebitNote,
  receivePayment,
  recordPurchase,
  issueCreditNote,
  issueTaxInvoice,
} from '../actions';

import type { PurchaseInput } from '../actions';

// ----------------------------------------------------------------------
// Sprint B batch 2 — ภาษีซื้อ (B3), ใบลด/เพิ่มหนี้ (B4), ภ.พ.30 ยกยอด (B6), หัก ณ ที่จ่ายระดับบรรทัด + แบ่งจ่าย (B7)
// ----------------------------------------------------------------------

const purchase = (state: AccountingData, input: Partial<PurchaseInput> = {}) =>
  recordPurchase(state, {
    supplierInvoiceNo: `INV-${Math.random().toString(36).slice(2, 8)}`,
    supplierInvoiceDate: TODAY,
    vatClaimPeriod: '2026-10',
    date: TODAY,
    contactId: 'v-resin',
    vatMode: 'exclusive',
    claimVat: true,
    whtCondition: '1',
    lines: [pln(1, 1000, ACC.cogs)],
    ...input,
  });

describe('B3 input VAT: supplier invoice date and claim period (ม.82/3, ม.82/5)', () => {
  const data = demo();

  it('accepts the invoice month through six months after it, and nothing outside', () => {
    const invoiceDate = '2026-04-15';
    expect(vatClaimPeriodOptions(invoiceDate)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    // ใบกำกับ เม.ย. ใช้สิทธิ ต.ค. (เดือนที่ 6 ถัดไป) ได้ — ขอบบน
    const edge = purchase(data, { supplierInvoiceDate: invoiceDate, vatClaimPeriod: '2026-10' });
    expect(edge.doc.vatClaimPeriod).toBe('2026-10');
    expect(validateAccountingData(edge.state)).toEqual([]);
    // ใบกำกับ มี.ค. ใช้สิทธิ ต.ค. = เดือนที่ 7 → เกิน
    expect(() => purchase(data, { supplierInvoiceDate: '2026-03-31', vatClaimPeriod: '2026-10' })).toThrow(/ไม่เกิน 6 เดือน/);
    // ก่อนเดือนในใบกำกับ
    expect(() => purchase(data, { supplierInvoiceDate: '2026-10-01', vatClaimPeriod: '2026-09' })).toThrow(/ไม่ก่อนเดือนในใบกำกับ/);
  });

  it('requires an invoice date not after the recording date and a claim period', () => {
    expect(() => purchase(data, { supplierInvoiceDate: undefined })).toThrow(/วันที่ในใบกำกับ/);
    expect(() => purchase(data, { supplierInvoiceDate: '2569-10-01' })).toThrow(/วันที่ใบกำกับผู้ขาย/);
    expect(() => purchase(data, { supplierInvoiceDate: '2026-10-25' })).toThrow(/ไม่หลังวันที่บันทึก/);
    expect(() => purchase(data, { vatClaimPeriod: undefined })).toThrow(/เลือกเดือนที่ใช้สิทธิ/);
    expect(() => purchase(data, { vatClaimPeriod: '2026-13' })).toThrow(/เลือกเดือนที่ใช้สิทธิ/);
    // ไม่ขอคืน: ไม่ต้องมีวันที่/เดือน แต่ถ้ามีวันที่ต้องไม่หลังวันที่บันทึก
    const noClaim = purchase(data, { claimVat: false, supplierInvoiceDate: undefined, vatClaimPeriod: '2026-10' });
    expect(noClaim.doc.vatClaimPeriod).toBeUndefined();
    expect(() => purchase(data, { claimVat: false, supplierInvoiceDate: '2026-10-30' })).toThrow(/ไม่หลังวันที่บันทึก/);
  });

  it('reports input VAT in the claim month with the supplier invoice date, and reconciles 1170 by claim month', () => {
    // ใบกำกับลงวันที่ 28 ก.ย. บันทึก 24 ต.ค. ใช้สิทธิในเดือน ก.ย. (ยังไม่ปิดงวด)
    const r = purchase(data, { supplierInvoiceDate: '2026-09-28', vatClaimPeriod: '2026-09' });
    const sep = purchaseVatReport(r.state.purchases, r.state.contacts, { year: 2026, month: 9 });
    const row = sep.find((x) => x.id === r.doc.id);
    expect(row).toMatchObject({ date: '2026-09-28', recordedDate: TODAY, refDocNo: r.doc.docNo, vat: 70 });
    expect(purchaseVatReport(r.state.purchases, r.state.contacts, { year: 2026, month: 10 }).some((x) => x.id === r.doc.id)).toBe(
      false
    );
    expect(validateAccountingData(r.state)).toEqual([]);
  });

  it('cannot claim in a month that is already locked (ภ.พ.30 filed)', () => {
    const locked = lockPeriod(data, '2026-09-30', TODAY);
    expect(vatClaimPeriodOptions('2026-09-28', locked.company.lockedThrough)[0]).toBe('2026-10');
    expect(defaultVatClaimPeriod('2026-09-28', locked.company.lockedThrough)).toBe('2026-10');
    expect(() => purchase(locked, { supplierInvoiceDate: '2026-09-28', vatClaimPeriod: '2026-09' })).toThrow(/ปิดงวดแล้ว/);
    expect(purchase(locked, { supplierInvoiceDate: '2026-09-28', vatClaimPeriod: '2026-10' }).doc.claimVat).toBe(true);
    expect(defaultVatClaimPeriod('2026-01-05', locked.company.lockedThrough)).toBeUndefined();
  });

  it('treats VAT as an expense when the supplier has no valid tax id (ม.82/5)', () => {
    const resin = data.contacts.find((c) => c.id === 'v-resin') as Contact;
    const noTax = upsertContact(data, { ...resin, id: undefined, code: 'V0099', taxId: '' });
    const vendor = noTax.contacts[noTax.contacts.length - 1];
    const r = purchase(noTax, { contactId: vendor.id });
    expect(r.doc.claimVat).toBe(false);
    expect(r.doc.vatClaimPeriod).toBeUndefined();
    const entry = r.state.journal[r.state.journal.length - 1];
    expect(entry.lines.find((l) => l.accountCode === ACC.cogs)?.debit).toBe(1070);
    expect(entry.lines.some((l) => l.accountCode === ACC.inputVat)).toBe(false);
    expect(validateAccountingData(r.state)).toEqual([]);
  });
});

// ----------------------------------------------------------------------

describe('B4 credit / debit notes (ม.86/9, ม.86/10)', () => {
  const base = demo();
  const issued = issueTaxInvoice(base, {
    date: TODAY,
    dueDate: TODAY,
    contactId: 'c-nakhon',
    vatMode: 'exclusive',
    lines: [ln(10, 100)],
  });
  const invoice = issued.doc;

  it('stores original value, correct value and VAT of the difference on a credit note', () => {
    const cn = issueCreditNote(issued.state, { invoiceId: invoice.id, date: TODAY, reason: 'ลดราคา', lines: [ln(1, 100)] });
    expect([cn.doc.originalNet, cn.doc.correctNet, calcDocument(cn.doc).net, calcDocument(cn.doc).vat]).toEqual([1000, 900, 100, 7]);
    const cn2 = issueCreditNote(cn.state, { invoiceId: invoice.id, date: TODAY, reason: 'ลดอีก', lines: [ln(1, 50)] });
    expect([cn2.doc.originalNet, cn2.doc.correctNet]).toEqual([900, 850]);
    expect(validateAccountingData(cn2.state)).toEqual([]);
  });

  it('issues a debit note that raises AR, output VAT in its own month and the credit ceiling', () => {
    const dn = issueDebitNote(issued.state, { invoiceId: invoice.id, date: TODAY, reason: 'เพิ่มราคาตามสัญญา', lines: [ln(1, 200)] });
    expect(dn.doc.docNo).toBe('DN6910-0001');
    expect(dn.doc.kind).toBe('debit-note');
    expect(salesDocTitle(dn.doc)).toBe('ใบเพิ่มหนี้/ใบกำกับภาษี');
    expect([dn.doc.originalNet, dn.doc.correctNet]).toEqual([1000, 1200]);
    expect(dn.doc.etax).toBe('pending-sign');
    expect(outstandingOf(dn.state, invoice)).toBe(1284);
    expect(creditableOf(dn.state, invoice)).toBe(1284);
    const entry = dn.state.journal[dn.state.journal.length - 1];
    expect(entry.source).toBe('debit-note');
    expect(entry.lines.find((l) => l.accountCode === ACC.receivable)?.debit).toBe(214);
    expect(entry.lines.find((l) => l.accountCode === ACC.outputVat)?.credit).toBe(14);
    const row = salesVatReport(dn.state.sales, dn.state.contacts, { year: 2026, month: 10 }).find((r) => r.id === dn.doc.id);
    expect(row).toMatchObject({ kind: 'debit-note', net: 200, vat: 14 });
    expect(validateAccountingData(dn.state)).toEqual([]);

    // ลดหนี้ได้ถึงมูลค่าหลังเพิ่มหนี้ (1,200 + VAT) แต่ไม่เกิน
    expect(() =>
      issueCreditNote(dn.state, { invoiceId: invoice.id, date: TODAY, reason: 'x', lines: [ln(1, 1200.01)] })
    ).toThrow(/เกินยอดที่ลดได้/);
    const cn = issueCreditNote(dn.state, { invoiceId: invoice.id, date: TODAY, reason: 'ยกเลิกทั้งหมด', lines: [ln(1, 1200)] });
    expect(cn.doc.originalNet).toBe(1200);
    expect(cn.doc.correctNet).toBe(0);
    expect(outstandingOf(cn.state, invoice)).toBe(0);
    expect(validateAccountingData(cn.state)).toEqual([]);
  });

  it('reopens a paid invoice and builds e-Tax XML type 80 with original / difference amounts', () => {
    const paid = receivePayment(issued.state, { invoiceId: invoice.id, date: TODAY, amount: 1070, whtAmount: 0, depositAccountCode: ACC.bank });
    const dn = issueDebitNote(paid.state, { invoiceId: invoice.id, date: TODAY, reason: 'ส่งสินค้าเกิน', lines: [ln(2, 50)] });
    expect(dn.state.sales.find((s) => s.id === invoice.id)?.status).toBe('partial');
    const xml = buildETaxXml({ doc: dn.doc, company: dn.state.company, referenced: invoice, createdAt: '2026-10-24T10:00:00' });
    expect(xml).toContain('<ram:TypeCode>80</ram:TypeCode>');
    expect(xml).toContain('<ram:Name>ใบเพิ่มหนี้</ram:Name>');
    expect(xml).toContain('<ram:PurposeCode>DBNG99</ram:PurposeCode>');
    expect(xml).toContain('<ram:OriginalInformationAmount>1000.00</ram:OriginalInformationAmount>');
    expect(xml).toContain('<ram:DifferenceInformationAmount>100.00</ram:DifferenceInformationAmount>');
    expect(xml).toContain(`<ram:IssuerAssignedID>${invoice.docNo}</ram:IssuerAssignedID>`);
  });

  it('applies the credit-note date and lock rules', () => {
    const input = { invoiceId: invoice.id, date: TODAY, reason: 'เพิ่ม', lines: [ln(1, 10)] };
    expect(() => issueDebitNote(issued.state, { ...input, invoiceId: 'x' })).toThrow(/ไม่พบใบกำกับ/);
    expect(() => issueDebitNote(issued.state, { ...input, reason: ' ' })).toThrow(/ระบุเหตุผล/);
    expect(() => issueDebitNote(issued.state, { ...input, date: '2026-10-23' })).toThrow(/ไม่ก่อนวันที่ใบกำกับเดิม/);
    expect(() => issueDebitNote(issued.state, { ...input, lines: [ln(1, 0)] })).toThrow(/มากกว่า 0/);
    const sepInvoice = base.sales.find((s) => s.kind === 'tax-invoice' && s.date < '2026-09-01');
    if (!sepInvoice) throw new Error('fixture');
    const locked = lockPeriod(base, '2026-09-30', TODAY);
    expect(() => issueDebitNote(locked, { ...input, invoiceId: sepInvoice.id, date: '2026-09-30' })).toThrow(/ปิดงวด/);
    // DN เรียงตามวันที่
    const dn = issueDebitNote(issued.state, input);
    expect(() => issueDebitNote({ ...dn.state }, { ...input, date: '2026-10-24' }).doc.docNo).not.toThrow();
    const cancelled = issueCreditNote(issued.state, { ...input, reason: 'ยกเลิก', lines: [ln(10, 100)] });
    expect(() => issueDebitNote(cancelled.state, input)).toThrow(/ถูกยกเลิก/);
  });

  it('issues a non-tax debit memo for a non-VAT company', () => {
    const nonVat = updateCompany(demo(), { ...demo().company, vatRegistered: false });
    const bl = issueTaxInvoice(nonVat, { date: TODAY, dueDate: TODAY, contactId: 'c-abc', vatMode: 'exclusive', lines: [ln(1, 100)] });
    const dm = issueDebitNote(bl.state, { invoiceId: bl.doc.id, date: TODAY, reason: 'เพิ่ม', lines: [ln(1, 10)] });
    expect(dm.doc.docNo).toBe('DM6910-0001');
    expect(dm.doc.etax).toBe('not-required');
    expect(salesDocTitle(dm.doc)).toBe('ใบเพิ่มหนี้');
    expect(salesVatReport(dm.state.sales, dm.state.contacts, { year: 2026, month: 10 }).some((r) => r.id === dm.doc.id)).toBe(false);
    expect(validateAccountingData(dm.state)).toEqual([]);
  });

  it('warns (UI) before a tax invoice to a customer without a tax id (ม.86/4)', () => {
    expect(buyerTaxIdWarning(true, { taxId: '', legalForm: 'juristic' })).toMatch(/ม.86\/4/);
    expect(buyerTaxIdWarning(true, { taxId: undefined, legalForm: 'individual' })).toMatch(/ผู้จด VAT/);
    expect(buyerTaxIdWarning(true, { taxId: '1234567890123', legalForm: 'juristic' })).toMatch(/ไม่ถูกต้อง/);
    expect(buyerTaxIdWarning(true, { taxId: '0105565012341', legalForm: 'juristic' })).toBeNull();
    expect(buyerTaxIdWarning(false, { taxId: '', legalForm: 'juristic' })).toBeNull();
    expect(buyerTaxIdWarning(true, undefined)).toBeNull();
  });
});

// ----------------------------------------------------------------------

describe('B6 ภ.พ.30 carry forward and month-end VAT close', () => {
  /** บริษัทใหม่: ส.ค. ภาษีซื้อเกิน 700, ก.ย. ขาย 300 ซื้อ 100, ต.ค. ขาย 1,000 ซื้อ 200 */
  function threeMonths(): AccountingData {
    let s: AccountingData = { ...emptyData(), contacts: demo().contacts };
    const buy = (date: string, amount: number) => {
      s = purchase(s, { supplierInvoiceNo: `B-${date}`, supplierInvoiceDate: date, vatClaimPeriod: date.slice(0, 7), date, lines: [pln(1, amount, ACC.cogs)] }).state;
    };
    const sell = (date: string, amount: number) => {
      s = issueTaxInvoice(s, { date, dueDate: date, contactId: 'c-abc', vatMode: 'exclusive', lines: [ln(1, amount)] }).state;
    };
    buy('2026-08-10', 10000);
    sell('2026-09-05', 300 / 0.07);
    buy('2026-09-10', 100 / 0.07);
    sell('2026-10-05', 1000 / 0.07);
    buy('2026-10-10', 200 / 0.07);
    return s;
  }

  it('projects brought-forward credit across three open months', () => {
    const s = threeMonths();
    const aug = pp30ForPeriod(s, { year: 2026, month: 8 });
    const sep = pp30ForPeriod(s, { year: 2026, month: 9 });
    const oct = pp30ForPeriod(s, { year: 2026, month: 10 });
    expect([aug.outputVat, aug.inputVat, aug.broughtForward, aug.payable, aug.carriedForward]).toEqual([0, 700, 0, 0, 700]);
    expect([sep.outputVat, sep.inputVat, sep.broughtForward, sep.payable, sep.carriedForward]).toEqual([300, 100, 700, 0, 500]);
    expect([oct.outputVat, oct.inputVat, oct.broughtForward, oct.payable, oct.carriedForward]).toEqual([1000, 200, 500, 300, 0]);
    expect(aug.closed).toBeUndefined();
    expect(pp30ForPeriod(s, { year: 2026, month: 7 }).broughtForward).toBe(0);
  });

  it('closes every locked month in order with balanced entries and keeps the integrity reconciliation', () => {
    const s = threeMonths();
    const sepLocked = lockPeriod(s, '2026-09-30', '2026-10-24');
    expect(sepLocked.vatCloses.map((c) => [c.period, c.date, c.carriedForward])).toEqual([
      ['2026-08', '2026-08-31', 700],
      ['2026-09', '2026-09-30', 500],
    ]);
    expect(pp30ForPeriod(sepLocked, { year: 2026, month: 9 }).closed?.period).toBe('2026-09');
    expect(pp30ForPeriod(sepLocked, { year: 2026, month: 10 }).broughtForward).toBe(500);
    expect(validateAccountingData(sepLocked)).toEqual([]);
    const tbSep = trialBalance(sepLocked.accounts, sepLocked.journal, '2026-09-30');
    expect(balanceOf(tbSep, ACC.vatCredit)).toBe(500);
    expect(balanceOf(tbSep, ACC.inputVat)).toBe(0);
    expect(balanceOf(tbSep, ACC.outputVat)).toBe(0);

    const octLocked = lockPeriod(sepLocked, '2026-10-31', '2026-11-05');
    const oct = octLocked.vatCloses.find((c) => c.period === '2026-10');
    expect(oct && [oct.outputVat, oct.inputVat, oct.broughtForward, oct.payable, oct.carriedForward]).toEqual([1000, 200, 500, 300, 0]);
    const entry = octLocked.journal.find((e) => e.id === oct?.journalId);
    expect(entry?.source).toBe('vat-close');
    expect(entry?.lines).toEqual([
      { accountCode: ACC.outputVat, debit: 1000, credit: 0, description: 'ภาษีขาย' },
      { accountCode: ACC.inputVat, debit: 0, credit: 200, description: 'ภาษีซื้อ' },
      { accountCode: ACC.vatCredit, debit: 0, credit: 500, description: 'ภาษีชำระเกินยกมา/ยกไป' },
      { accountCode: ACC.vatPayable, debit: 0, credit: 300, description: 'ภาษีที่ต้องชำระ' },
    ]);
    const tb = trialBalance(octLocked.accounts, octLocked.journal);
    expect(balanceOf(tb, ACC.vatCredit)).toBe(0);
    expect(balanceOf(tb, ACC.vatPayable)).toBe(300);
    expect(validateAccountingData(octLocked)).toEqual([]);
    // ล็อกซ้ำวันเดิมไม่สร้างรายการซ้ำ
    expect(lockPeriod(octLocked, '2026-10-31', '2026-11-05').vatCloses).toHaveLength(3);
  });

  it('detects tampered or missing VAT closes', () => {
    const locked = lockPeriod(threeMonths(), '2026-09-30', '2026-10-24');
    const clone = () => JSON.parse(JSON.stringify(locked)) as AccountingData;
    const a = clone();
    a.vatCloses[1].carriedForward = 400;
    expect(validateAccountingData(a).join()).toMatch(/ตัวเลขไม่ตรง/);
    const b = clone();
    b.vatCloses = [b.vatCloses[1]];
    expect(validateAccountingData(b).join()).toMatch(/ยังไม่ได้ปิด/);
    const c = clone();
    c.company.lockedThrough = '2026-08-31';
    expect(validateAccountingData(c).join()).toMatch(/ยังไม่ได้ปิดงวดเดือนนี้/);
    const d = clone();
    d.vatCloses[0].journalId = undefined;
    expect(validateAccountingData(d).join()).toMatch(/ไม่พบรายการบัญชีที่ผูกไว้/);
  });

  it('closes the demo data on the first lock (August and September)', () => {
    const locked = lockPeriod(demo(), '2026-09-30', TODAY);
    expect(locked.vatCloses.map((c) => c.period)).toEqual(['2026-08', '2026-09']);
    expect(validateAccountingData(locked)).toEqual([]);
  });
});

// ----------------------------------------------------------------------

describe('B7 line-level WHT and partial payments', () => {
  const lines: PurchaseLine[] = [
    pln(1, 10000, ACC.professional, ['ค่าบริการ', 3]),
    pln(4, 250, ACC.supplies), // สินค้า ไม่หัก
    pln(1, 3333.33, ACC.rent, ['ค่าเช่า', 5]),
  ];

  it('derives document WHT from lines (goods lines not withheld)', () => {
    const doc = { lines, vatMode: 'inclusive' as const, vatRate: 7 };
    const groups = purchaseWhtGroups(doc);
    expect(groups.map((g) => [g.incomeType, g.rate])).toEqual([
      ['ค่าบริการ', 3],
      ['ค่าเช่า', 5],
    ]);
    // inclusive: ฐาน = มูลค่าก่อน VAT ของบรรทัด
    expect(groups.map((g) => g.base)).toEqual([9345.8, 3115.26]);
    expect(groups.map((g) => g.tax)).toEqual([280.37, 155.76]);
    expect(purchaseTotals(doc).wht).toBe(436.13);
  });

  it('splits WHT pro-rata over three payments; the last one takes the remainder so totals match exactly', () => {
    const r = purchase(demo(), { claimVat: true, vatMode: 'exclusive', lines });
    const {total} = calcDocument(r.doc); // 14,333.33 + 7% = 15,336.66
    expect(total).toBe(15336.66);
    let s = r.state;
    const p1 = payPurchase(s, { purchaseId: r.doc.id, date: TODAY, accountCode: ACC.bank, amount: 5000 });
    s = p1.state;
    expect(p1.doc.paid).toBe(false);
    const p2 = payPurchase(s, { purchaseId: r.doc.id, date: TODAY, accountCode: ACC.bank, amount: 3333.33 });
    s = p2.state;
    expect(() => payPurchase(s, { purchaseId: r.doc.id, date: TODAY, accountCode: ACC.bank, amount: 9000 })).toThrow(/เกินยอดค้าง/);
    const p3 = payPurchase(s, { purchaseId: r.doc.id, date: '2026-11-02', accountCode: ACC.bank });
    s = p3.state;
    expect(p3.payment.amount).toBe(7003.33);
    expect(p3.doc.paid).toBe(true);

    const pvs = [p1.payment, p2.payment, p3.payment];
    const groups = purchaseWhtGroups(r.doc);
    groups.forEach((g) => {
      const mine = pvs.flatMap((pv) => pv.whtItems).filter((i) => i.incomeType === g.incomeType);
      expect(sumBaht(mine.map((i) => i.base))).toBe(g.base);
      expect(sumBaht(mine.map((i) => i.tax))).toBe(g.tax);
    });
    expect(sumBaht(pvs.map((pv) => pv.whtAmount))).toBe(purchaseTotals(r.doc).wht);
    expect(pvs.map((pv) => [pv.docNo, pv.whtCertNo])).toEqual([
      ['PV6910-0004', 'WT6910-0004'],
      ['PV6910-0005', 'WT6910-0005'],
      ['PV6911-0001', 'WT6911-0001'],
    ]);
    pvs.forEach((pv) => expect(pv.netPaid).toBe(Math.round((pv.amount - pv.whtAmount) * 100) / 100));

    // ภ.ง.ด.53: แต่ละ PV เข้างวดของวันที่จ่าย เป็นรายการของตัวเอง
    const octItems = whtPayeesForPeriod(s, { year: 2026, month: 10 }, 'PND53').flatMap((p) => p.items.filter((i) => i.purchaseId === r.doc.id));
    const novItems = whtPayeesForPeriod(s, { year: 2026, month: 11 }, 'PND53').flatMap((p) => p.items);
    expect(new Set(octItems.map((i) => i.paymentId))).toEqual(new Set([p1.payment.id, p2.payment.id]));
    expect(novItems.map((i) => [i.paymentId, i.certNo, i.incomeType])).toEqual([
      [p3.payment.id, 'WT6911-0001', 'ค่าบริการ'],
      [p3.payment.id, 'WT6911-0001', 'ค่าเช่า'],
    ]);
    expect(validateAccountingData(s)).toEqual([]);
    expect(() => payPurchase(s, { purchaseId: r.doc.id, date: '2026-11-02', accountCode: ACC.bank })).toThrow(/จ่ายชำระแล้ว/);
  });

  it('rejects zero / negative amounts and payments dated before the document', () => {
    const r = purchase(demo(), { lines });
    expect(() => payPurchase(r.state, { purchaseId: r.doc.id, date: TODAY, accountCode: ACC.bank, amount: 0 })).toThrow(/มากกว่า 0/);
    expect(() => payPurchase(r.state, { purchaseId: r.doc.id, date: TODAY, accountCode: ACC.bank, amount: -5 })).toThrow(/มากกว่า 0/);
    expect(() => payPurchase(r.state, { purchaseId: r.doc.id, date: '2026-10-17', accountCode: ACC.bank })).toThrow(/ไม่ก่อนวันที่เอกสาร/);
  });

  it('warns (not blocks) when one payment withholds on income below 1,000 baht (ท.ป.4/2528 ข้อ 12)', () => {
    const r = purchase(demo(), { claimVat: false, vatMode: 'none', lines: [pln(1, 900, ACC.misc, ['ค่าบริการ', 3])] });
    const plan = planPurchasePayment(r.state, r.doc, 900);
    expect(plan.whtAmount).toBe(27);
    expect(whtSmallPaymentWarning(plan)).toMatch(/ต่ำกว่า 1,000/);
    expect(payPurchase(r.state, { purchaseId: r.doc.id, date: TODAY, accountCode: ACC.bank }).payment.whtAmount).toBe(27);
    const big = purchase(demo(), { claimVat: false, vatMode: 'none', lines: [pln(1, 5000, ACC.misc, ['ค่าบริการ', 3])] });
    expect(whtSmallPaymentWarning(planPurchasePayment(big.state, big.doc, 5000))).toBeNull();
    // แบ่งจ่ายจนครั้งหนึ่งต่ำกว่า 1,000 ก็เตือน
    expect(whtSmallPaymentWarning(planPurchasePayment(big.state, big.doc, 500))).toMatch(/ต่ำกว่า/);
    expect(whtSmallPaymentWarning({ whtAmount: 0, whtBase: 10 })).toBeNull();
  });

  it('prints the net amount in Thai words for the voucher', () => {
    const r = purchase(demo(), { claimVat: false, vatMode: 'none', lines: [pln(1, 1000, ACC.misc, ['ค่าบริการ', 3])], payNow: { date: TODAY, accountCode: ACC.bank } });
    expect(r.payment?.netPaid).toBe(970);
    expect(bahtText(r.payment?.netPaid ?? 0)).toBe('เก้าร้อยเจ็ดสิบบาทถ้วน');
  });
});

// ----------------------------------------------------------------------

describe('50 ทวิ certificate data', () => {
  it('builds the certificate of each payment with its PND sequence and Thai words', () => {
    const r = purchase(demo(), { claimVat: false, vatMode: 'none', lines: [pln(1, 1000, ACC.misc, ['ค่าบริการ', 3])] });
    const p1 = payPurchase(r.state, { purchaseId: r.doc.id, date: TODAY, accountCode: ACC.bank, amount: 400 });
    const p2 = payPurchase(p1.state, { purchaseId: r.doc.id, date: TODAY, accountCode: ACC.bank });
    const cert1 = whtCertificateOf(p2.state, p1.payment.id);
    const cert2 = whtCertificateOf(p2.state, p2.payment.id);
    expect(cert1).toMatchObject({ certNo: 'WT6910-0004', bookNo: 'WT6910', seqInBook: '0004', form: 'PND53', totalBase: 400, totalTax: 12 });
    expect(cert1?.totalTaxText).toBe('สิบสองบาทถ้วน');
    expect(cert2).toMatchObject({ certNo: 'WT6910-0005', totalBase: 600, totalTax: 18, purchaseDocNo: r.doc.docNo });
    // คนละใบสำคัญจ่าย = คนละลำดับในแบบ
    expect(cert1?.sequence).toBeDefined();
    expect(cert2?.sequence).toBe((cert1?.sequence ?? 0) + 1);
    expect(cert1?.payee.name).toBe('ไทยเม็ดพลาสติก จำกัด');
    const noWht = p2.state.payments.find((p) => !p.whtCertNo);
    expect(noWht && whtCertificateOf(p2.state, noWht.id)).toBeNull();
    expect(whtCertificateOf(p2.state, 'nope')).toBeNull();
  });
});
