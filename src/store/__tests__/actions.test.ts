import type { AccountingData } from 'src/domain';

import {
  ACC,
  isBalanced,
  trialBalance,
  buildETaxXml,
  calcDocument,
  salesDocTitle,
  salesVatReport,
  purchaseVatReport,
  whtPayeesForPeriod,
  validateAccountingData,
} from 'src/domain';

import { ln, pln, demo, TODAY } from './fixtures';
import {
  lockPeriod,
  payPurchase,
  lastDocDate,
  outstandingOf,
  setETaxStatus,
  updateCompany,
  upsertContact,
  importContacts,
  recordPurchase,
  receivePayment,
  issueCreditNote,
  issueTaxInvoice,
  addManualJournal,
  assertOpenPeriod,
  BusinessRuleError,
} from '../actions';

// ----------------------------------------------------------------------

const october = { year: 2026, month: 10 };

function openInvoice(data: AccountingData) {
  const invoice = data.sales.find((s) => s.kind === 'tax-invoice' && s.status === 'issued');
  if (!invoice) throw new Error('fixture: ไม่มีใบกำกับค้างชำระ');
  return invoice;
}

const invoiceInput = (overrides: Partial<Parameters<typeof issueTaxInvoice>[1]> = {}) => ({
  date: TODAY,
  dueDate: '2026-11-23',
  contactId: 'c-abc',
  vatMode: 'exclusive' as const,
  lines: [ln(10, 100)],
  ...overrides,
});

const purchaseInput = (overrides: Partial<Parameters<typeof recordPurchase>[1]> = {}) => ({
  supplierInvoiceNo: 'NEW-001',
  supplierInvoiceDate: TODAY,
  vatClaimPeriod: '2026-10',
  date: TODAY,
  contactId: 'v-resin',
  vatMode: 'exclusive' as const,
  claimVat: true,
  whtCondition: '1' as const,
  lines: [pln(1, 1000, ACC.cogs)],
  ...overrides,
});

describe('demo data and actions', () => {
  const data = demo();

  it('builds a consistent ledger that passes every invariant', () => {
    expect(data.journal.every((e) => isBalanced(e.lines))).toBe(true);
    const tb = trialBalance(data.accounts, data.journal);
    const debit = tb.reduce((s, r) => s + Math.round(r.debit * 100), 0);
    const credit = tb.reduce((s, r) => s + Math.round(r.credit * 100), 0);
    expect(debit).toBe(credit);
    expect(validateAccountingData(data)).toEqual([]);
  });

  it('numbers documents per month without gaps', () => {
    const oct = data.sales.filter((s) => s.kind === 'tax-invoice' && s.date.startsWith('2026-10'));
    expect(oct.map((s) => s.docNo)).toEqual(['IV6910-0001', 'IV6910-0002', 'IV6910-0003', 'IV6910-0004']);
  });

  it('feeds the tax reports for the current month', () => {
    const rows = salesVatReport(data.sales, data.contacts, october);
    expect(rows.some((r) => r.kind === 'credit-note' && r.vat < 0)).toBe(true);
    const pnd3 = whtPayeesForPeriod(data, october, 'PND3');
    expect(pnd3.map((p) => p.contact.name).sort()).toEqual(['สมชาย', 'สมศรี']);
  });

  it('blocks over-receipt and over-credit with a clear message', () => {
    const invoice = openInvoice(data);
    const outstanding = outstandingOf(data, invoice);
    expect(() =>
      receivePayment(data, {
        invoiceId: invoice.id,
        date: TODAY,
        amount: outstanding + 1,
        whtAmount: 0,
        depositAccountCode: ACC.bank,
      })
    ).toThrow(BusinessRuleError);
    expect(() =>
      issueCreditNote(data, {
        invoiceId: invoice.id,
        date: TODAY,
        reason: 'ทดสอบ',
        lines: [ln(1, outstanding)],
      })
    ).toThrow(/เกินยอดที่ลดได้/);
  });

  it('marks an invoice paid after full receipt', () => {
    const invoice = openInvoice(data);
    const next = receivePayment(data, {
      invoiceId: invoice.id,
      date: TODAY,
      amount: outstandingOf(data, invoice),
      whtAmount: 0,
      depositAccountCode: ACC.bank,
    }).state;
    expect(next.sales.find((s) => s.id === invoice.id)?.status).toBe('paid');
  });
});

