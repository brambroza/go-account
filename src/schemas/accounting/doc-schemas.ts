import { z as zod } from 'zod';

import { toSatang, todayISO, isValidThaiTaxId, endOfPreviousMonth } from 'src/domain';

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
    .transform((v) => v.slice(0, 10));

export const SalesInvoiceSchema = zod
  .object({
    contactId: zod.string().min(1, { message: 'เลือกลูกค้า' }),
    date: isoDate('วันที่เอกสาร'),
    dueDate: isoDate('วันครบกำหนด'),
    vatMode: zod.enum(['exclusive', 'inclusive', 'none']),
    note: zod.string().optional(),
    lines: zod.array(DocLineSchema).min(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' }),
  })
  .refine((v) => v.dueDate >= v.date, { message: 'วันครบกำหนดต้องไม่ก่อนวันที่เอกสาร', path: ['dueDate'] });

export type SalesInvoiceSchemaType = zod.input<typeof SalesInvoiceSchema>;

export const CreditNoteSchema = zod.object({
  date: isoDate('วันที่ใบลดหนี้'),
  reason: zod.string().trim().min(1, { message: 'ระบุเหตุผลการลดหนี้ (พิมพ์บนเอกสาร)' }),
  lines: zod.array(DocLineSchema).min(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' }),
});

export type CreditNoteSchemaType = zod.input<typeof CreditNoteSchema>;

export const PurchaseSchema = zod
  .object({
    contactId: zod.string().min(1, { message: 'เลือกผู้ขาย' }),
    supplierInvoiceNo: zod.string(),
    date: isoDate('วันที่เอกสาร'),
    vatMode: zod.enum(['exclusive', 'inclusive', 'none']),
    claimVat: zod.boolean(),
    whtRate: zod.number().min(0).max(15),
    whtIncomeType: zod.string(),
    whtCondition: zod.enum(['1', '2', '3']),
    payNow: zod.boolean(),
    paidDate: zod.string().optional(),
    paymentAccountCode: zod.string(),
    note: zod.string().optional(),
    lines: zod.array(DocLineSchema).min(1, { message: 'ต้องมีอย่างน้อย 1 รายการ' }),
  })
  .refine((v) => !(v.whtRate > 0) || v.whtIncomeType.trim().length > 0, {
    message: 'เลือกประเภทเงินได้ที่หัก ณ ที่จ่าย',
    path: ['whtIncomeType'],
  })
  .refine((v) => !(v.claimVat && v.vatMode !== 'none') || v.supplierInvoiceNo.trim().length > 0, {
    message: 'ขอคืนภาษีซื้อต้องมีเลขที่ใบกำกับของผู้ขาย',
    path: ['supplierInvoiceNo'],
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

/** จ่ายชำระเอกสารซื้อ — วันที่จ่ายไม่ก่อนวันที่เอกสาร */
export function makePayPurchaseSchema(minDate: string) {
  return zod.object({
    date: isoDate('วันที่จ่าย').refine((v) => v >= minDate, { message: 'วันที่จ่ายต้องไม่ก่อนวันที่เอกสาร' }),
    accountCode: zod.string().min(1, { message: 'เลือกบัญชีที่จ่าย' }),
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

/** บันทึกว่านำส่ง e-Tax แล้ว — เลขอ้างอิงจากระบบสรรพากร (ไม่บังคับ) */
export const ETaxUploadSchema = zod.object({
  reference: zod.string().max(64, { message: 'ไม่เกิน 64 ตัวอักษร' }).optional(),
});

export type ETaxUploadSchemaType = zod.input<typeof ETaxUploadSchema>;
