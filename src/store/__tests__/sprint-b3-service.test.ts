import type { AccountingData } from 'src/domain';

import {
  ACC,
  sumBaht,
  eTaxDocs,
  balanceOf,
  receiptsOf,
  trialBalance,
  calcDocument,
  creditableOf,
  receiptTitle,
  buildETaxXml,
  deferredVatOf,
  salesDocTitle,
  pp30ForPeriod,
  salesVatReport,
  isServiceInvoice,
  buildReceiptETaxXml,
  serviceCreditNotePlan,
  validateAccountingData,
} from 'src/domain';

import { ln, demo, TODAY } from './fixtures';
import {
  lockPeriod,
  updateCompany,
  outstandingOf,
  setETaxStatus,
  issueDebitNote,
  receivePayment,
  issueCreditNote,
  issueTaxInvoice,
} from '../actions';

// ----------------------------------------------------------------------
// Sprint B batch 3 — B2 งานบริการ (ม.78/1): ใบแจ้งหนี้ก่อน ภาษีขายเกิดเมื่อรับชำระ
// ----------------------------------------------------------------------

const OCT = { year: 2026, month: 10 };
const NOV = { year: 2026, month: 11 };
const DEC = { year: 2026, month: 12 };

/** ใบแจ้งหนี้งานบริการ 10,000 + VAT 700 = 10,700 ลงวันที่ 24 ต.ค. */
function serviceInvoice(state: AccountingData = demo(), unitPrice = 10000) {
  return issueTaxInvoice(state, {
    date: TODAY,
    dueDate: '2026-11-30',
    contactId: 'c-abc',
    vatMode: 'exclusive',
    saleType: 'service',
    lines: [ln(1, unitPrice, ACC.service)],
  });
}

const receive = (state: AccountingData, invoiceId: string, date: string, amount: number, whtAmount = 0) =>
  receivePayment(state, { invoiceId, date, amount, whtAmount, depositAccountCode: ACC.bank });

const gl = (state: AccountingData, code: string) => balanceOf(trialBalance(state.accounts, state.journal), code);

describe('B2 service invoice — ใบแจ้งหนี้ (no output VAT yet)', () => {
  const base = demo();
  const { state, doc } = serviceInvoice(base);

  it('issues a non-tax invoice (BL) and parks VAT in 2151', () => {
    expect(doc.docNo).toMatch(/^BL6910-/);
    expect(doc).toMatchObject({ isTaxInvoice: false, saleType: 'service', vatRate: 7, etax: 'not-required' });
    expect(isServiceInvoice(doc)).toBe(true);
    expect(salesDocTitle(doc)).toBe('ใบแจ้งหนี้');
    const entry = state.journal.find((e) => e.id === doc.journalId);
    expect(entry?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: ACC.receivable, debit: 10700 }),
        expect.objectContaining({ accountCode: ACC.service, credit: 10000 }),
        expect.objectContaining({ accountCode: ACC.deferredOutputVat, credit: 700 }),
      ])
    );
    expect(entry?.lines.some((l) => l.accountCode === ACC.outputVat)).toBe(false);
    expect(deferredVatOf(state, doc)).toBe(700);
    expect(gl(state, ACC.deferredOutputVat)).toBe(700);
    expect(validateAccountingData(state)).toEqual([]);
  });

  it('is not in the sales VAT report / ภ.พ.30 of the invoice month', () => {
    expect(salesVatReport(state.sales, state.contacts, OCT, state.receipts).some((r) => r.id === doc.id)).toBe(false);
    expect(pp30ForPeriod(state, OCT).outputVat).toBe(pp30ForPeriod(base, OCT).outputVat);
  });

  it('cannot take a debit note (issue a new invoice instead)', () => {
    expect(() => issueDebitNote(state, { invoiceId: doc.id, date: TODAY, reason: 'เพิ่มงาน', lines: [ln(1, 100, ACC.service)] })).toThrow(
      /ใบแจ้งหนี้ใบใหม่/
    );
  });

  it('non-VAT company: service is a plain invoice/receipt without VAT', () => {
    const nonVat = updateCompany(base, { ...base.company, vatRegistered: false });
    const r = serviceInvoice(nonVat);
    expect(r.doc).toMatchObject({ isTaxInvoice: false, vatMode: 'none', vatRate: 0 });
    expect(isServiceInvoice(r.doc)).toBe(false);
    const paid = receive(r.state, r.doc.id, TODAY, 10000);
    expect(paid.receipt.docNo).toMatch(/^RE/);
    expect(paid.receipt.isTaxInvoice).toBeUndefined();
    expect(paid.receipt.vat).toBeUndefined();
    expect(receiptTitle(paid.receipt)).toBe('ใบเสร็จรับเงิน');
    expect(validateAccountingData(paid.state)).toEqual([]);
  });
});

