import { z as zod } from 'zod';

import { toSatang, todayISO, endOfMonth, monthKeyOf, isValidISODate, isValidThaiTaxId, endOfPreviousMonth } from 'src/domain';

// ----------------------------------------------------------------------
// ทุก field ในฟอร์มต้องอยู่ใน schema — field ที่ไม่ได้ประกาศจะถูก resolver ตัดทิ้งตอน submit
// ----------------------------------------------------------------------

export const DocLineSchema = zod.object({
  id: zod.string(),
  description: zod.string().trim().min(1, { message: 'กรอกคำอธิบายรายการ' }),
  qty: zod.number({ invalid_type_error: 'กรอกจำนวน' }).positive({ message: 'จำนวนต้องมากกว่า 0' }),
  unitPrice: zod.number({ invalid_type_error: 'กรอกราคา' }).min(0, { message: 'ราคาติดลบไม่ได้' }),
  discount: zod.number().min(0),
  accountCode: zod.string().min(1, { message: 'เลือกบัญชี' }),
});

const isoDate = (label: string) =>
  zod
    .string({ required_error: `เลือก${label}` })
    .min(10, { message: `เลือก${label}` })
    .transform((v) => v.slice(0, 10))
    // U13: วันที่ที่ไม่มีในปฏิทิน (เช่น 31/09) ต้องฟ้องที่ช่องนี้เอง ไม่ใช่ช่องวันครบกำหนด
    .refine((v) => isValidISODate(v), { message: `${label}ไม่ถูกต้อง — ไม่มีวันนี้ในปฏิทิน` });

/** เทียบวันที่สองช่องเฉพาะเมื่อทั้งคู่ถูกต้อง (ช่องที่ผิดฟ้องที่ตัวเองแล้ว) */
const dateNotBefore = (later: string, earlier: string) => !isValidISODate(later) || !isValidISODate(earlier) || later >= earlier;