describe('date validation (A4)', () => {
  const data = demo();

  it.each(['2569-10-24', '', '2026-02-30', '24/10/2026', '1999-12-31'])('rejects date "%s"', (date) => {
    expect(() => issueTaxInvoice(data, invoiceInput({ date }))).toThrow(/ค\.ศ\./);
    expect(() => addManualJournal(data, { date, description: 'x', lines: [] })).toThrow(BusinessRuleError);
  });

  it('rejects an invalid or earlier due date', () => {
    expect(() => issueTaxInvoice(data, invoiceInput({ dueDate: '2569-11-01' }))).toThrow(/วันครบกำหนด/);
    expect(() => issueTaxInvoice(data, invoiceInput({ dueDate: '2026-10-01' }))).toThrow(/ไม่ก่อนวันที่เอกสาร/);
  });

  it('keeps document dates in number order per prefix', () => {
    expect(lastDocDate(data, 'IV')).toBe('2026-10-21');
    expect(() => issueTaxInvoice(data, invoiceInput({ date: '2026-10-20' }))).toThrow(/เรียงตามวันที่/);
    expect(issueTaxInvoice(data, invoiceInput({ date: '2026-10-21' })).doc.docNo).toBe('IV6910-0005');
    // PI บังคับตั้งแต่ v4 (วันที่ = วันที่บันทึก) — ใบกำกับผู้ขายที่ลงวันที่ก่อนหน้าบันทึกวันนี้ได้ด้วย supplierInvoiceDate
    expect(lastDocDate(data, 'PI')).toBe('2026-10-14');
    expect(() => recordPurchase(data, purchaseInput({ date: '2026-10-02', supplierInvoiceDate: '2026-10-02' }))).toThrow(
      /เรียงตามวันที่/
    );
    expect(() => recordPurchase(data, purchaseInput({ supplierInvoiceDate: '2026-10-02' }))).not.toThrow();
  });
});

describe('period lock (A4)', () => {
  // ปิดงวดได้ไม่เกินสิ้นเดือนก่อนหน้า "วันนี้" — ทดสอบด้วยวันนี้สมมติเป็นเดือนถัดไป
  const LATER = '2026-11-05';
  const locked = lockPeriod(demo(), '2026-10-22', LATER);

  it('blocks every posting action on or before the locked date', () => {
    const invoice = openInvoice(locked);
    const unpaid = locked.purchases.find((p) => !p.paid);
    expect(unpaid).toBeDefined();
    const attempts = [
      () => issueTaxInvoice(locked, invoiceInput({ date: '2026-10-22' })),
      () => issueCreditNote(locked, { invoiceId: invoice.id, date: '2026-10-22', reason: 'x', lines: [ln(1, 1)] }),
      () =>
        receivePayment(locked, { invoiceId: invoice.id, date: '2026-10-22', amount: 1, whtAmount: 0, depositAccountCode: ACC.bank }),
      () => recordPurchase(locked, purchaseInput({ date: '2026-10-01' })),
      () => payPurchase(locked, { purchaseId: unpaid?.id ?? '', date: '2026-10-22', accountCode: ACC.bank }),
      () =>
        addManualJournal(locked, {
          date: '2026-10-22',
          description: 'x',
          lines: [
            { accountCode: ACC.misc, debit: 1, credit: 0 },
            { accountCode: ACC.bank, debit: 0, credit: 1 },
          ],
        }),
    ];
    attempts.forEach((attempt) => expect(attempt).toThrow(/ปิดงวด/));
    expect(() => assertOpenPeriod(locked, '2026-10-23')).not.toThrow();
    expect(issueTaxInvoice(locked, invoiceInput()).doc.date).toBe(TODAY);
  });

  it('only moves the lock forward', () => {
    expect(() => lockPeriod(locked, '2026-09-30', LATER)).toThrow(/ย้อนหลังไม่ได้/);
    expect(lockPeriod(locked, '2026-10-22', LATER).company.lockedThrough).toBe('2026-10-22');
    expect(lockPeriod(locked, '2026-10-31', LATER).company.lockedThrough).toBe('2026-10-31');
    expect(() => lockPeriod(locked, '2569-10-31', LATER)).toThrow(/วันที่ปิดงวด/);
  });

  it('T8: cannot lock beyond the end of the previous month (no irreversible future lock)', () => {
    expect(() => lockPeriod(demo(), '2026-10-31', TODAY)).toThrow(/30\/09\/2569/);
    expect(() => lockPeriod(demo(), '2099-12-31', TODAY)).toThrow(/สิ้นเดือนที่ผ่านมา/);
    expect(lockPeriod(demo(), '2026-09-30', TODAY).company.lockedThrough).toBe('2026-09-30');
    expect(lockPeriod(demo(), '2026-11-30', '2026-12-01').company.lockedThrough).toBe('2026-11-30');
  });

  it('cannot be undone through updateCompany', () => {
    const next = updateCompany(locked, { ...locked.company, lockedThrough: undefined, name: 'ใหม่' });
    expect(next.company.lockedThrough).toBe('2026-10-22');
    expect(next.company.name).toBe('ใหม่');
  });
});

