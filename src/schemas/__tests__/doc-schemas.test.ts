import { ACC } from 'src/domain';

import {
  monthEndOf,
  CompanySchema,
  ContactSchema,
  PurchaseSchema,
  makeRefundSchema,
  makeReceiptSchema,
  SalesInvoiceSchema,
  makeLockPeriodSchema,
  makePayPurchaseSchema,
} from '../accounting/doc-schemas';

// ----------------------------------------------------------------------

const line = { id: 'l', description: 'สินค้า', qty: 1, unitPrice: 100, discount: 0, accountCode: ACC.sales };

describe('form schemas', () => {
  it('validates sales invoice dates', () => {
    const base = { contactId: 'c', date: '2026-10-24', dueDate: '2026-11-23', vatMode: 'exclusive', lines: [line] };
    expect(SalesInvoiceSchema.safeParse(base).success).toBe(true);
    expect(SalesInvoiceSchema.safeParse({ ...base, dueDate: '2026-10-01' }).success).toBe(false);
    expect(SalesInvoiceSchema.safeParse({ ...base, lines: [{ ...line, qty: 0 }] }).success).toBe(false);
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
});