export const SalesInvoiceSchema = zod
  .object({
    contactId: zod.string().min(1, { message: 'เลือกลูกค้า' }),
    /** ขายสินค้า = ใบกำกับภาษีทันที, งานบริการ = ใบแจ้งหนี้ก่อน (ใบกำกับออกตอนรับเงิน ม.78/1) */
    saleType: zod.enum(['goods', 'service']).default('goods'),
    date: isoDate('วันที่เอกสาร'),
    dueDate: isoDate('วันครบกำหนด'),
    vatMode: zod.enum(['exclusive', 'inclusive', 'none']),
    note: zod.string().optional(),
    lines: zod.array(DocLineSchema).min(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' }),
  })
  .refine((v) => dateNotBefore(v.dueDate, v.date), { message: 'วันครบกำหนดต้องไม่ก่อนวันที่เอกสาร', path: ['dueDate'] });

export type SalesInvoiceSchemaType = zod.input<typeof SalesInvoiceSchema>;

export const CreditNoteSchema = zod.object({
  date: isoDate('วันที่ใบลดหนี้'),
  reason: zod.string().trim().min(1, { message: 'ระบุเหตุผลการลดหนี้ (พิมพ์บนเอกสาร)' }),
  lines: zod.array(DocLineSchema).min(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' }),
});

export type CreditNoteSchemaType = zod.input<typeof CreditNoteSchema>;

/** ใบลดหนี้จากผู้ขาย — เลขที่ผู้ขาย (บังคับเมื่อเอกสารเดิมขอคืนภาษีซื้อ ตรวจที่ action) วันที่ในใบ ≤ วันที่ได้รับ */
export const SupplierCreditNoteSchema = zod
  .object({
    supplierCreditNoteNo: zod.string(),
    supplierCreditNoteDate: isoDate('วันที่ในใบลดหนี้ของผู้ขาย'),
    date: isoDate('วันที่ได้รับ'),
    reason: zod.string().trim().min(1, { message: 'ระบุเหตุผลการลดหนี้' }),
    // D1: บรรทัดอ้างบรรทัดของเอกสารซื้อ (ฐานหัก ณ ที่จ่ายลดเฉพาะบรรทัดนั้น) — บรรทัดที่เพิ่มเองไม่มีค่า
    lines: zod.array(DocLineSchema.extend({ purchaseLineId: zod.string().optional() })).min(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' }),
  })
  .refine((v) => dateNotBefore(v.date, v.supplierCreditNoteDate), {
    message: 'วันที่ในใบลดหนี้ต้องไม่หลังวันที่ได้รับ',
    path: ['supplierCreditNoteDate'],
  });

export type SupplierCreditNoteSchemaType = zod.input<typeof SupplierCreditNoteSchema>;

/** บรรทัดเอกสารซื้อ — หัก ณ ที่จ่ายระดับบรรทัด (ไม่หัก = อัตรา 0, สินค้า) */
export const PurchaseLineSchema = DocLineSchema.extend({
  whtIncomeType: zod.string(),
  whtRate: zod.number().min(0, { message: 'อัตราติดลบไม่ได้' }).max(15, { message: 'ไม่เกิน 15%' }),
}).refine((l) => !(l.whtRate > 0) || l.whtIncomeType.trim().length > 0, {
  message: 'เลือกประเภทเงินได้',
  path: ['whtIncomeType'],
});

export const PurchaseSchema = zod
  .object({
    contactId: zod.string().min(1, { message: 'เลือกผู้ขาย' }),
    supplierInvoiceNo: zod.string(),
    /** วันที่ในใบกำกับของผู้ขาย (ว่างได้ถ้าไม่ขอคืนภาษีซื้อ) */
    supplierInvoiceDate: zod.string().optional(),
    /** เดือนใช้สิทธิภาษีซื้อ YYYY-MM */
    vatClaimPeriod: zod.string().optional(),
    date: isoDate('วันที่บันทึก'),
    vatMode: zod.enum(['exclusive', 'inclusive', 'none']),
    claimVat: zod.boolean(),
    whtCondition: zod.enum(['1', '2', '3']),
    payNow: zod.boolean(),
    paidDate: zod.string().optional(),
    paymentAccountCode: zod.string(),
    note: zod.string().optional(),
    lines: zod.array(PurchaseLineSchema).min(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' }),
  })
  .refine((v) => !(v.claimVat && v.vatMode !== 'none') || v.supplierInvoiceNo.trim().length > 0, {
    message: 'ขอคืนภาษีซื้อต้องมีเลขที่ใบกำกับของผู้ขาย',
    path: ['supplierInvoiceNo'],
  })
  .refine((v) => !(v.claimVat && v.vatMode !== 'none') || (v.supplierInvoiceDate ?? '').length >= 10, {
    message: 'ขอคืนภาษีซื้อต้องระบุวันที่ในใบกำกับของผู้ขาย',
    path: ['supplierInvoiceDate'],
  })
  .refine((v) => !v.supplierInvoiceDate || dateNotBefore(v.date, v.supplierInvoiceDate.slice(0, 10)), {
    message: 'วันที่ใบกำกับผู้ขายต้องไม่หลังวันที่บันทึก',
    path: ['supplierInvoiceDate'],
  })
  .refine((v) => !(v.claimVat && v.vatMode !== 'none') || /^\d{4}-\d{2}$/.test(v.vatClaimPeriod ?? ''), {
    message: 'เลือกเดือนที่ใช้สิทธิภาษีซื้อ (ภายใน 6 เดือน)',
    path: ['vatClaimPeriod'],
  });

export type PurchaseSchemaType = zod.input<typeof PurchaseSchema>;

export const ContactSchema = zod
  .object({
    id: zod.string().optional(),
    code: zod.string().trim().min(1, { message: 'กรอกรหัส' }),
    kind: zod.enum(['customer', 'vendor', 'both']),
    legalForm: zod.enum(['individual', 'juristic']),
    title: zod.string(),
    name: zod.string().trim().min(1, { message: 'กรอกชื่อ' }),
    lastName: zod.string().optional(),
    taxId: zod.string().optional(),
    branchNo: zod.string().optional(),
    email: zod.string().email({ message: 'รูปแบบอีเมลไม่ถูกต้อง' }).or(zod.literal('')).optional(),
    phone: zod.string().optional(),
    creditDays: zod.number().min(0),
    address: zod.object({
      addressNo: zod.string().optional(),
      moo: zod.string().optional(),
      village: zod.string().optional(),
      soi: zod.string().optional(),
      street: zod.string().optional(),
      subDistrict: zod.string().optional(),
      district: zod.string().optional(),
      province: zod.string().optional(),
      postalCode: zod.string().optional(),
    }),
  })
  .refine((v) => !v.taxId || isValidThaiTaxId(v.taxId), {
    message: 'เลข 13 หลักไม่ถูกต้อง (ตรวจหลักสุดท้ายไม่ผ่าน)',
    path: ['taxId'],
  })
  .refine((v) => !v.address.postalCode || /^\d{5}$/.test(v.address.postalCode), {
    message: 'รหัสไปรษณีย์ 5 หลัก',
    path: ['address', 'postalCode'],
  });

export type ContactSchemaType = zod.input<typeof ContactSchema>;

export const CompanySchema = zod.object({
  name: zod.string().trim().min(1, { message: 'กรอกชื่อบริษัท' }),
  taxId: zod.string().refine((v) => isValidThaiTaxId(v), { message: 'เลขผู้เสียภาษี 13 หลักไม่ถูกต้อง' }),
  branchNo: zod.string().regex(/^\d{1,5}$/, { message: 'สาขาเป็นตัวเลข 5 หลัก (00000 = สำนักงานใหญ่)' }),
  vatRegistered: zod.boolean(),
  rdUserId: zod.string().max(20, { message: 'ไม่เกิน 20 ตัวอักษร' }).optional(),
  email: zod.string().email({ message: 'รูปแบบอีเมลไม่ถูกต้อง' }).or(zod.literal('')).optional(),
  phone: zod.string().optional(),
  address: zod.object({
    addressNo: zod.string().optional(),
    moo: zod.string().optional(),
    village: zod.string().optional(),
    soi: zod.string().optional(),
    street: zod.string().optional(),
    subDistrict: zod.string().optional(),
    district: zod.string().optional(),
    province: zod.string().optional(),
    postalCode: zod.string().optional(),
  }),
});

export type CompanySchemaType = zod.input<typeof CompanySchema>;

// ----------------------------------------------------------------------
// ฟอร์มใน dialog — ขอบเขตยอดเงิน/วันที่ขึ้นกับเอกสาร จึงสร้าง schema ตามเอกสารที่เปิดอยู่
// ----------------------------------------------------------------------

const money = (label: string) => zod.number({ invalid_type_error: `กรอก${label}` });

/**
 * รับชำระใบกำกับ — ยอดรับ 0.01 ถึงยอดค้าง (`outstanding`), วันที่ไม่ก่อนวันที่ใบกำกับ (`minDate`)
 * ภาษีถูกหัก ณ ที่จ่ายต้องน้อยกว่ายอดรับ
 */
export function makeReceiptSchema(outstanding: number, minDate: string) {
  return zod
    .object({
      date: isoDate('วันที่รับเงิน').refine((v) => v >= minDate, { message: 'วันที่รับเงินต้องไม่ก่อนวันที่ใบกำกับ' }),
      amount: money('ยอดรับชำระ')
        .refine((v) => toSatang(v) > 0, { message: 'ยอดรับชำระต้องมากกว่า 0' })
        .refine((v) => toSatang(v) <= toSatang(outstanding), {
          message: `ยอดรับชำระเกินยอดค้าง (ค้างอยู่ ${outstanding.toFixed(2)} บาท)`,
        }),
      whtRate: zod.number().min(0).max(15),
      whtAmount: money('ภาษีที่ถูกหัก').min(0, { message: 'ภาษีติดลบไม่ได้' }),
      depositAccountCode: zod.string().min(1, { message: 'เลือกบัญชีรับเงิน' }),
    })
    .refine((v) => toSatang(v.whtAmount) < toSatang(v.amount) || toSatang(v.whtAmount) === 0, {
      message: 'ภาษีถูกหัก ณ ที่จ่ายต้องน้อยกว่ายอดรับชำระ',
      path: ['whtAmount'],
    });
}

export type ReceiptSchemaType = zod.input<ReturnType<typeof makeReceiptSchema>>;

/** จ่ายชำระเอกสารซื้อ (แบ่งจ่ายได้) — วันที่จ่ายไม่ก่อนวันที่เอกสาร, ยอด 0.01 ถึงยอดค้าง (`outstanding`) */
export function makePayPurchaseSchema(minDate: string, outstanding = Number.MAX_SAFE_INTEGER / 100) {
  return zod.object({
    date: isoDate('วันที่จ่าย').refine((v) => v >= minDate, { message: 'วันที่จ่ายต้องไม่ก่อนวันที่เอกสาร' }),
    accountCode: zod.string().min(1, { message: 'เลือกบัญชีที่จ่าย' }),
    amount: money('ยอดจ่าย')
      .refine((v) => toSatang(v) > 0, { message: 'ยอดจ่ายต้องมากกว่า 0' })
      .refine((v) => toSatang(v) <= toSatang(outstanding), {
        message: `ยอดจ่ายเกินยอดค้าง (ค้างอยู่ ${outstanding.toFixed(2)} บาท)`,
      })
      .optional(),
  });
}

export type PayPurchaseSchemaType = zod.input<ReturnType<typeof makePayPurchaseSchema>>;

/** คืนเงินลูกค้า — ไม่เกินเงินรอคืน (`available`) */
export function makeRefundSchema(available: number) {
  return zod.object({
    date: isoDate('วันที่คืนเงิน'),
    amount: money('ยอดคืนเงิน')
      .refine((v) => toSatang(v) > 0, { message: 'ยอดคืนเงินต้องมากกว่า 0' })
      .refine((v) => toSatang(v) <= toSatang(available), {
        message: `ยอดคืนเงินเกินยอดรอคืน (คืนได้ ${available.toFixed(2)} บาท)`,
      }),
    accountCode: zod.string().min(1, { message: 'เลือกบัญชีที่จ่ายคืน' }),
    note: zod.string().optional(),
  });
}

export type RefundSchemaType = zod.input<ReturnType<typeof makeRefundSchema>>;

/** รับเงินคืนจากผู้ขาย (SR) — ไม่เกินยอดเงินคืนคงค้าง (ตรวจตามวันที่อีกครั้งที่ `receiveSupplierRefund`) */
export function makeSupplierRefundSchema(available: number) {
  return zod.object({
    date: isoDate('วันที่รับเงินคืน'),
    amount: money('ยอดรับเงินคืน')
      .refine((v) => toSatang(v) > 0, { message: 'ยอดรับเงินคืนต้องมากกว่า 0' })
      .refine((v) => toSatang(v) <= toSatang(available), {
        message: `ยอดรับเงินคืนเกินยอดเงินคืนจากผู้ขาย (รับได้ ${available.toFixed(2)} บาท)`,
      }),
    accountCode: zod.string().min(1, { message: 'เลือกบัญชีที่รับเงิน' }),
    note: zod.string().optional(),
  });
}

export type SupplierRefundSchemaType = zod.input<ReturnType<typeof makeSupplierRefundSchema>>;

/** วันสุดท้ายของเดือนของวันที่ ISO (`2026-02-10` → `2026-02-28`) */
export function monthEndOf(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

/**
 * ปิดงวด — เลือกเดือน (ปิดถึงสิ้นเดือนนั้น) ต้องเลื่อนไปข้างหน้าจากงวดที่ปิดไว้แล้ว (`lockedThrough`)
 * และต้องเป็นเดือนที่สิ้นสุดแล้ว (ไม่เกินสิ้นเดือนก่อนหน้า `today`) — กฎเดียวกับ `lockPeriod`
 */
export function makeLockPeriodSchema(lockedThrough: string | undefined, today: string = todayISO()) {
  const max = endOfPreviousMonth(today);
  return zod.object({
    month: isoDate('เดือนที่ปิด')
      .refine((v) => !lockedThrough || monthEndOf(v) > lockedThrough, {
        message: 'ต้องเป็นเดือนหลังงวดที่ปิดไว้แล้ว (ปิดงวดย้อนหลังไม่ได้)',
      })
      .refine((v) => monthEndOf(v) <= max, {
        message: 'ปิดได้เฉพาะเดือนที่สิ้นสุดแล้ว (ถึงเดือนที่แล้ว)',
      }),
  });
}

export type LockPeriodSchemaType = zod.input<ReturnType<typeof makeLockPeriodSchema>>;

const amount = (label: string) => zod.number({ invalid_type_error: `กรอก${label}` }).min(0, { message: `${label}ติดลบไม่ได้` });

/** ยอดยกมาจากระบบเดิม — กติกาสมดุล/กระทบยอด/บัญชีคุม ตรวจซ้ำที่ `setOpeningBalances` */
export const OpeningBalanceFormSchema = zod.object({
  // D4: ยกยอด ณ วันสิ้นเดือนเท่านั้น
  date: isoDate('วันที่ยอดยกมา').refine((v) => !isValidISODate(v) || endOfMonth(monthKeyOf(v)) === v, {
    message: 'วันที่ยอดยกมาต้องเป็นวันสิ้นเดือน',
  }),
  vatCredit: amount('ภาษีชำระเกินยกมา'),
  whtReceivable: amount('ภาษีถูกหัก ณ ที่จ่าย'),
  receivableControl: amount('ยอดลูกหนี้ตามงบทดลอง'),
  payableControl: amount('ยอดเจ้าหนี้ตามงบทดลอง'),
  lines: zod.array(
    zod.object({
      accountCode: zod.string().min(1, { message: 'เลือกบัญชี' }),
      debit: amount('เดบิต'),
      credit: amount('เครดิต'),
    })
  ),
  receivables: zod.array(
    zod
      .object({
        contactId: zod.string().min(1, { message: 'เลือกลูกค้า' }),
        docNo: zod.string().trim().min(1, { message: 'กรอกเลขที่' }),
        date: isoDate('วันที่เอกสาร'),
        dueDate: isoDate('วันครบกำหนด'),
        amount: amount('ยอดค้าง').refine((v) => toSatang(v) > 0, { message: 'ยอดค้างต้องมากกว่า 0' }),
        /** U2: VAT ของใบแจ้งหนี้งานบริการที่ยังไม่ถึงกำหนด (รวมอยู่ในยอดค้าง) */
        serviceVat: amount('ภาษีขายยังไม่ถึงกำหนด').optional(),
      })
      .refine((v) => dateNotBefore(v.dueDate, v.date), { message: 'ครบกำหนดก่อนวันที่เอกสาร', path: ['dueDate'] })
      .refine((v) => toSatang(v.serviceVat ?? 0) < toSatang(v.amount), { message: 'VAT ต้องน้อยกว่ายอดค้าง', path: ['serviceVat'] })
  ),
  payables: zod.array(
    zod
      .object({
        contactId: zod.string().min(1, { message: 'เลือกผู้ขาย' }),
        docNo: zod.string().trim().min(1, { message: 'กรอกเลขที่' }),
        date: isoDate('วันที่เอกสาร'),
        amount: amount('ยอดค้าง').refine((v) => toSatang(v) > 0, { message: 'ยอดค้างต้องมากกว่า 0' }),
        vatAmount: amount('VAT'),
        whtIncomeType: zod.string(),
        whtRate: zod.number().min(0).max(15, { message: 'ไม่เกิน 15%' }),
      })
      .refine((v) => toSatang(v.vatAmount) < toSatang(v.amount), { message: 'VAT ต้องน้อยกว่ายอดค้าง', path: ['vatAmount'] })
      .refine((v) => !(v.whtRate > 0) || v.whtIncomeType.trim().length > 0, { message: 'เลือกประเภทเงินได้', path: ['whtIncomeType'] })
  ),
});

export type OpeningBalanceFormSchemaType = zod.input<typeof OpeningBalanceFormSchema>;

/** ปิดบัญชีสิ้นปี — วันสิ้นรอบบัญชี (กฎละเอียดตรวจที่ `yearCloseProblem` / `closeYear`) */
export const CloseYearSchema = zod.object({
  fiscalYearEnd: isoDate('วันสิ้นรอบบัญชี').refine((v) => monthEndOf(v) === v, { message: 'วันสิ้นรอบบัญชีต้องเป็นวันสิ้นเดือน' }),
});

export type CloseYearSchemaType = zod.input<typeof CloseYearSchema>;

/** บันทึกว่านำส่ง e-Tax แล้ว — เลขอ้างอิงจากระบบสรรพากร (ไม่บังคับ) */
export const ETaxUploadSchema = zod.object({
  reference: zod.string().max(64, { message: 'ไม่เกิน 64 ตัวอักษร' }).optional(),
});

export type ETaxUploadSchemaType = zod.input<typeof ETaxUploadSchema>;

/** ใบเสนอราคา — ไม่ลงบัญชี ยืนราคา 0–365 วัน */
export const QuotationFormSchema = zod.object({
  contactId: zod.string().min(1, { message: 'เลือกลูกค้า' }),
  saleType: zod.enum(['goods', 'service']).default('goods'),
  date: isoDate('วันที่ใบเสนอราคา'),
  validDays: zod
    .number({ invalid_type_error: 'กรอกจำนวนวัน' })
    .int({ message: 'จำนวนวันต้องเป็นจำนวนเต็ม' })
    .min(0, { message: 'ไม่ติดลบ' })
    .max(365, { message: 'ไม่เกิน 365 วัน' }),
  vatMode: zod.enum(['exclusive', 'inclusive', 'none']),
  note: zod.string().optional(),
  lines: zod.array(DocLineSchema).min(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' }),
});

export type QuotationFormSchemaType = zod.input<typeof QuotationFormSchema>;

/** โอนเงินระหว่างบัญชี / เบิกชดเชยเงินสดย่อย */
export const TransferSchema = zod
  .object({
    date: isoDate('วันที่โอน'),
    fromAccountCode: zod.string().min(1, { message: 'เลือกบัญชีต้นทาง' }),
    toAccountCode: zod.string().min(1, { message: 'เลือกบัญชีปลายทาง' }),
    amount: zod.number({ invalid_type_error: 'กรอกจำนวนเงิน' }).refine((v) => toSatang(v) > 0, { message: 'ยอดต้องมากกว่า 0' }),
    note: zod.string().optional(),
  })
  .refine((v) => v.fromAccountCode !== v.toAccountCode, { message: 'บัญชีต้นทางและปลายทางต้องต่างกัน', path: ['toAccountCode'] });

export type TransferSchemaType = zod.input<typeof TransferSchema>;

/** เพิ่มบัญชีธนาคาร / เงินสดย่อย */
export const BankAccountFormSchema = zod
  .object({
    kind: zod.enum(['bank', 'petty-cash']),
    bankName: zod.string().trim().min(1, { message: 'กรอกชื่อธนาคาร / ผู้ถือเงิน' }),
    accountNo: zod.string(),
    branch: zod.string().optional(),
    reconcileFrom: zod.string().optional(),
  })
  .refine((v) => v.kind !== 'bank' || v.accountNo.trim().length > 0, { message: 'กรอกเลขที่บัญชี', path: ['accountNo'] });

export type BankAccountFormSchemaType = zod.input<typeof BankAccountFormSchema>;

/** ใบสำคัญจ่ายเงินสดย่อย — บรรทัดค่าใช้จ่าย + ขอคืนภาษีซื้อ (ถ้ามีใบกำกับเต็มรูป) */
export const PettyCashExpenseSchema = zod
  .object({
    pettyAccountCode: zod.string().min(1, { message: 'เลือกเงินสดย่อย' }),
    date: isoDate('วันที่จ่าย'),
    contactId: zod.string(),
    vatMode: zod.enum(['exclusive', 'inclusive', 'none']),
    claimVat: zod.boolean(),
    supplierInvoiceNo: zod.string(),
    supplierInvoiceDate: zod.string().optional(),
    note: zod.string().optional(),
    lines: zod
      .array(
        zod.object({
          id: zod.string(),
          description: zod.string().trim().min(1, { message: 'กรอกรายการ' }),
          accountCode: zod.string().min(1, { message: 'เลือกบัญชี' }),
          amount: zod.number({ invalid_type_error: 'กรอกจำนวนเงิน' }).refine((v) => toSatang(v) > 0, { message: 'มากกว่า 0' }),
        })
      )
      .min(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' }),
  })
  .refine((v) => !(v.claimVat && v.vatMode !== 'none') || v.contactId.length > 0, {
    message: 'ขอคืนภาษีซื้อต้องเลือกผู้ขาย',
    path: ['contactId'],
  })
  .refine((v) => !(v.claimVat && v.vatMode !== 'none') || v.supplierInvoiceNo.trim().length > 0, {
    message: 'กรอกเลขที่ใบกำกับภาษี',
    path: ['supplierInvoiceNo'],
  });

export type PettyCashExpenseSchemaType = zod.input<typeof PettyCashExpenseSchema>;

/** เพิ่มรายการ statement เอง */
export const StatementLineSchema = zod.object({
  date: isoDate('วันที่'),
  description: zod.string(),
  direction: zod.enum(['in', 'out']),
  amount: zod.number({ invalid_type_error: 'กรอกจำนวนเงิน' }).refine((v) => toSatang(v) > 0, { message: 'ยอดต้องมากกว่า 0' }),
});

export type StatementLineSchemaType = zod.input<typeof StatementLineSchema>;
