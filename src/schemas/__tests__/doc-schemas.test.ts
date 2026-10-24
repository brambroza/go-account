import { ACC } from 'src/domain';

import {
  monthEndOf,
  CompanySchema,
  ContactSchema,
  PurchaseSchema,
  TransferSchema,
  CloseYearSchema,
  makeRefundSchema,
  makeReceiptSchema,
  SalesInvoiceSchema,
  QuotationFormSchema,
  StatementLineSchema,
  makeLockPeriodSchema,
  makePayPurchaseSchema,
  BankAccountFormSchema,
  PettyCashExpenseSchema,
  makeSupplierRefundSchema,
  SupplierCreditNoteSchema,
  OpeningBalanceFormSchema,
} from '../accounting/doc-schemas';

// ----------------------------------------------------------------------

const line = { id: 'l', description: 'สินค้า', qty: 1, unitPrice: 100, discount: 0, accountCode: ACC.sales };

describe('form schemas', () => {
  it('validates sales invoice dates', () => {
    const base = { contactId: 'c', date: '2026-10-24', dueDate: '2026-11-23', vatMode: 'exclusive', lines: [line] };
    expect(SalesInvoiceSchema.safeParse(base).success).toBe(true);
    expect(SalesInvoiceSchema.safeParse({ ...base, dueDate: '2026-10-01' }).success).toBe(false);
    expect(SalesInvoiceSchema.safeParse({ ...base, lines: [{ ...line, qty: 0 }] }).success).toBe(false);
    // D1: รับเงินคืนจากผู้ขายไม่เกินยอดคงค้าง
    const sr = makeSupplierRefundSchema(500);
    expect(sr.safeParse({ date: '2026-10-24', amount: 500, accountCode: ACC.bank }).success).toBe(true);
    expect(sr.safeParse({ date: '2026-10-24', amount: 500.01, accountCode: ACC.bank }).success).toBe(false);
    expect(sr.safeParse({ date: '2026-10-24', amount: 0, accountCode: ACC.bank }).success).toBe(false);
    // U13: วันที่ไม่มีในปฏิทิน ฟ้องที่ช่องวันที่เอง ไม่ใช่ช่องวันครบกำหนด
    ['2026-09-31T00:00:00.000', 'Invalid Date'].forEach((date) => {
      const r = SalesInvoiceSchema.safeParse({ ...base, date });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toEqual(['date']);
    });
  });

  it('requires income type per line, supplier invoice number / date and claim period when needed', () => {
    const pline = { ...line, accountCode: ACC.misc, whtIncomeType: '', whtRate: 0 };
    const base = {
      contactId: 'v',
      supplierInvoiceNo: 'A1',
      supplierInvoiceDate: '2026-10-20',
      vatClaimPeriod: '2026-10',
      date: '2026-10-24',
      vatMode: 'exclusive',
      claimVat: true,
      whtCondition: '1',
      payNow: false,
      paymentAccountCode: ACC.bank,
      lines: [pline],
    };
    expect(PurchaseSchema.safeParse(base).success).toBe(true);
    expect(PurchaseSchema.safeParse({ ...base, lines: [{ ...pline, whtRate: 3 }] }).success).toBe(false);
    expect(PurchaseSchema.safeParse({ ...base, lines: [{ ...pline, whtRate: 3, whtIncomeType: 'ค่าบริการ' }] }).success).toBe(true);
    expect(PurchaseSchema.safeParse({ ...base, lines: [{ ...pline, whtRate: 20, whtIncomeType: 'x' }] }).success).toBe(false);
    expect(PurchaseSchema.safeParse({ ...base, supplierInvoiceNo: '' }).success).toBe(false);
    expect(PurchaseSchema.safeParse({ ...base, supplierInvoiceDate: '' }).success).toBe(false);
    expect(PurchaseSchema.safeParse({ ...base, supplierInvoiceDate: '2026-10-25' }).success).toBe(false);
    expect(PurchaseSchema.safeParse({ ...base, vatClaimPeriod: '' }).success).toBe(false);
    expect(PurchaseSchema.safeParse({ ...base, claimVat: false, supplierInvoiceDate: '', vatClaimPeriod: '' }).success).toBe(true);
  });

  it('checks tax ids and postcodes', () => {
    const contact = { code: 'C1', kind: 'customer', legalForm: 'juristic', title: '', name: 'A', creditDays: 0, address: {} };
    expect(ContactSchema.safeParse({ ...contact, taxId: '1101700230708' }).success).toBe(true);
    expect(ContactSchema.safeParse({ ...contact, taxId: '1101700230709' }).success).toBe(false);
    expect(ContactSchema.safeParse({ ...contact, address: { postalCode: '123' } }).success).toBe(false);
    const company = { name: 'บ', taxId: '1101700230708', branchNo: '00000', vatRegistered: true, address: {} };
    expect(CompanySchema.safeParse(company).success).toBe(true);
    expect(CompanySchema.safeParse({ ...company, branchNo: 'HQ' }).success).toBe(false);
  });
});