describe('line validation (A8)', () => {
  const data = demo();
  it.each([
    [[], /อย่างน้อย 1 รายการ/],
    [[{ ...ln(1, 1), description: ' ' }], /ยังไม่มีคำอธิบาย/],
    [[ln(0, 100)], /จำนวนต้องมากกว่า 0/],
    [[ln(Number.NaN, 100)], /จำนวนต้องมากกว่า 0/],
    [[ln(1, -5)], /ราคาต่อหน่วยติดลบ/],
    [[ln(1, 100, ACC.sales, -1)], /ส่วนลดติดลบ/],
    [[ln(2, 100, ACC.sales, 200.01)], /ส่วนลดเกินมูลค่า/],
    [[ln(1, 100, '9999')], /ไม่พบบัญชี 9999/],
    [[ln(1, 0)], /ยอดรวมเอกสารต้องมากกว่า 0/],
    [[ln(2, 100, ACC.sales, 200)], /ยอดรวมเอกสารต้องมากกว่า 0/],
  ])('rejects bad lines %#', (lines, message) => {
    expect(() => issueTaxInvoice(data, invoiceInput({ lines }))).toThrow(message);
  });

  it('rejects an unknown contact', () => {
    expect(() => issueTaxInvoice(data, invoiceInput({ contactId: 'nope' }))).toThrow(/ไม่พบผู้ติดต่อ/);
  });
});

describe('non-VAT company (A1)', () => {
  const data = updateCompany(demo(), { ...demo().company, vatRegistered: false });

  it('issues a non-tax invoice with its own prefix and no output VAT', () => {
    const { state, doc } = issueTaxInvoice(data, invoiceInput());
    expect(doc.docNo).toBe('BL6910-0001');
    expect(doc.isTaxInvoice).toBe(false);
    expect(doc.vatMode).toBe('none');
    expect(doc.etax).toBe('not-required');
    expect(salesDocTitle(doc)).toBe('ใบแจ้งหนี้/ใบเสร็จรับเงิน');
    const entry = state.journal[state.journal.length - 1];
    expect(entry.lines.some((l) => l.accountCode === ACC.outputVat)).toBe(false);
    expect(salesVatReport(state.sales, state.contacts, october).some((r) => r.id === doc.id)).toBe(false);
    expect(() => buildETaxXml({ doc, company: state.company })).toThrow(/ไม่ใช่ใบกำกับภาษี/);

    const cn = issueCreditNote(state, { invoiceId: doc.id, date: TODAY, reason: 'คืน', lines: [ln(1, 100)] });
    expect(cn.doc.docNo).toBe('CM6910-0001');
    expect(salesDocTitle(cn.doc)).toBe('ใบลดหนี้');
    expect(validateAccountingData(cn.state)).toEqual([]);
  });

  it('never claims input VAT', () => {
    const { doc, state } = recordPurchase(data, purchaseInput());
    expect(doc.claimVat).toBe(false);
    expect(state.journal[state.journal.length - 1].lines.some((l) => l.accountCode === ACC.inputVat)).toBe(false);
    expect(purchaseVatReport(state.purchases, state.contacts, october).some((r) => r.id === doc.id)).toBe(false);
  });
});

describe('credit note rules', () => {
  const data = demo();
  const invoice = openInvoice(data);

  it('requires a known invoice, a reason and a date not before the invoice', () => {
    const base = { invoiceId: invoice.id, date: TODAY, reason: 'คืน', lines: [ln(1, 10)] };
    expect(() => issueCreditNote(data, { ...base, invoiceId: 'x' })).toThrow(/ไม่พบใบกำกับ/);
    expect(() => issueCreditNote(data, { ...base, reason: ' ' })).toThrow(/ระบุเหตุผล/);
    expect(() => issueCreditNote(data, { ...base, date: '2026-01-01' })).toThrow(/ไม่ก่อนวันที่ใบกำกับเดิม/);
    expect(issueCreditNote(data, base).doc.etax).toBe('pending-sign');
  });
});

