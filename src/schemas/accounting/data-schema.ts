import type { AccountingData } from 'src/domain';

import { z as zod } from 'zod';

import { DATA_VERSION, isValidISODate } from 'src/domain';

// ----------------------------------------------------------------------
// โครงข้อมูลทั้งก้อน (backup / localStorage) — ตรวจรูปร่างก่อน แล้วค่อยตรวจกติกาด้วย validateAccountingData
// ----------------------------------------------------------------------

const isoDate = zod.string().refine(isValidISODate, { message: 'วันที่ต้องเป็น ค.ศ. YYYY-MM-DD' });

const money = zod.number().finite();

const AddressSchema = zod.object({
  buildingName: zod.string().optional(),
  roomNo: zod.string().optional(),
  floorNo: zod.string().optional(),
  village: zod.string().optional(),
  addressNo: zod.string().optional(),
  moo: zod.string().optional(),
  soi: zod.string().optional(),
  street: zod.string().optional(),
  subDistrict: zod.string().optional(),
  district: zod.string().optional(),
  province: zod.string().optional(),
  postalCode: zod.string().optional(),
});

const legalForm = zod.enum(['individual', 'juristic']);

const CompanySnapshotSchema = zod.object({
  name: zod.string(),
  taxId: zod.string(),
  branchNo: zod.string(),
  address: AddressSchema,
  email: zod.string().optional(),
  phone: zod.string().optional(),
  vatRegistered: zod.boolean(),
});

const PartySnapshotSchema = zod.object({
  title: zod.string(),
  name: zod.string(),
  lastName: zod.string().optional(),
  taxId: zod.string(),
  branchNo: zod.string(),
  address: AddressSchema,
  legalForm,
  email: zod.string().optional(),
});

const DocLineSchema = zod.object({
  id: zod.string(),
  description: zod.string(),
  qty: zod.number().finite(),
  unitPrice: money,
  discount: money,
  accountCode: zod.string(),
});

const vatMode = zod.enum(['exclusive', 'inclusive', 'none']);

const SalesDocSchema = zod.object({
  id: zod.string(),
  kind: zod.enum(['tax-invoice', 'credit-note']),
  isTaxInvoice: zod.boolean().optional(),
  docNo: zod.string(),
  date: isoDate,
  dueDate: isoDate,
  contactId: zod.string(),
  lines: zod.array(DocLineSchema),
  vatMode,
  vatRate: zod.number().finite(),
  refDocId: zod.string().optional(),
  reason: zod.string().optional(),
  creditToCustomer: money.optional(),
  note: zod.string().optional(),
  status: zod.enum(['issued', 'partial', 'paid', 'cancelled']),
  paidAmount: money,
  etax: zod.enum(['not-required', 'pending-sign', 'signed', 'uploaded']),
  etaxUploadedAt: zod.string().optional(),
  etaxReference: zod.string().optional(),
  seller: CompanySnapshotSchema.optional(),
  buyer: PartySnapshotSchema.optional(),
  journalId: zod.string(),
  createdAt: zod.string(),
});

const ReceiptSchema = zod.object({
  id: zod.string(),
  docNo: zod.string(),
  date: isoDate,
  invoiceId: zod.string(),
  contactId: zod.string(),
  amount: money,
  whtAmount: money,
  depositAccountCode: zod.string(),
  seller: CompanySnapshotSchema.optional(),
  buyer: PartySnapshotSchema.optional(),
  journalId: zod.string(),
});

const PurchaseDocSchema = zod.object({
  id: zod.string(),
  docNo: zod.string(),
  supplierInvoiceNo: zod.string(),
  date: isoDate,
  contactId: zod.string(),
  lines: zod.array(DocLineSchema),
  vatMode,
  vatRate: zod.number().finite(),
  claimVat: zod.boolean(),
  whtRate: zod.number().finite(),
  whtIncomeType: zod.string(),
  whtCondition: zod.enum(['1', '2', '3']),
  paid: zod.boolean(),
  paidDate: isoDate.optional(),
  paymentAccountCode: zod.string().optional(),
  paymentId: zod.string().optional(),
  paymentDocNo: zod.string().optional(),
  whtCertNo: zod.string().optional(),
  note: zod.string().optional(),
  supplier: PartySnapshotSchema.optional(),
  journalId: zod.string(),
  paymentJournalId: zod.string().optional(),
  createdAt: zod.string(),
});

const PaymentSchema = zod.object({
  id: zod.string(),
  docNo: zod.string(),
  date: isoDate,
  purchaseId: zod.string(),
  contactId: zod.string(),
  amount: money,
  whtAmount: money,
  netPaid: money,
  accountCode: zod.string(),
  whtCertNo: zod.string().optional(),
  payer: CompanySnapshotSchema.optional(),
  payee: PartySnapshotSchema.optional(),
  journalId: zod.string(),
});

const CustomerRefundSchema = zod.object({
  id: zod.string(),
  docNo: zod.string(),
  date: isoDate,
  contactId: zod.string(),
  amount: money,
  accountCode: zod.string(),
  note: zod.string().optional(),
  buyer: PartySnapshotSchema.optional(),
  journalId: zod.string(),
});

const JournalEntrySchema = zod.object({
  id: zod.string(),
  docNo: zod.string(),
  date: isoDate,
  description: zod.string(),
  source: zod.enum(['sales', 'credit-note', 'receipt', 'purchase', 'payment', 'refund', 'manual']),
  sourceId: zod.string().optional(),
  sourceDocNo: zod.string().optional(),
  lines: zod.array(
    zod.object({
      accountCode: zod.string(),
      description: zod.string().optional(),
      debit: money,
      credit: money,
    })
  ),
});

export const AccountingDataSchema: zod.ZodType<AccountingData, zod.ZodTypeDef, unknown> = zod.object({
  version: zod.literal(DATA_VERSION),
  company: zod.object({
    name: zod.string(),
    taxId: zod.string(),
    branchNo: zod.string(),
    address: AddressSchema,
    phone: zod.string().optional(),
    email: zod.string().optional(),
    rdUserId: zod.string().optional(),
    vatRegistered: zod.boolean(),
    lockedThrough: isoDate.optional(),
  }),
  accounts: zod.array(
    zod.object({
      code: zod.string(),
      name: zod.string(),
      nameEn: zod.string(),
      type: zod.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
      system: zod.boolean().optional(),
    })
  ),
  contacts: zod.array(
    zod.object({
      id: zod.string(),
      code: zod.string(),
      kind: zod.enum(['customer', 'vendor', 'both']),
      legalForm,
      title: zod.string(),
      name: zod.string(),
      lastName: zod.string().optional(),
      taxId: zod.string().optional(),
      branchNo: zod.string().optional(),
      address: AddressSchema,
      email: zod.string().optional(),
      phone: zod.string().optional(),
      creditDays: zod.number().finite(),
    })
  ),
  sales: zod.array(SalesDocSchema),
  receipts: zod.array(ReceiptSchema),
  purchases: zod.array(PurchaseDocSchema),
  payments: zod.array(PaymentSchema),
  refunds: zod.array(CustomerRefundSchema),
  journal: zod.array(JournalEntrySchema),
  sequences: zod.record(zod.number().int().nonnegative()),
});

/** แปลง issue ของ zod เป็นข้อความอ่านง่าย เช่น `sales.3.date: วันที่ต้องเป็น ค.ศ. YYYY-MM-DD` */
export function formatSchemaIssues(error: zod.ZodError, limit = 20): string[] {
  return error.issues.slice(0, limit).map((i) => `${i.path.join('.') || '(ทั้งไฟล์)'}: ${i.message}`);
}