describe('dialog schemas', () => {
  it('limits receipt amount to outstanding and date to invoice date', () => {
    const schema = makeReceiptSchema(1070, '2026-10-01');
    const base = { date: '2026-10-24', amount: 1070, whtRate: 0, whtAmount: 0, depositAccountCode: ACC.bank };
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, amount: 1070.01 }).success).toBe(false);
    expect(schema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...base, date: '2026-09-30' }).success).toBe(false);
    expect(schema.safeParse({ ...base, amount: 30, whtAmount: 30 }).success).toBe(false);
  });

  it('limits refund to available customer credit', () => {
    const schema = makeRefundSchema(500);
    const base = { date: '2026-10-24', amount: 500, accountCode: ACC.bank };
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, amount: 500.01 }).success).toBe(false);
  });

  it('pay purchase date not before document date', () => {
    const schema = makePayPurchaseSchema('2026-10-10', 1070);
    expect(schema.safeParse({ date: '2026-10-10', accountCode: ACC.bank }).success).toBe(true);
    expect(schema.safeParse({ date: '2026-10-09', accountCode: ACC.bank }).success).toBe(false);
    // แบ่งจ่าย: 0.01 ถึงยอดค้าง
    expect(schema.safeParse({ date: '2026-10-10', accountCode: ACC.bank, amount: 500 }).success).toBe(true);
    expect(schema.safeParse({ date: '2026-10-10', accountCode: ACC.bank, amount: 1070.01 }).success).toBe(false);
    expect(schema.safeParse({ date: '2026-10-10', accountCode: ACC.bank, amount: 0 }).success).toBe(false);
  });

  it('period lock moves forward only, to month end', () => {
    expect(monthEndOf('2026-02-10')).toBe('2026-02-28');
    expect(monthEndOf('2028-02-01')).toBe('2028-02-29');
    expect(monthEndOf('2026-12-31')).toBe('2026-12-31');
    const schema = makeLockPeriodSchema('2026-09-30', '2026-11-05');
    expect(schema.safeParse({ month: '2026-10-01' }).success).toBe(true);
    expect(schema.safeParse({ month: '2026-09-01' }).success).toBe(false);
    expect(makeLockPeriodSchema('2026-09-15', '2026-11-05').safeParse({ month: '2026-09-01' }).success).toBe(true);
    expect(makeLockPeriodSchema(undefined, '2026-11-05').safeParse({ month: '2026-01-01' }).success).toBe(true);
    // T8: เดือนที่ยังไม่สิ้นสุด (หรืออนาคต) ปิดไม่ได้
    expect(makeLockPeriodSchema(undefined, '2026-10-24').safeParse({ month: '2026-10-01' }).success).toBe(false);
    expect(makeLockPeriodSchema(undefined, '2026-10-24').safeParse({ month: '2099-12-01' }).success).toBe(false);
  });

  it('sales invoice: sale type defaults to goods, service accepted (B2)', () => {
    const base = { contactId: 'c', date: '2026-10-24', dueDate: '2026-11-23', vatMode: 'exclusive', lines: [line] };
    const parsed = SalesInvoiceSchema.safeParse(base);
    expect(parsed.success && parsed.data.saleType).toBe('goods');
    const service = SalesInvoiceSchema.safeParse({ ...base, saleType: 'service' });
    expect(service.success && service.data.saleType).toBe('service');
    expect(SalesInvoiceSchema.safeParse({ ...base, saleType: 'rent' }).success).toBe(false);
  });

  it('supplier credit note: dates and reason (B8)', () => {
    const base = { supplierCreditNoteNo: 'CN-1', supplierCreditNoteDate: '2026-11-03', date: '2026-11-05', reason: 'คืนสินค้า', lines: [line] };
    expect(SupplierCreditNoteSchema.safeParse(base).success).toBe(true);
    expect(SupplierCreditNoteSchema.safeParse({ ...base, supplierCreditNoteDate: '2026-11-06' }).success).toBe(false);
    expect(SupplierCreditNoteSchema.safeParse({ ...base, reason: ' ' }).success).toBe(false);
    expect(SupplierCreditNoteSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
  });

  it('close year: fiscal year end must be a month end (B5)', () => {
    expect(CloseYearSchema.safeParse({ fiscalYearEnd: '2026-12-31' }).success).toBe(true);
    expect(CloseYearSchema.safeParse({ fiscalYearEnd: '2026-12-30' }).success).toBe(false);
    expect(CloseYearSchema.safeParse({ fiscalYearEnd: '' }).success).toBe(false);
  });

  it('opening balance form: item rules (B5)', () => {
    const base = {
      date: '2026-09-30',
      vatCredit: 0,
      whtReceivable: 0,
      receivableControl: 100,
      payableControl: 50,
      lines: [{ accountCode: ACC.bank, debit: 50, credit: 0 }],
      receivables: [{ contactId: 'c', docNo: 'IV-1', date: '2026-09-01', dueDate: '2026-09-30', amount: 100 }],
      payables: [{ contactId: 'v', docNo: 'P-1', date: '2026-09-01', amount: 50, vatAmount: 0, whtIncomeType: '', whtRate: 0 }],
    };
    expect(OpeningBalanceFormSchema.safeParse(base).success).toBe(true);
    const badDue = { ...base, receivables: [{ ...base.receivables[0], dueDate: '2026-08-01' }] };
    expect(OpeningBalanceFormSchema.safeParse(badDue).success).toBe(false);
    const badVat = { ...base, payables: [{ ...base.payables[0], vatAmount: 50 }] };
    expect(OpeningBalanceFormSchema.safeParse(badVat).success).toBe(false);
    const noType = { ...base, payables: [{ ...base.payables[0], whtRate: 3 }] };
    expect(OpeningBalanceFormSchema.safeParse(noType).success).toBe(false);
    expect(OpeningBalanceFormSchema.safeParse({ ...base, lines: [{ accountCode: ACC.bank, debit: -1, credit: 0 }] }).success).toBe(false);
  });

  it('batch 4 forms: quotation, transfer, bank account, petty cash, statement line', () => {
    const q = { contactId: 'c', date: '2026-10-24', validDays: 30, vatMode: 'exclusive', lines: [line] };
    expect(QuotationFormSchema.safeParse(q).success).toBe(true);
    expect(QuotationFormSchema.safeParse({ ...q, validDays: 1.5 }).success).toBe(false);
    expect(QuotationFormSchema.safeParse({ ...q, validDays: 400 }).success).toBe(false);
    expect(QuotationFormSchema.safeParse({ ...q, contactId: '' }).success).toBe(false);

    const t = { date: '2026-10-24', fromAccountCode: ACC.bank, toAccountCode: ACC.cash, amount: 100 };
    expect(TransferSchema.safeParse(t).success).toBe(true);
    expect(TransferSchema.safeParse({ ...t, toAccountCode: ACC.bank }).success).toBe(false);
    expect(TransferSchema.safeParse({ ...t, amount: 0 }).success).toBe(false);

    expect(BankAccountFormSchema.safeParse({ kind: 'bank', bankName: 'กสิกร', accountNo: '1' }).success).toBe(true);
    expect(BankAccountFormSchema.safeParse({ kind: 'bank', bankName: 'กสิกร', accountNo: ' ' }).success).toBe(false);
    expect(BankAccountFormSchema.safeParse({ kind: 'petty-cash', bankName: 'ฝ่ายขาย', accountNo: '' }).success).toBe(true);

    const p = {
      pettyAccountCode: ACC.pettyCash,
      date: '2026-10-24',
      contactId: '',
      vatMode: 'none',
      claimVat: false,
      supplierInvoiceNo: '',
      lines: [{ id: 'x', description: 'ค่าน้ำมัน', accountCode: ACC.misc, amount: 100 }],
    };
    expect(PettyCashExpenseSchema.safeParse(p).success).toBe(true);
    expect(PettyCashExpenseSchema.safeParse({ ...p, vatMode: 'exclusive', claimVat: true }).success).toBe(false);
    expect(PettyCashExpenseSchema.safeParse({ ...p, lines: [{ ...p.lines[0], amount: 0 }] }).success).toBe(false);

    expect(StatementLineSchema.safeParse({ date: '2026-10-24', description: 'ค่าธรรมเนียม', direction: 'out', amount: 25 }).success).toBe(true);
    expect(StatementLineSchema.safeParse({ date: '', description: '', direction: 'in', amount: 25 }).success).toBe(false);
  });
});