describe('receipts', () => {
  const data = demo();
  const invoice = openInvoice(data);
  const base = { invoiceId: invoice.id, date: TODAY, amount: 100, whtAmount: 0, depositAccountCode: ACC.bank };

  it('validates invoice, amount, withholding, date and account', () => {
    expect(() => receivePayment(data, { ...base, invoiceId: 'x' })).toThrow(/ไม่พบใบกำกับภาษี/);
    expect(() => receivePayment(data, { ...base, amount: 0 })).toThrow(/มากกว่า 0/);
    expect(() => receivePayment(data, { ...base, whtAmount: 100 })).toThrow(/น้อยกว่ายอดรับชำระ/);
    expect(() => receivePayment(data, { ...base, whtAmount: -1 })).toThrow(/น้อยกว่ายอดรับชำระ/);
    expect(() => receivePayment(data, { ...base, date: '2026-01-01' })).toThrow(/ไม่ก่อนวันที่ใบกำกับ/);
    expect(() => receivePayment(data, { ...base, depositAccountCode: ACC.receivable })).toThrow(/รับ\/จ่ายเงินไม่ได้/);
    expect(() => receivePayment(data, { ...base, depositAccountCode: ACC.sales })).toThrow(/รับ\/จ่ายเงินไม่ได้/);
    const r = receivePayment(data, { ...base, whtAmount: 3 });
    expect(r.receipt.buyer?.name).toBeDefined();
    expect(r.state.sales.find((s) => s.id === invoice.id)?.status).toBe('partial');
  });
});

describe('purchases (A6, A7)', () => {
  const data = demo();

  it('validates withholding and supplier invoice numbers', () => {
    expect(() => recordPurchase(data, purchaseInput({ lines: [{ ...pln(1, 1000), whtRate: -1 }] }))).toThrow(/อัตราหัก/);
    expect(() => recordPurchase(data, purchaseInput({ lines: [pln(1, 1000, ACC.misc, [' ', 3])] }))).toThrow(/ประเภทเงินได้/);
    expect(() => recordPurchase(data, purchaseInput({ supplierInvoiceNo: ' ' }))).toThrow(/เลขที่ใบกำกับภาษีของผู้ขาย/);
  });

  it('rejects a duplicate supplier invoice number from the same supplier', () => {
    expect(() => recordPurchase(data, purchaseInput({ supplierInvoiceNo: 'TP-2025-1302' }))).toThrow(/บันทึกไปแล้ว/);
    expect(() => recordPurchase(data, purchaseInput({ supplierInvoiceNo: ' tp-2025-1302 ' }))).toThrow(/บันทึกไปแล้ว/);
    expect(() =>
      recordPurchase(data, purchaseInput({ supplierInvoiceNo: 'TP-2025-1302', contactId: 'v-express' }))
    ).not.toThrow();
  });

  it('stores a payment voucher and numbers 50 ทวิ only when withholding', () => {
    const noWht = recordPurchase(data, purchaseInput({ payNow: { date: TODAY, accountCode: ACC.bank } }));
    expect(noWht.payment?.docNo).toBe('PV6910-0004');
    expect(noWht.payment?.whtCertNo).toBeUndefined();
    expect(noWht.state.sequences.WT6910).toBe(data.sequences.WT6910);
    const entry = noWht.state.journal[noWht.state.journal.length - 1];
    expect(entry.sourceDocNo).toBe('PV6910-0004');
    expect(entry.sourceId).toBe(noWht.payment?.id);

    const wht = recordPurchase(
      noWht.state,
      purchaseInput({
        supplierInvoiceNo: 'NEW-002',
        lines: [pln(1, 1000, ACC.misc, ['ค่าบริการ', 3])],
        payNow: { date: TODAY, accountCode: ACC.bank },
      })
    );
    expect(wht.payment?.docNo).toBe('PV6910-0005');
    expect(wht.payment?.whtCertNo).toBe('WT6910-0004');
    expect(wht.payment?.whtItems).toEqual([{ incomeType: 'ค่าบริการ', rate: 3, base: 1000, tax: 30 }]);
    expect(wht.doc.paid).toBe(true);
    expect(wht.payment?.netPaid).toBe(1040);
    expect(validateAccountingData(wht.state)).toEqual([]);
  });

  it('validates payments', () => {
    const paid = data.purchases.find((p) => p.paid);
    const unpaid = data.purchases.find((p) => !p.paid);
    if (!paid || !unpaid) throw new Error('fixture');
    expect(() => payPurchase(data, { purchaseId: 'x', date: TODAY, accountCode: ACC.bank })).toThrow(/ไม่พบเอกสารซื้อ/);
    expect(() => payPurchase(data, { purchaseId: paid.id, date: TODAY, accountCode: ACC.bank })).toThrow(/จ่ายชำระแล้ว/);
    expect(() => payPurchase(data, { purchaseId: unpaid.id, date: '2026-10-01', accountCode: ACC.bank })).toThrow(
      /ไม่ก่อนวันที่เอกสาร/
    );
    expect(() => payPurchase(data, { purchaseId: unpaid.id, date: TODAY, accountCode: ACC.payable })).toThrow(
      /รับ\/จ่ายเงินไม่ได้/
    );
    // PV ใบล่าสุดลงวันที่ 18 ต.ค. — จ่ายวันที่ 17 ไม่ได้
    expect(() => payPurchase(data, { purchaseId: unpaid.id, date: '2026-10-17', accountCode: ACC.bank })).toThrow(
      /เรียงตามวันที่/
    );
  });
});