describe('B2 receipts — ใบเสร็จรับเงิน/ใบกำกับภาษี (RT) move VAT in the receipt month', () => {
  const { state: s0, doc } = serviceInvoice();
  // รับครั้งแรก 5,350 ใน พ.ย. (ลูกค้าหัก 3% ของ 5,000 = 150) ครั้งที่สอง 5,350 ใน ธ.ค.
  const first = receive(s0, doc.id, '2026-11-10', 5350, 150);
  const second = receive(first.state, doc.id, '2026-12-05', 5350);

  it('first receipt: RT number, VAT pro rata, WHT still recorded', () => {
    const r = first.receipt;
    expect(r.docNo).toMatch(/^RT6911-0001$/);
    expect(r).toMatchObject({ isTaxInvoice: true, vat: 350, etax: 'pending-sign', whtAmount: 150 });
    expect(receiptTitle(r)).toBe('ใบเสร็จรับเงิน/ใบกำกับภาษี');
    const entry = first.state.journal.find((e) => e.id === r.journalId);
    expect(entry?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: ACC.deferredOutputVat, debit: 350 }),
        expect.objectContaining({ accountCode: ACC.outputVat, credit: 350 }),
        expect.objectContaining({ accountCode: ACC.whtReceivable, debit: 150 }),
        expect.objectContaining({ accountCode: ACC.bank, debit: 5200 }),
      ])
    );
    expect(deferredVatOf(first.state, doc)).toBe(350);
    expect(validateAccountingData(first.state)).toEqual([]);
  });

  it('VAT report and ภ.พ.30 follow the receipt date (Nov / Dec), not the invoice date (Oct)', () => {
    const nov = salesVatReport(second.state.sales, second.state.contacts, NOV, second.state.receipts);
    expect(nov.find((r) => r.id === first.receipt.id)).toMatchObject({ kind: 'receipt', net: 5000, vat: 350, taxId: '0105565012341' });
    const dec = salesVatReport(second.state.sales, second.state.contacts, DEC, second.state.receipts);
    expect(dec.find((r) => r.id === second.receipt.id)).toMatchObject({ net: 5000, vat: 350 });
    expect(pp30ForPeriod(second.state, NOV).outputVat).toBe(350);
    expect(pp30ForPeriod(second.state, OCT).outputVat).toBe(pp30ForPeriod(s0, OCT).outputVat);
  });

  it('final receipt takes the remaining deferred VAT — 2151 back to zero, total VAT = invoice VAT', () => {
    expect(second.receipt.docNo).toBe('RT6912-0001');
    expect(deferredVatOf(second.state, doc)).toBe(0);
    expect(sumBaht(receiptsOf(second.state, doc.id).map((r) => r.vat ?? 0))).toBe(700);
    expect(gl(second.state, ACC.deferredOutputVat)).toBe(gl(s0, ACC.deferredOutputVat) - 700);
    expect(second.state.sales.find((s) => s.id === doc.id)?.status).toBe('paid');
    expect(validateAccountingData(second.state)).toEqual([]);
  });

  it('rounding over three uneven receipts still sums to the invoice VAT', () => {
    const odd = serviceInvoice(demo(), 999.99);
    let st = odd.state;
    [333.33, 500.01].forEach((amount) => {
      st = receive(st, odd.doc.id, '2026-11-01', amount).state;
    });
    st = receive(st, odd.doc.id, '2026-11-02', outstandingOf(st, st.sales.find((x) => x.id === odd.doc.id) ?? odd.doc)).state;
    expect(sumBaht(receiptsOf(st, odd.doc.id).map((r) => r.vat ?? 0))).toBe(calcDocument(odd.doc).vat);
    expect(validateAccountingData(st)).toEqual([]);
  });

  it('closing the month posts the receipt VAT (VAT close uses receipt tax invoices)', () => {
    const locked = lockPeriod(second.state, '2026-11-30', '2026-12-10');
    const nov = locked.vatCloses.find((c) => c.period === '2026-11');
    expect(nov?.outputVat).toBe(350);
    expect(validateAccountingData(locked)).toEqual([]);
  });

  it('e-Tax: receipt tax invoices are listed, signed and built as T03 XML', () => {
    const docs = eTaxDocs(second.state).filter((d) => d.source === 'receipt');
    expect(docs.map((d) => d.docNo)).toEqual([first.receipt.docNo, second.receipt.docNo]);
    const signed = setETaxStatus(second.state, [first.receipt.id], 'signed');
    expect(signed.receipts.find((r) => r.id === first.receipt.id)?.etax).toBe('signed');
    const uploaded = setETaxStatus(signed, [first.receipt.id], 'uploaded', { reference: 'RD-1' });
    expect(uploaded.receipts.find((r) => r.id === first.receipt.id)).toMatchObject({ etax: 'uploaded', etaxReference: 'RD-1' });
    expect(() => setETaxStatus(uploaded, [first.receipt.id], 'signed')).toThrow(/ย้อนกลับไม่ได้/);
    expect(validateAccountingData(uploaded).join()).toBe('');

    const xml = buildReceiptETaxXml({ receipt: first.receipt, invoice: doc, company: s0.company, createdAt: '2026-11-10T09:00:00' });
    expect(xml).toContain('<ram:TypeCode>T03</ram:TypeCode>');
    expect(xml).toContain(`<ram:ID>${first.receipt.docNo}</ram:ID>`);
    expect(xml).toContain('<ram:TaxBasisTotalAmount>5000.00</ram:TaxBasisTotalAmount>');
    expect(xml).toContain('<ram:TaxTotalAmount>350.00</ram:TaxTotalAmount>');
    expect(xml).toContain('<ram:GrandTotalAmount>5350.00</ram:GrandTotalAmount>');
    expect(xml).toContain(`<ram:IssuerAssignedID>${doc.docNo}</ram:IssuerAssignedID>`);
    const plain = s0.receipts[0];
    expect(() => buildReceiptETaxXml({ receipt: plain, invoice: doc, company: s0.company })).toThrow(/ไม่ใช่ใบเสร็จรับเงิน\/ใบกำกับภาษี/);
  });
});