describe('manual journal (A11)', () => {
  const data = demo();
  const jv = (lines: { accountCode: string; debit: number; credit: number }[], description = 'ปรับปรุง') =>
    addManualJournal(data, { date: TODAY, description, lines });

  it('rejects control accounts but allows cash/bank and P&L accounts', () => {
    [ACC.receivable, ACC.inputVat, ACC.outputVat, ACC.whtPayable, ACC.payable, ACC.customerCredit].forEach((code) => {
      expect(() =>
        jv([
          { accountCode: code, debit: 100, credit: 0 },
          { accountCode: ACC.bank, debit: 0, credit: 100 },
        ])
      ).toThrow(/บัญชีคุม/);
    });
    const ok = jv([
      { accountCode: ACC.misc, debit: 100, credit: 0 },
      { accountCode: ACC.bank, debit: 0, credit: 100 },
    ]);
    expect(ok.entry.source).toBe('manual');
  });

  it('rejects unknown accounts, negatives, empty and unbalanced entries', () => {
    expect(() => jv([{ accountCode: '9999', debit: 1, credit: 0 }])).toThrow(/ไม่พบบัญชี/);
    expect(() =>
      jv([
        { accountCode: ACC.misc, debit: -1, credit: 0 },
        { accountCode: ACC.bank, debit: 0, credit: -1 },
      ])
    ).toThrow(/ติดลบ/);
    expect(() => jv([{ accountCode: ACC.misc, debit: 0, credit: 0 }])).toThrow(/มากกว่า 0/);
    expect(() => jv([{ accountCode: ACC.misc, debit: 1, credit: 0 }], ' ')).toThrow(/คำอธิบาย/);
    expect(() =>
      jv([
        { accountCode: ACC.misc, debit: 1, credit: 0 },
        { accountCode: ACC.bank, debit: 0, credit: 2 },
      ])
    ).toThrow(BusinessRuleError);
    // C4b: ไม่สมดุล = BusinessRuleError (API ตอบ 422 JOURNAL_UNBALANCED) ไม่ใช่ UnbalancedEntryError ภายใน
    expect(() =>
      jv([
        { accountCode: ACC.misc, debit: 100, credit: 0 },
        { accountCode: ACC.bank, debit: 0, credit: 99.99 },
      ])
    ).toThrow('รายการไม่สมดุล: เดบิต 100.00 ≠ เครดิต 99.99 (ต่าง 0.01)');
  });
});

describe('contacts and snapshots (A5)', () => {
  const data = demo();

  it('validates contacts and imports only new codes', () => {
    const abc = data.contacts[0];
    expect(() => upsertContact(data, { ...abc, name: ' ' })).toThrow(/ต้องระบุชื่อ/);
    expect(() => upsertContact(data, { ...abc, id: undefined })).toThrow(/ซ้ำกับ/);
    expect(upsertContact(data, { ...abc, id: undefined, code: 'C9999' }).contacts).toHaveLength(data.contacts.length + 1);
    const r = importContacts(data, [{ ...abc, code: 'C0001' }, { ...abc, code: 'C0100' }]);
    expect([r.added, r.skipped]).toEqual([1, 1]);
  });

  it('keeps reports and XML on the data printed at issue time', () => {
    const { state, doc } = issueTaxInvoice(data, invoiceInput());
    const abc = state.contacts.find((c) => c.id === 'c-abc');
    if (!abc) throw new Error('fixture');
    let next = upsertContact(state, { ...abc, name: 'ชื่อใหม่', taxId: '1101700230708', branchNo: '00009' });
    next = updateCompany(next, { ...next.company, name: 'บริษัทชื่อใหม่' });
    const row = salesVatReport(next.sales, next.contacts, october).find((r) => r.id === doc.id);
    expect(row?.contactName).toBe('บริษัท เอบีซี ออโต้พาร์ท จำกัด');
    expect(row?.taxId).toBe('0105565012341');
    const updatedAbc = next.contacts.find((c) => c.id === 'c-abc');
    const xml = buildETaxXml({ doc, company: next.company, buyer: updatedAbc });
    expect(xml).toContain('บริษัท สาธิต แมนูแฟคเจอริ่ง จำกัด');
    expect(xml).toContain('010556501234100000');

    const somsri = next.contacts.find((c) => c.id === 'v-somsri');
    if (!somsri) throw new Error('fixture');
    next = upsertContact(next, { ...somsri, legalForm: 'juristic', name: 'เปลี่ยนชื่อ' });
    const pnd3 = whtPayeesForPeriod(next, october, 'PND3');
    expect(pnd3.map((p) => p.contact.name).sort()).toEqual(['สมชาย', 'สมศรี']);
    expect(pnd3[0].contact.id).toMatch(/^v-/);
  });
});

describe('e-Tax status (A12)', () => {
  const data = demo();
  const pending = data.sales.find((s) => s.etax === 'pending-sign');
  const signed = data.sales.find((s) => s.etax === 'signed');
  const uploaded = data.sales.find((s) => s.etax === 'uploaded');

  it('moves forward only and records upload time and reference', () => {
    if (!pending || !signed || !uploaded) throw new Error('fixture');
    expect(() => setETaxStatus(data, [uploaded.id], 'signed')).toThrow(/ย้อนกลับไม่ได้/);
    expect(() => setETaxStatus(data, [signed.id], 'pending-sign')).toThrow(/ย้อนกลับไม่ได้/);
    expect(() => setETaxStatus(data, ['nope'], 'signed')).toThrow(/ไม่พบเอกสาร/);
    expect(() => setETaxStatus(data, [pending.id], 'not-required')).toThrow(BusinessRuleError);

    // Z-soft etaxSkipSigned: ข้ามขั้นลงนามไม่ได้
    expect(() => setETaxStatus(data, [pending.id], 'uploaded')).toThrow(/ต้องลงนามก่อน/);

    const signedAll = setETaxStatus(data, [pending.id], 'signed');
    const next = setETaxStatus(signedAll, [pending.id, signed.id], 'uploaded', { at: '2026-10-24T09:00:00Z', reference: ' RD-1 ' });
    const doc = next.sales.find((s) => s.id === pending.id);
    expect(doc?.etax).toBe('uploaded');
    expect(doc?.etaxUploadedAt).toBe('2026-10-24T09:00:00Z');
    expect(doc?.etaxReference).toBe('RD-1');
    // สถานะเดิมซ้ำ = ไม่เปลี่ยน
    expect(setETaxStatus(next, [pending.id], 'uploaded').sales.find((s) => s.id === pending.id)).toBe(doc);
  });

  it('refuses documents that do not need e-Tax', () => {
    const nonVat = updateCompany(data, { ...data.company, vatRegistered: false });
    const { state, doc } = issueTaxInvoice(nonVat, invoiceInput());
    expect(() => setETaxStatus(state, [doc.id], 'signed')).toThrow(/ไม่ต้องออก e-Tax/);
  });

  it('totals stay unchanged by status changes', () => {
    if (!pending) throw new Error('fixture');
    const before = calcDocument(pending).total;
    const after = setETaxStatus(data, [pending.id], 'signed').sales.find((s) => s.id === pending.id);
    expect(after && calcDocument(after).total).toBe(before);
  });
});