describe('B2 credit notes on service invoices', () => {
  const { state: s0, doc } = serviceInvoice();

  it('before any receipt: plain credit memo (CM) reverses deferred VAT, not in the VAT report', () => {
    const cn = issueCreditNote(s0, { invoiceId: doc.id, date: TODAY, reason: 'ลดราคา', lines: [ln(1, 2000, ACC.service)] });
    expect(cn.doc.docNo).toMatch(/^CM6910-/);
    expect(cn.doc).toMatchObject({ isTaxInvoice: false, saleType: 'service', creditToCustomer: 0 });
    const entry = cn.state.journal.find((e) => e.id === cn.doc.journalId);
    expect(entry?.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: ACC.deferredOutputVat, debit: 140 })]));
    expect(deferredVatOf(cn.state, doc)).toBe(560);
    expect(salesVatReport(cn.state.sales, cn.state.contacts, OCT, cn.state.receipts).some((r) => r.id === cn.doc.id)).toBe(false);
    // รับเงินที่เหลือ 8,560 ครั้งเดียว: VAT 560
    const paid = receive(cn.state, doc.id, '2026-11-01', 8560);
    expect(paid.receipt.vat).toBe(560);
    expect(validateAccountingData(paid.state)).toEqual([]);
  });

  it('full cancellation before receipt cancels the invoice and clears 2151', () => {
    const cn = issueCreditNote(s0, { invoiceId: doc.id, date: TODAY, reason: 'ยกเลิกงาน', lines: doc.lines });
    expect(cn.state.sales.find((s) => s.id === doc.id)?.status).toBe('cancelled');
    expect(deferredVatOf(cn.state, doc)).toBe(0);
    expect(validateAccountingData(cn.state)).toEqual([]);
  });

  it('partly received: credit only up to the unpaid part; settling credit absorbs VAT rounding', () => {
    const part = receive(s0, doc.id, '2026-11-01', 3333);
    const inv = part.state.sales.find((s) => s.id === doc.id) ?? doc;
    const outstanding = outstandingOf(part.state, inv);
    expect(outstanding).toBe(7367);
    expect(() =>
      issueCreditNote(part.state, { invoiceId: doc.id, date: '2026-11-02', reason: 'ลดราคา', lines: [ln(1, 7000, ACC.service)] })
    ).toThrow(/ไม่เกินยอดค้างรับ/);
    // ยกเลิกส่วนที่ยังไม่ได้รับทั้งหมด: 6,885.05 + 481.95 = 7,367.00 = ภาษีรอตัดพอดี (ไม่มีเศษปัด)
    const exact = issueCreditNote(part.state, { invoiceId: doc.id, date: '2026-11-02', reason: 'ยกเลิกส่วนที่เหลือ', lines: [ln(1, 6885.05, ACC.service)] });
    expect(calcDocument(exact.doc).total).toBe(7367);
    expect(exact.doc.deferredVatRounding).toBeUndefined();
    expect(deferredVatOf(exact.state, doc)).toBe(0);
    expect(validateAccountingData(exact.state)).toEqual([]);

    // ใบแจ้งหนี้ 10,000.01 + 700.00 รับ 100.05 (VAT 6.55) เหลือ 10,599.96 ลดหนี้ 9,906.50 + 693.46
    // แต่ภาษีรอตัดเหลือ 693.45 → เศษปัด −0.01 ลงบัญชี Dr รายได้ / Cr 2151 ให้ 2151 ของใบนี้เป็นศูนย์
    const odd = serviceInvoice(demo(), 10000.01);
    const paid = receive(odd.state, odd.doc.id, '2026-11-01', 100.05);
    const oddInv = paid.state.sales.find((s) => s.id === odd.doc.id) ?? odd.doc;
    const lines = [ln(1, 9906.5, ACC.service)];
    const plan = serviceCreditNotePlan(paid.state, oddInv, calcDocument({ ...oddInv, lines }));
    expect(plan).toMatchObject({ mode: 'deferred', isTaxInvoice: false, problem: null, deferredVatRounding: -0.01 });
    const cn = issueCreditNote(paid.state, { invoiceId: odd.doc.id, date: '2026-11-02', reason: 'ยกเลิกส่วนที่เหลือ', lines });
    expect(cn.doc.deferredVatRounding).toBe(-0.01);
    const entry = cn.state.journal.find((e) => e.id === cn.doc.journalId);
    expect(entry?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: ACC.deferredOutputVat, credit: 0.01 }),
        expect.objectContaining({ accountCode: ACC.service, debit: 0.01 }),
      ])
    );
    expect(deferredVatOf(cn.state, odd.doc)).toBe(0);
    expect(outstandingOf(cn.state, cn.state.sales.find((s) => s.id === odd.doc.id) ?? odd.doc)).toBe(0);
    expect(validateAccountingData(cn.state)).toEqual([]);
  });

  it('fully received: tax credit note (CN) references the latest receipt tax invoice, reduces 2150 in its month', () => {
    const r1 = receive(s0, doc.id, '2026-11-01', 5350);
    const r2 = receive(r1.state, doc.id, '2026-11-20', 5350);
    const inv = r2.state.sales.find((s) => s.id === doc.id) ?? doc;
    expect(creditableOf(r2.state, inv)).toBe(10700);
    const cn = issueCreditNote(r2.state, { invoiceId: doc.id, date: '2026-12-01', reason: 'ลดราคาหลังส่งมอบ', lines: [ln(1, 1000, ACC.service)] });
    expect(cn.doc.docNo).toMatch(/^CN6912-/);
    expect(cn.doc).toMatchObject({ isTaxInvoice: true, refReceiptId: r2.receipt.id, creditToCustomer: 1070, etax: 'pending-sign' });
    const dec = salesVatReport(cn.state.sales, cn.state.contacts, DEC, cn.state.receipts);
    expect(dec.find((r) => r.id === cn.doc.id)).toMatchObject({ net: -1000, vat: -70 });
    const entry = cn.state.journal.find((e) => e.id === cn.doc.journalId);
    expect(entry?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: ACC.outputVat, debit: 70 }),
        expect.objectContaining({ accountCode: ACC.customerCredit, credit: 1070 }),
      ])
    );
    const xml = buildETaxXml({ doc: cn.doc, company: cn.state.company, referenced: inv, referencedReceipt: r2.receipt });
    expect(xml).toContain(`<ram:IssuerAssignedID>${r2.receipt.docNo}</ram:IssuerAssignedID>`);
    expect(xml).toContain('<ram:ReferenceTypeCode>T03</ram:ReferenceTypeCode>');
    expect(validateAccountingData(cn.state)).toEqual([]);
  });

  it('integrity flags a service receipt stored as a plain receipt and leftover deferred VAT', () => {
    const r = receive(s0, doc.id, '2026-11-01', 10700);
    const broken: AccountingData = {
      ...r.state,
      receipts: r.state.receipts.map((x) => (x.id === r.receipt.id ? { ...x, isTaxInvoice: false, etax: undefined } : x)),
    };
    const problems = validateAccountingData(broken).join('\n');
    expect(problems).toMatch(/ใบเสร็จรับเงิน\/ใบกำกับภาษี/);
    const leftover: AccountingData = {
      ...r.state,
      receipts: r.state.receipts.map((x) => (x.id === r.receipt.id ? { ...x, vat: 600 } : x)),
    };
    expect(validateAccountingData(leftover).join('\n')).toMatch(/ภาษีขายรอตัด|2151/);
  });

  it('plan problems: VAT above deferred (not settling) and tax-mode caps', () => {
    const part = receive(s0, doc.id, '2026-11-01', 5350);
    const inv = part.state.sales.find((x) => x.id === doc.id) ?? doc;
    // ไม่ปิดยอด แต่ VAT ของเอกสารเกินภาษีรอตัด (ทดสอบตรงที่ domain)
    expect(serviceCreditNotePlan(part.state, inv, { net: 1000, vat: 400, total: 1400 })?.problem).toMatch(/เกินภาษีขายรอตัด/);
    expect(serviceCreditNotePlan(part.state, inv, { net: 5000, vat: 300, total: 5350 })?.problem).toMatch(/เกินเศษปัด/);
    const full = receive(part.state, doc.id, '2026-11-02', 5350);
    const paidInv = full.state.sales.find((x) => x.id === doc.id) ?? doc;
    expect(serviceCreditNotePlan(full.state, paidInv, { net: 100, vat: 800, total: 900 })?.problem).toMatch(/เกินภาษีขายที่ออกใบกำกับ/);
    expect(serviceCreditNotePlan(full.state, paidInv, { net: 20000, vat: 1, total: 20001 })?.problem).toMatch(/เกินมูลค่าที่ออกใบกำกับ/);
    expect(serviceCreditNotePlan(full.state, s0.sales[1], { net: 1, vat: 0, total: 1 })).toBeNull();
  });

  it('integrity flags a debit note or an unreferenced tax credit note on a service invoice', () => {
    const r = receive(s0, doc.id, '2026-11-01', 10700);
    const cn = issueCreditNote(r.state, { invoiceId: doc.id, date: '2026-11-02', reason: 'ลดราคา', lines: [ln(1, 100, ACC.service)] });
    const noRef: AccountingData = {
      ...cn.state,
      sales: cn.state.sales.map((x) => (x.id === cn.doc.id ? { ...x, refReceiptId: undefined } : x)),
    };
    expect(validateAccountingData(noRef).join()).toMatch(/ต้องอ้างใบเสร็จรับเงิน\/ใบกำกับภาษี/);
    const asDebit: AccountingData = {
      ...cn.state,
      sales: cn.state.sales.map((x) => (x.id === cn.doc.id ? { ...x, kind: 'debit-note' as const } : x)),
    };
    expect(validateAccountingData(asDebit).join()).toMatch(/ใบเพิ่มหนี้ของใบแจ้งหนี้งานบริการ/);
  });
});
