import type { VatMode, JournalLine } from 'src/domain';

import {
  L,
  S,
  lock,
  VAT_CO,
  credit,
  VENDOR,
  PERSON,
  receive,
  invoice,
  contact,
  CUSTOMER,
  NON_VAT_CO,
} from './scenarios';

import type { Scenario, ScenarioStep, ScenarioLine, ScenarioContact, ScenarioCreditLine, ScenarioPurchaseLine } from './scenarios';

// ----------------------------------------------------------------------
// Scenario golden ชุด C4b — ซื้อ/จ่าย/ใบลดหนี้ผู้ขาย, ธนาคาร/เงินสดย่อย/กระทบยอด/ใบเสนอราคา, ปิดภาษีเดือน/ยอดยกมา/ปิดบัญชีสิ้นปี
// รูปแบบเดียวกับ `scenarios.ts` (replay ด้วย `runScenario`)
// ----------------------------------------------------------------------

/** ผู้ขายไม่มีเลขผู้เสียภาษี (ม.82/5 — ภาษีซื้อต้องห้าม) */
const VENDOR_NO_TAX_ID: ScenarioContact = {
  code: 'V002',
  kind: 'vendor',
  legalForm: 'individual',
  title: 'นาย',
  name: 'ช่างแดง',
  lastName: 'รับจ้าง',
  address: { addressNo: '5', province: 'ชลบุรี' },
  creditDays: 0,
};

/** ผู้ติดต่ออีกรายการของผู้ขายรายเดียวกับ V001 (เลขผู้เสียภาษี + สาขาเดียวกัน) */
const VENDOR_SAME_TAX_ID: ScenarioContact = { ...VENDOR, code: 'V003', name: 'ไทยเม็ดพลาสติก จำกัด (สำนักงานใหญ่)' };

/** เลขผู้เสียภาษีเดียวกับ V001 แต่คนละสาขา = ผู้ขายคนละราย (กันซ้ำตามเลข + สาขา) */
const VENDOR_OTHER_BRANCH: ScenarioContact = { ...VENDOR, code: 'V004', name: 'ไทยเม็ดพลาสติก จำกัด สาขาบางนา', branchNo: '00001' };

const P = (
  qty: number,
  unitPrice: number,
  accountCode = '5100',
  whtRate = 0,
  whtIncomeType = '',
  description = 'วัตถุดิบ',
  discount = 0
): ScenarioPurchaseLine => ({ description, qty, unitPrice, discount, accountCode, whtIncomeType, whtRate });

type PurchaseExtra = {
  contact?: string;
  supplierInvoiceNo?: string;
  supplierInvoiceDate?: string;
  vatClaimPeriod?: string;
  vatMode?: VatMode;
  claimVat?: boolean;
  note?: string;
  payNow?: { date: string; accountCode: string };
};

/** บันทึกซื้อ — ค่าเริ่มต้น: V001, VAT แยก, ขอคืนภาษีซื้อเดือนของวันที่ใบกำกับ */
const purchase = (date: string, lines: ScenarioPurchaseLine[], extra: PurchaseExtra = {}): ScenarioStep => {
  const supplierInvoiceDate = 'supplierInvoiceDate' in extra ? extra.supplierInvoiceDate : date;
  return {
    action: 'recordPurchase',
    input: {
      supplierInvoiceNo: extra.supplierInvoiceNo ?? `INV-${date.replace(/-/g, '')}`,
      ...(supplierInvoiceDate !== undefined ? { supplierInvoiceDate } : {}),
      ...('vatClaimPeriod' in extra
        ? extra.vatClaimPeriod !== undefined
          ? { vatClaimPeriod: extra.vatClaimPeriod }
          : {}
        : { vatClaimPeriod: (supplierInvoiceDate ?? date).slice(0, 7) }),
      date,
      contact: extra.contact ?? 'V001',
      vatMode: extra.vatMode ?? 'exclusive',
      claimVat: extra.claimVat ?? true,
      whtCondition: '1',
      ...(extra.note ? { note: extra.note } : {}),
      lines,
      ...(extra.payNow ? { payNow: extra.payNow } : {}),
    },
  };
};

const pay = (doc: string, date: string, amount?: number, accountCode = '1120'): ScenarioStep => ({
  action: 'payPurchase',
  input: { purchase: doc, date, accountCode, ...(amount !== undefined ? { amount } : {}) },
});

const C = (qty: number, unitPrice: number, accountCode = '5100', purchaseLine?: number, description = 'คืนสินค้า'): ScenarioCreditLine => ({
  description,
  qty,
  unitPrice,
  discount: 0,
  accountCode,
  ...(purchaseLine ? { purchaseLine } : {}),
});

const supplierCredit = (
  doc: string,
  date: string,
  lines: ScenarioCreditLine[],
  extra: { no?: string; supplierDate?: string; reason?: string } = {}
): ScenarioStep => ({
  action: 'recordSupplierCreditNote',
  input: {
    purchase: doc,
    supplierCreditNoteNo: extra.no ?? `CN-${date.replace(/-/g, '')}`,
    supplierCreditNoteDate: extra.supplierDate ?? date,
    date,
    reason: extra.reason ?? 'คืนสินค้า',
    lines,
  },
});

const supplierRefund = (date: string, amount: number, contactCode = 'V001', accountCode = '1120', note?: string): ScenarioStep => ({
  action: 'receiveSupplierRefund',
  input: { contact: contactCode, date, amount, accountCode, ...(note ? { note } : {}) },
});

const petty = (
  date: string,
  lines: { description: string; accountCode: string; amount: number }[],
  extra: {
    pettyAccountCode?: string;
    contact?: string;
    vatMode?: VatMode;
    claimVat?: boolean;
    supplierInvoiceNo?: string;
    supplierInvoiceDate?: string;
    vatClaimPeriod?: string;
    note?: string;
  } = {}
): ScenarioStep => ({
  action: 'recordPettyCashExpense',
  input: {
    pettyAccountCode: extra.pettyAccountCode ?? '1111',
    date,
    ...(extra.contact ? { contact: extra.contact } : {}),
    lines,
    vatMode: extra.vatMode ?? 'none',
    claimVat: extra.claimVat ?? false,
    ...(extra.supplierInvoiceNo ? { supplierInvoiceNo: extra.supplierInvoiceNo } : {}),
    ...(extra.supplierInvoiceDate ? { supplierInvoiceDate: extra.supplierInvoiceDate } : {}),
    ...(extra.vatClaimPeriod ? { vatClaimPeriod: extra.vatClaimPeriod } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  },
});

const transfer = (date: string, fromAccountCode: string, toAccountCode: string, amount: number, note?: string): ScenarioStep => ({
  action: 'transferFunds',
  input: { date, fromAccountCode, toAccountCode, amount, ...(note ? { note } : {}) },
});

const jv = (date: string, description: string, lines: JournalLine[]): ScenarioStep => ({
  action: 'addManualJournal',
  input: { date, description, lines },
});

const dr = (accountCode: string, amount: number, description?: string): JournalLine => ({
  accountCode,
  debit: amount,
  credit: 0,
  ...(description ? { description } : {}),
});

const cr = (accountCode: string, amount: number, description?: string): JournalLine => ({
  accountCode,
  debit: 0,
  credit: amount,
  ...(description ? { description } : {}),
});

const statements = (
  accountCode: string,
  lines: { date: string; description: string; amount: number; balance?: number }[],
  imported = true
): ScenarioStep => ({ action: 'addBankStatementLines', input: { accountCode, lines, imported } });

const quote = (
  date: string,
  lines: ScenarioLine[],
  extra: { quotation?: string; validDays?: number; contact?: string; vatMode?: VatMode; saleType?: 'service'; note?: string } = {}
): ScenarioStep => ({
  action: 'saveQuotation',
  input: {
    ...(extra.quotation ? { quotation: extra.quotation } : {}),
    date,
    validDays: extra.validDays ?? 30,
    contact: extra.contact ?? 'C001',
    lines,
    vatMode: extra.vatMode ?? 'exclusive',
    ...(extra.saleType ? { saleType: extra.saleType } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  },
});

const fromQuote = (
  quotation: string,
  date: string,
  lines: ScenarioLine[],
  extra: { contact?: string; vatMode?: VatMode; saleType?: 'service'; note?: string; dueDate?: string } = {}
): ScenarioStep => ({
  action: 'issueFromQuotation',
  input: {
    quotation,
    date,
    dueDate: extra.dueDate ?? date,
    contact: extra.contact ?? 'C001',
    lines,
    vatMode: extra.vatMode ?? 'exclusive',
    ...(extra.saleType ? { saleType: extra.saleType } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  },
});

const closeYear = (fiscalYearEnd: string): ScenarioStep => ({ action: 'closeYear', input: { fiscalYearEnd } });

// ======================================================================
// ซื้อ / จ่าย / ใบลดหนี้ผู้ขาย / เงินสดย่อย
// ======================================================================

export const PURCHASE_SCENARIOS: Scenario[] = [
  {
    name: 'purchase-wht-lines-partial-payments',
    description:
      'เอกสารซื้อ 3 บรรทัด (สินค้าไม่หัก, ค่าบริการ 3%, ค่าขนส่ง 1%) → แบ่งจ่าย PV + 50 ทวิ ตามสัดส่วน, จ่ายครบ, จ่ายซ้ำ/เกิน/ก่อนวันที่/บัญชีผิดถูกปฏิเสธ, จ่ายทันที (payNow)',
    company: VAT_CO,
    steps: [
      contact(VENDOR),
      purchase('2026-10-05', [P(10, 1000), P(1, 5000, '5600', 3, 'ค่าบริการ', 'ค่าซ่อมเครื่อง'), P(1, 1500, '5400', 1, 'ค่าขนส่ง', 'ค่าขนส่ง')], {
        supplierInvoiceNo: 'INV-001',
        supplierInvoiceDate: '2026-10-03',
        note: 'ตามใบสั่งซื้อ PO-77',
      }),
      purchase('2026-10-05', [P(1, 100, '5100', 16, 'ค่าบริการ')], { supplierInvoiceNo: 'X-1' }),
      purchase('2026-10-05', [P(1, 100, '5600', 3, ' ')], { supplierInvoiceNo: 'X-2' }),
      purchase('2026-10-05', [P(1, 100, '4100')], { supplierInvoiceNo: 'X-3' }),
      purchase('2026-10-05', [P(1, 100, '1120')], { supplierInvoiceNo: 'X-4' }),
      purchase('2026-10-05', [P(1, 100, '1170')], { supplierInvoiceNo: 'X-5' }),
      purchase('2026-10-04', [P(1, 100)], { supplierInvoiceNo: 'X-6', supplierInvoiceDate: '2026-10-04' }),
      pay('PI6910-0001', '2026-10-10', 0),
      pay('PI6910-0001', '2026-10-04', 1000),
      pay('PI6910-0001', '2026-10-10', 17_655.01),
      pay('PI6910-0001', '2026-10-10', 1000, '1130'),
      pay('PI6910-0099', '2026-10-10', 1000),
      pay('PI6910-0001', '2026-10-10', 7_000),
      pay('PI6910-0001', '2026-10-09', 1_000),
      pay('PI6910-0001', '2026-10-12', 3_333.33, '1110'),
      pay('PI6910-0001', '2026-10-20'),
      pay('PI6910-0001', '2026-10-21', 1),
      purchase('2026-10-22', [P(1, 1200, '1500', 0, '', 'เครื่องพิมพ์')], { supplierInvoiceNo: 'INV-002', payNow: { date: '2026-10-22', accountCode: '1120' } }),
      purchase('2026-10-23', [P(2, 1500, '5600', 3, 'ค่าบริการ', 'ค่าทำบัญชี')], {
        supplierInvoiceNo: 'INV-003',
        vatMode: 'inclusive',
        payNow: { date: '2026-10-24', accountCode: '1110' },
      }),
    ],
  },
  {
    name: 'purchase-vat-claim-window',
    description:
      'สิทธิภาษีซื้อ ม.82/3: ต้องมีเลขที่/วันที่ใบกำกับผู้ขาย, เดือนใช้สิทธิในช่วง 6 เดือน, เดือนที่ปิดงวดแล้วใช้ไม่ได้; ม.82/5 ผู้ขายไม่มีเลขผู้เสียภาษี = ภาษีซื้อเป็นค่าใช้จ่าย',
    company: VAT_CO,
    steps: [
      contact(VENDOR),
      contact(VENDOR_NO_TAX_ID),
      purchase('2026-10-10', [P(1, 1000)], { supplierInvoiceNo: '  ' }),
      purchase('2026-10-10', [P(1, 1000)], { supplierInvoiceNo: 'A-1', supplierInvoiceDate: undefined, vatClaimPeriod: '2026-10' }),
      purchase('2026-10-10', [P(1, 1000)], { supplierInvoiceNo: 'A-2', supplierInvoiceDate: '2026-10-11' }),
      purchase('2026-10-10', [P(1, 1000)], { supplierInvoiceNo: 'A-3', supplierInvoiceDate: '2026-10-01', vatClaimPeriod: undefined }),
      purchase('2026-10-10', [P(1, 1000)], { supplierInvoiceNo: 'A-4', supplierInvoiceDate: '2026-10-01', vatClaimPeriod: '2026-09' }),
      purchase('2026-10-10', [P(1, 1000)], { supplierInvoiceNo: 'A-5', supplierInvoiceDate: '2026-03-15', vatClaimPeriod: '2026-10' }),
      purchase('2026-10-10', [P(1, 1000)], { supplierInvoiceNo: 'A-6', supplierInvoiceDate: '2569-10-01' }),
      purchase('2026-10-10', [P(3, 333.33)], { supplierInvoiceNo: 'A-7', supplierInvoiceDate: '2026-04-20', vatClaimPeriod: '2026-10' }),
      purchase('2026-10-10', [P(1, 2140, '5300', 0, '', 'ค่าเช่าโกดัง')], {
        supplierInvoiceNo: 'A-8',
        supplierInvoiceDate: '2026-10-01',
        vatClaimPeriod: '2026-12',
        vatMode: 'inclusive',
      }),
      lock('2026-09-30'),
      purchase('2026-10-11', [P(1, 1000)], { supplierInvoiceNo: 'A-9', supplierInvoiceDate: '2026-09-20', vatClaimPeriod: '2026-09' }),
      purchase('2026-10-11', [P(1, 1000)], { supplierInvoiceNo: 'A-9', supplierInvoiceDate: '2026-09-20', vatClaimPeriod: '2026-10' }),
      purchase('2026-10-12', [P(1, 500, '5900', 0, '', 'ค่าซ่อม'), P(1, 300, '5800', 0, '', 'อะไหล่')], {
        contact: 'V002',
        supplierInvoiceNo: 'บิลเงินสด 12',
        supplierInvoiceDate: '2026-10-12',
      }),
      purchase('2026-10-12', [P(1, 500)], { contact: 'V002', supplierInvoiceNo: 'บิลเงินสด 13', supplierInvoiceDate: '2026-10-13' }),
      purchase('2026-10-13', [P(1, 750, '5800')], { vatMode: 'none', supplierInvoiceNo: '', supplierInvoiceDate: undefined, vatClaimPeriod: undefined }),
      purchase('2026-10-13', [P(1, 1000)], { supplierInvoiceNo: 'A-10', claimVat: false, supplierInvoiceDate: '2026-10-01', vatClaimPeriod: '2026-10' }),
      purchase('2026-10-14', [P(0, 1000)], { supplierInvoiceNo: 'A-11' }),
      purchase('2026-10-14', [P(1, 0)], { supplierInvoiceNo: 'A-12' }),
      purchase('2026-10-14', [P(1, 100)], { contact: 'X999', supplierInvoiceNo: 'A-13' }),
    ],
  },
  {
    name: 'purchase-non-vat-company',
    description: 'บริษัทไม่จด VAT: ขอคืนภาษีซื้อไม่ได้ (claimVat ถูกบังคับเป็น false) VAT ในใบกำกับผู้ขายเป็นค่าใช้จ่าย',
    company: NON_VAT_CO,
    steps: [
      contact(VENDOR),
      purchase('2026-10-05', [P(2, 1000, '5100'), P(1, 3000, '5300', 5, 'ค่าเช่า', 'ค่าเช่าร้าน')], { supplierInvoiceNo: 'INV-77' }),
      pay('PI6910-0001', '2026-10-06'),
    ],
  },
  {
    name: 'purchase-duplicate-supplier-invoice',
    description:
      'กันใบกำกับผู้ขายซ้ำ: เลขที่หลัง normalize (ตัวพิมพ์, ช่องว่าง, ขีด, full-width, เลขไทย, ศูนย์นำหน้า) และผู้ติดต่ออื่นที่เลขผู้เสียภาษี + สาขาเดียวกัน — คนละสาขาไม่ซ้ำ',
    company: VAT_CO,
    steps: [
      contact(VENDOR),
      contact(VENDOR_SAME_TAX_ID),
      contact(VENDOR_OTHER_BRANCH),
      purchase('2026-10-05', [P(1, 1000)], { supplierInvoiceNo: 'INV-001' }),
      purchase('2026-10-06', [P(1, 1000)], { supplierInvoiceNo: 'inv 001' }),
      purchase('2026-10-06', [P(1, 1000)], { supplierInvoiceNo: 'INV–0001' }),
      purchase('2026-10-06', [P(1, 1000)], { supplierInvoiceNo: 'ＩＮＶ-００１' }),
      purchase('2026-10-06', [P(1, 1000)], { supplierInvoiceNo: 'INV-๐๐๑' }),
      purchase('2026-10-06', [P(1, 1000)], { supplierInvoiceNo: 'INV/001', claimVat: false }),
      purchase('2026-10-06', [P(1, 1000)], { contact: 'V003', supplierInvoiceNo: 'INV_001' }),
      purchase('2026-10-06', [P(1, 1000)], { contact: 'V004', supplierInvoiceNo: 'INV-001' }),
      purchase('2026-10-06', [P(1, 1000)], { supplierInvoiceNo: 'INV-010' }),
      purchase('2026-10-07', [P(1, 1000)], { contact: 'V003', supplierInvoiceNo: 'inv-010' }),
      purchase('2026-10-07', [P(1, 100, '5800')], { vatMode: 'none', supplierInvoiceNo: '', supplierInvoiceDate: undefined, vatClaimPeriod: undefined }),
      purchase('2026-10-07', [P(1, 100, '5800')], { vatMode: 'none', supplierInvoiceNo: '', supplierInvoiceDate: undefined, vatClaimPeriod: undefined }),
    ],
  },
  {
    name: 'supplier-credit-notes-and-refund',
    description:
      'ใบลดหนี้ผู้ขาย PC: ก่อนจ่าย (ลดเจ้าหนี้ + ภาษีซื้อ), อ้างบรรทัด, หลังจ่ายบางส่วน (ฐานหัก ณ ที่จ่ายลดเฉพาะบรรทัด), หลังจ่ายครบ → ลูกหนี้-เงินคืนจากผู้ขาย 1150 → รับเงินคืน SR; กติกาวันที่/เลขซ้ำ/เกินยอด/เดือนใช้สิทธิ',
    company: VAT_CO,
    steps: [
      contact(VENDOR),
      contact(VENDOR_SAME_TAX_ID),
      purchase('2026-10-05', [P(10, 1000), P(1, 5000, '5600', 3, 'ค่าบริการ', 'ค่าติดตั้ง')], { supplierInvoiceNo: 'INV-500', supplierInvoiceDate: '2026-10-02' }),
      supplierCredit('PI6910-0001', '2026-10-04', [C(1, 1000)]),
      supplierCredit('PI6910-0001', '2026-10-06', [C(1, 1000)], { supplierDate: '2026-10-07' }),
      supplierCredit('PI6910-0001', '2026-10-06', [C(1, 1000)], { supplierDate: '2026-10-01' }),
      supplierCredit('PI6910-0001', '2026-10-06', [C(1, 1000)], { reason: ' ' }),
      supplierCredit('PI6910-0001', '2026-10-06', [C(1, 1000)], { no: ' ' }),
      supplierCredit('PI6910-0001', '2026-10-06', [C(1, 20_000)]),
      supplierCredit('PI6910-0001', '2026-10-06', [C(1, 1000, '4100')]),
      supplierCredit('PI6910-0001', '2026-10-06', [C(2, 1000, '5100', 1)], { no: 'CN-01' }),
      supplierCredit('PI6910-0001', '2026-10-07', [C(1, 1000)], { no: 'cn 01' }),
      supplierCredit('PI6910-0001', '2026-10-07', [C(1, 1000)], { no: 'CN-0001' }),
      supplierCredit('PI6910-0001', '2026-10-07', [C(1, 1000, '5100', 3)], { no: 'CN-02' }),
      supplierCredit('PI6910-0001', '2026-10-07', [C(1, 6000, '5600', 2, 'ลดค่าติดตั้ง')], { no: 'CN-03' }),
      pay('PI6910-0001', '2026-10-10', 8_000),
      supplierCredit('PI6910-0001', '2026-10-09', [C(1, 1000)], { no: 'CN-04' }),
      supplierCredit('PI6910-0001', '2026-10-11', [C(1, 1000, '5600', 2, 'ลดค่าติดตั้ง')], { no: 'CN-05', reason: 'ติดตั้งไม่ครบ' }),
      pay('PI6910-0001', '2026-10-15'),
      supplierCredit('PI6910-0001', '2026-10-16', [C(1, 1000)], { no: 'CN-06' }),
      supplierRefund('2026-10-17', 1070.01),
      supplierRefund('2026-10-15', 100),
      supplierRefund('2026-10-17', 0),
      supplierRefund('2026-10-17', 500, 'V001', '1130'),
      supplierRefund('2026-10-17', 100, 'V003'),
      supplierRefund('2026-10-17', 500, 'V001', '1120', 'รับโอนคืนบางส่วน'),
      supplierRefund('2026-10-18', 570, 'V001', '1110'),
      supplierRefund('2026-10-19', 0.01),
      purchase('2026-10-20', [P(1, 3000)], { supplierInvoiceNo: 'INV-501', supplierInvoiceDate: '2026-10-01', vatClaimPeriod: '2026-12' }),
      supplierCredit('PI6910-0002', '2026-10-21', [C(1, 500)], { no: 'CN-07' }),
      supplierCredit('PI6910-0002', '2026-10-21', [C(1, 500)], { no: 'CN-0001', supplierDate: '2026-10-21' }),
    ],
  },
  {
    name: 'petty-cash-expenses',
    description:
      'เงินสดย่อย: เบิกชดเชยจากธนาคาร (TR) → ใบสำคัญจ่ายเงินสดย่อย (PI + PV จ่ายทันที, ผู้รับเงินทั่วไป PETTY) → ยอดไม่พอ/ไม่ใช่เงินสดย่อย/ขอคืนภาษีซื้อต้องมีผู้ขายที่ถูกต้อง',
    company: VAT_CO,
    steps: [
      contact(VENDOR),
      contact(VENDOR_NO_TAX_ID),
      petty('2026-10-02', [{ description: 'ค่าแท็กซี่', accountCode: '5400', amount: 120 }]),
      transfer('2026-10-02', '1120', '1111', 2_000),
      petty('2026-10-03', [
        { description: 'ค่าแท็กซี่', accountCode: '5400', amount: 120 },
        { description: 'กาแฟรับรองลูกค้า', accountCode: '5900', amount: 85.5 },
        { description: 'กระดาษ A4', accountCode: '5800', amount: 300 },
      ]),
      petty('2026-10-04', [{ description: 'ค่าน้ำมัน', accountCode: '5400', amount: 1_494.51 }]),
      petty('2026-10-04', [{ description: 'ค่าน้ำมัน', accountCode: '5400', amount: 1_494.5 }], { note: 'เบิกน้ำมันรถส่งของ' }),
      petty('2026-10-05', [{ description: 'ค่าไปรษณีย์', accountCode: '5900', amount: 0 }]),
      petty('2026-10-05', [{ description: 'ค่าไปรษณีย์', accountCode: '5900', amount: 50 }], { pettyAccountCode: '1120' }),
      petty('2026-10-05', [{ description: 'หมึกพิมพ์', accountCode: '5800', amount: 107 }], { vatMode: 'inclusive', claimVat: true }),
      petty('2026-10-05', [{ description: 'หมึกพิมพ์', accountCode: '5800', amount: 107 }], { vatMode: 'inclusive', claimVat: true, contact: 'V002' }),
      transfer('2026-10-05', '1120', '1111', 1_000),
      petty('2026-10-06', [{ description: 'หมึกพิมพ์', accountCode: '5800', amount: 107 }], {
        vatMode: 'inclusive',
        claimVat: true,
        contact: 'V001',
        supplierInvoiceNo: 'RC-889',
        supplierInvoiceDate: '2026-10-06',
        vatClaimPeriod: '2026-10',
      }),
      transfer('2026-10-07', '1111', '1120', 894),
      transfer('2026-10-07', '1111', '1120', 893),
    ],
  },
];

// ======================================================================
// ธนาคาร / โอนเงิน / รายการปรับปรุง / กระทบยอด / ใบเสนอราคา
// ======================================================================

export const BANKING_SCENARIOS: Scenario[] = [
  {
    name: 'bank-accounts-transfers-manual-journal',
    description:
      'เพิ่มบัญชีธนาคาร/เงินสดย่อย (1121, 1112), โอนเงิน TR (เบิกชดเชยเงินสดย่อย), รายการปรับปรุง JV: บัญชีคุม/ไม่พบบัญชี/ติดลบ/ไม่สมดุล/ว่าง/เงินสดย่อยติดลบถูกปฏิเสธ, งวดที่ปิดแล้ว',
    company: VAT_CO,
    steps: [
      { action: 'addBankAccount', input: { kind: 'bank', bankName: 'กสิกรไทย', accountNo: '123-4-56789-0', branch: ' สีลม ' } },
      { action: 'addBankAccount', input: { kind: 'bank', bankName: 'กสิกรไทย', accountNo: '1234567890' } },
      { action: 'addBankAccount', input: { kind: 'bank', bankName: 'กรุงเทพ', accountNo: '  ' } },
      { action: 'addBankAccount', input: { kind: 'petty-cash', bankName: 'ฝ่ายขาย', accountNo: '' } },
      { action: 'addBankAccount', input: { kind: 'petty-cash', bankName: ' ', accountNo: '' } },
      { action: 'addBankAccount', input: { kind: 'bank', bankName: 'กรุงเทพ', accountNo: '987-0-11111-2', accountName: 'เงินฝากออมทรัพย์ กรุงเทพ' } },
      jv('2026-10-01', 'รับเงินลงทุนเพิ่ม', [dr('1121', 100_000, 'ฝากเงินทุน'), cr('3100', 100_000)]),
      transfer('2026-10-02', '1121', '1112', 5_000),
      transfer('2026-10-03', '1121', '1120', 20_000, ' โอนเข้าบัญชีหลัก '),
      transfer('2026-10-03', '1121', '1121', 100),
      transfer('2026-10-03', '1121', '1120', 0),
      transfer('2026-10-03', '1130', '1120', 100),
      transfer('2026-10-03', '1112', '1110', 5_000.01),
      transfer('2026-10-02', '1121', '1110', 100),
      transfer('2026-10-03', '1112', '1110', 1_000),
      jv('2026-10-04', 'ปรับปรุงลูกหนี้', [dr('1130', 100), cr('4900', 100)]),
      jv('2026-10-04', 'ปรับปรุง', [dr('9999', 100), cr('4900', 100)]),
      jv('2026-10-04', 'ปรับปรุง', [dr('5900', -100), cr('4900', -100)]),
      jv('2026-10-04', '  ', [dr('5900', 100), cr('4900', 100)]),
      jv('2026-10-04', 'ปรับปรุง', [dr('5900', 100), cr('1121', 99.99)]),
      jv('2026-10-04', 'ปรับปรุง', [dr('5900', 0), cr('1121', 0)]),
      jv('2026-10-04', 'ค่าใช้จ่ายเงินสดย่อย', [dr('5900', 4_000.01), cr('1112', 4_000.01)]),
      jv('2026-10-04', 'ค่ารับรอง', [dr('5900', 350, 'เลี้ยงรับรองลูกค้า'), cr('1112', 350)]),
      jv('2026-10-04', 'ค่าธรรมเนียมธนาคาร', [dr('5900', 25), dr('5900', 10, 'ค่าส่ง SMS'), cr('1121', 35)]),
      jv('2569-10-04', 'ปรับปรุง', [dr('5900', 100), cr('1121', 100)]),
      lock('2026-09-30'),
      jv('2026-09-30', 'ปรับปรุงย้อนหลัง', [dr('5900', 100), cr('1121', 100)]),
      transfer('2026-09-30', '1121', '1120', 100),
    ],
  },
  {
    name: 'bank-statement-import-matching',
    description:
      'นำเข้า statement (ข้ามรายการซ้ำเมื่อนำเข้าไฟล์เดิม), จับคู่ด้วยมือ/อัตโนมัติ (±3 วัน), ยอดไม่เท่า/จับคู่ซ้ำ/ลบรายการที่จับคู่แล้วถูกปฏิเสธ, ยกเลิกการจับคู่ — การจับคู่ไม่ลงบัญชี',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      contact(VENDOR),
      { action: 'addBankAccount', input: { kind: 'bank', bankName: 'ไทยพาณิชย์', accountNo: '405-1-23456-7' } },
      jv('2026-10-01', 'เงินลงทุน', [dr('1121', 50_000), cr('3100', 50_000)]),
      invoice('2026-10-02', [L(10, 1000)]),
      receive('IV6910-0001', '2026-10-05', 10_700, 0, '1121'),
      purchase('2026-10-03', [P(1, 3000)], { supplierInvoiceNo: 'TP-1' }),
      pay('PI6910-0001', '2026-10-06', undefined, '1121'),
      transfer('2026-10-07', '1121', '1111', 2_000),
      statements('1121', [
        { date: '2026-10-01', description: 'ฝากเงินทุน', amount: 50_000, balance: 50_000 },
        { date: '2026-10-06', description: 'รับโอน เอบีซี', amount: 10_700, balance: 60_700 },
        { date: '2026-10-07', description: 'โอนออก', amount: -2_000, balance: 58_700 },
        { date: '2026-10-08', description: 'ชำระ ไทยเม็ดพลาสติก', amount: -3_210, balance: 55_490 },
        { date: '2026-10-31', description: 'ค่าธรรมเนียม', amount: -30, balance: 55_460 },
      ]),
      statements('1121', [
        { date: '2026-10-01', description: 'ฝากเงินทุน', amount: 50_000, balance: 50_000 },
        { date: '2026-10-06', description: ' รับโอน เอบีซี ', amount: 10_700, balance: 60_700 },
        { date: '2026-10-31', description: 'ค่าธรรมเนียม', amount: -30, balance: 55_460 },
        { date: '2026-10-31', description: 'ค่าธรรมเนียม', amount: -30, balance: 55_430 },
      ]),
      statements('1111', [{ date: '2026-10-01', description: 'x', amount: 1 }]),
      statements('1121', []),
      statements('1121', [{ date: '2026-10-09', description: 'ศูนย์', amount: 0 }]),
      statements('1121', [{ date: '09/10/2026', description: 'วันที่ผิด', amount: 1 }]),
      { action: 'matchBankItems', input: { accountCode: '1121', statementRefs: [1], journals: ['JV6910-0001'] } },
      { action: 'matchBankItems', input: { accountCode: '1121', statementRefs: [1], journals: ['JV6910-0003'] } },
      { action: 'matchBankItems', input: { accountCode: '1121', statementRefs: [2], journals: ['JV6910-0005'] } },
      { action: 'matchBankItems', input: { accountCode: '1121', statementRefs: [2], journals: ['JV6910-0001'] } },
      { action: 'matchBankItems', input: { accountCode: '1121', statementRefs: [2], journals: [] } },
      { action: 'matchBankItems', input: { accountCode: '1121', statementRefs: [2], journals: ['JV6910-0002'] } },
      { action: 'matchBankItems', input: { accountCode: '1120', statementRefs: [2], journals: ['JV6910-0003'] } },
      { action: 'matchBankItems', input: { accountCode: '1121', statementRefs: [2, 2], journals: ['JV6910-0003'] } },
      { action: 'autoMatchBank', input: { accountCode: '1121' } },
      { action: 'autoMatchBank', input: { accountCode: '1121' } },
      { action: 'autoMatchBank', input: { accountCode: '1111' } },
      { action: 'deleteBankStatementLines', input: { statementRefs: [2] } },
      { action: 'unmatchBank', input: { statementRef: 2 } },
      { action: 'deleteBankStatementLines', input: { statementRefs: [2, 6] } },
      { action: 'unmatchBank', input: { statementRef: 2 } },
      jv('2026-10-31', 'ค่าธรรมเนียมธนาคาร', [dr('5900', 30), cr('1121', 30)]),
      { action: 'matchBankItems', input: { accountCode: '1121', statementRefs: [5], journals: ['JV6910-0007'] } },
      invoice('2026-10-15', [L(5, 2000)]),
      receive('IV6910-0002', '2026-10-20', 10_700, 0, '1121'),
      statements(
        '1121',
        [
          { date: '2026-10-20', description: 'เช็ค 1', amount: 5_000 },
          { date: '2026-10-21', description: 'เช็ค 2', amount: 5_700 },
        ],
        false
      ),
      { action: 'matchBankItems', input: { accountCode: '1121', statementRefs: [7, 8], journals: ['JV6910-0009'] } },
    ],
  },
  {
    name: 'quotations-and-conversion',
    description:
      'ใบเสนอราคา QT: สร้าง/แก้ (คงเลขที่ ภายในเดือนเดิม), สถานะ, หมดอายุ/ไม่อนุมัติ/ลูกค้าไม่ตรง/วันที่ก่อนใบเสนอราคา → ออกใบกำกับจากใบเสนอราคา (ล็อกหลังแปลง)',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      contact(PERSON),
      contact(VENDOR),
      quote('2026-10-01', [L(10, 1250), L(1, 500, '4900', 50, 'ค่าขนส่ง')], { note: ' เงื่อนไข: ชำระภายใน 30 วัน ' }),
      quote('2026-10-01', [L(1, 100)], { validDays: 366 }),
      quote('2026-10-01', [L(1, 100)], { contact: 'V001' }),
      quote('2569-10-01', [L(1, 100)]),
      quote('2026-10-01', []),
      quote('2026-10-01', [L(1, 0)]),
      quote('2026-10-03', [L(8, 1250), { ...L(1, 500, '4900', 0, 'ค่าขนส่ง'), description: '  ค่าขนส่ง  ' }], { quotation: 'QT6910-0001', validDays: 14 }),
      quote('2026-11-01', [L(1, 100)], { quotation: 'QT6910-0001' }),
      quote('2026-10-03', [L(1, 100)], { quotation: 'QT6910-0099' }),
      { action: 'setQuotationStatus', input: { quotation: 'QT6910-0001', status: 'sent' } },
      { action: 'setQuotationStatus', input: { quotation: 'QT6910-0001', status: 'bogus' as never } },
      quote('2026-10-05', [S(1, 5000, 'ค่าที่ปรึกษา')], { validDays: 7, saleType: 'service', vatMode: 'inclusive' }),
      quote('2026-10-02', [L(2, 300)], { contact: 'C002', validDays: 0 }),
      fromQuote('QT6910-0002', '2026-10-13', [S(1, 5000, 'ค่าที่ปรึกษา')], { saleType: 'service', vatMode: 'inclusive' }),
      { action: 'setQuotationStatus', input: { quotation: 'QT6910-0002', status: 'rejected' } },
      fromQuote('QT6910-0002', '2026-10-06', [S(1, 5000, 'ค่าที่ปรึกษา')], { saleType: 'service', vatMode: 'inclusive' }),
      fromQuote('QT6910-0001', '2026-10-10', [L(8, 1250)], { contact: 'C002' }),
      fromQuote('QT6910-0001', '2026-10-02', [L(8, 1250)]),
      fromQuote('QT6910-0001', '2026-10-31', [L(8, 1250)]),
      fromQuote('QT6910-0001', '2026-1-10', [L(8, 1250)]),
      fromQuote('QT6910-0001', '2026-10-10', [L(8, 1250), L(1, 500, '4900', 0, 'ค่าขนส่ง')], { dueDate: '2026-11-09', note: 'อ้างอิงใบเสนอราคา QT6910-0001' }),
      fromQuote('QT6910-0001', '2026-10-11', [L(8, 1250)]),
      quote('2026-10-03', [L(1, 100)], { quotation: 'QT6910-0001' }),
      { action: 'setQuotationStatus', input: { quotation: 'QT6910-0001', status: 'draft' } },
      { action: 'setQuotationStatus', input: { quotation: 'QT6910-0002', status: 'accepted' } },
      fromQuote('QT6910-0002', '2026-10-09', [S(1, 5000, 'ค่าที่ปรึกษา')], { saleType: 'service', vatMode: 'inclusive' }),
      fromQuote('QT6910-0003', '2026-10-02', [L(2, 300)], { contact: 'C002' }),
    ],
  },
];

// ======================================================================
// ปิดงวด + ปิดภาษีเดือน / ยอดยกมา / ปิดบัญชีสิ้นปี
// ======================================================================

export const CLOSING_SCENARIOS: Scenario[] = [
  {
    name: 'monthly-vat-close-carry-forward',
    description:
      'ปิดงวดพร้อมปิดภาษีเดือน: ก.ย. ภาษีซื้อมากกว่า → ยกไป 1180, ต.ค. (ขาย + RT งานบริการ + DN/CN + ใบลดหนี้ผู้ขาย) → ชำระ 2170 หักยอดยกมา, พ.ย. ไม่มีรายการ (ปิดโดยไม่ลงบัญชี), ธ.ค. ภาษีซื้อเลือกใช้สิทธิล่วงหน้า',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      contact(VENDOR),
      contact(VENDOR_NO_TAX_ID),
      invoice('2026-09-05', [L(1, 10_000)]),
      purchase('2026-09-10', [P(1, 20_000)], { supplierInvoiceNo: 'S-1' }),
      purchase('2026-09-11', [P(1, 1_000, '5900')], { contact: 'V002', supplierInvoiceNo: 'S-2' }),
      lock('2026-08-31'),
      lock('2026-09-30'),
      purchase('2026-10-01', [P(1, 1_000)], { supplierInvoiceNo: 'S-3', supplierInvoiceDate: '2026-09-25', vatClaimPeriod: '2026-09' }),
      invoice('2026-10-10', [L(3, 10_000)]),
      invoice('2026-10-11', [S(1, 4_000)], 'exclusive', { saleType: 'service' }),
      receive('BL6910-0001', '2026-10-12', 2_140),
      { action: 'issueDebitNote', input: { invoice: 'IV6910-0001', date: '2026-10-13', reason: 'ส่งสินค้าเพิ่ม', lines: [L(1, 1_000)] } },
      credit('IV6909-0001', '2026-10-14', [L(1, 2_000)], 'คืนสินค้า'),
      purchase('2026-10-15', [P(1, 5_000)], { supplierInvoiceNo: 'S-4' }),
      supplierCredit('PI6909-0001', '2026-10-16', [C(1, 1_000)], { no: 'SC-1' }),
      purchase('2026-10-20', [P(1, 5_000, '5300', 0, '', 'ค่าเช่า')], { supplierInvoiceNo: 'S-5', supplierInvoiceDate: '2026-10-20', vatClaimPeriod: '2026-12' }),
      lock('2026-10-31'),
      lock('2026-10-31', '2026-11-05'),
      lock('2026-09-30', '2026-11-05'),
      lock('2026-12-31', '2027-01-10'),
      lock('2026-12-31', '2027-01-10'),
    ],
  },
  {
    name: 'opening-vat-credit-and-year-close',
    description:
      'ยอดยกมา ณ 31 ส.ค. (ภาษีชำระเกินยกมา 1180, ลูกหนี้งานบริการ VAT รอตัด 2151, เจ้าหนี้หัก ณ ที่จ่าย) → รับ/จ่าย, ปิดภาษี ก.ย. หักยอดยกมาจากระบบเดิม, ปิดงวด ธ.ค. → ปิดบัญชีสิ้นปีเข้า 3200 (เรียกซ้ำได้ผลเดิม)',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      contact(PERSON),
      contact(VENDOR),
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-31',
          lines: [
            { accountCode: '1120', description: 'เงินฝากธนาคาร', debit: 100_000, credit: 0 },
            { accountCode: '1200', description: 'สินค้าคงเหลือ', debit: 20_000, credit: 0 },
            { accountCode: '3100', description: 'ทุน', debit: 0, credit: 100_000 },
            { accountCode: '3200', description: 'กำไรสะสม', debit: 0, credit: 29_150 },
          ],
          vatCredit: 1_500,
          whtReceivable: 300,
          receivableControl: 12_840,
          payableControl: 5_350,
          receivables: [
            { contact: 'C001', docNo: 'EX-IV001', date: '2026-08-20', dueDate: '2026-09-20', amount: 10_700 },
            { contact: 'C002', docNo: 'EX-SV001', date: '2026-08-25', dueDate: '2026-09-25', amount: 2_140, serviceVat: 140 },
          ],
          payables: [{ contact: 'V001', docNo: 'EX-PI001', date: '2026-08-28', amount: 5_350, vatAmount: 350, whtIncomeType: 'ค่าบริการ', whtRate: 3 }],
        },
      },
      receive('EX-SV001', '2026-09-10', 2_140),
      receive('EX-IV001', '2026-09-12', 10_700),
      pay('EX-PI001', '2026-09-15'),
      supplierCredit('EX-PI001', '2026-09-16', [C(1, 100, '5900')], { no: 'SC-9' }),
      purchase('2026-09-05', [P(1, 1_000)], { supplierInvoiceNo: 'O-1', supplierInvoiceDate: '2026-08-20', vatClaimPeriod: '2026-08' }),
      invoice('2026-09-20', [L(1, 20_000)]),
      purchase('2026-09-21', [P(1, 3_000, '5300', 5, 'ค่าเช่า', 'ค่าเช่าโกดัง')], { supplierInvoiceNo: 'O-2' }),
      lock('2026-09-30'),
      invoice('2026-10-05', [L(1, 15_000)]),
      purchase('2026-11-10', [P(1, 8_000, '5600', 3, 'ค่าบริการ', 'ค่าที่ปรึกษา')], { supplierInvoiceNo: 'O-3' }),
      pay('PI6911-0001', '2026-11-30'),
      jv('2026-12-31', 'ค่าเสื่อมราคา', [dr('5900', 1_200), cr('1500', 1_200)]),
      closeYear('2026-12-31'),
      closeYear('2026-12-30'),
      closeYear('2569-12-31'),
      lock('2026-12-31', '2027-01-15'),
      closeYear('2026-08-31'),
      closeYear('2026-12-31'),
      closeYear('2026-12-31'),
      setOpening(),
    ],
  },
  {
    name: 'year-close-profit-then-loss',
    description:
      'ปิดบัญชีสิ้นปี 2568 (กำไร → Cr 3200) แล้วปี 2569 (ขาดทุน → Dr 3200): ต้องปิดงวดก่อน, ปิดย้อนหลัง/ไม่ครบ 12 เดือนไม่ได้, ปิดซ้ำได้ผลเดิม, ไม่มีรายการเข้าปีที่ปิดแล้ว',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      contact(VENDOR),
      invoice('2025-11-10', [L(5, 10_000)]),
      purchase('2025-11-15', [P(1, 12_000, '5300', 5, 'ค่าเช่า', 'ค่าเช่าสำนักงาน')], { supplierInvoiceNo: 'Y-1' }),
      invoice('2025-12-10', [S(1, 8_000, 'ค่าติดตั้ง')]),
      purchase('2025-12-15', [P(1, 9_000, '5100')], { supplierInvoiceNo: 'Y-2' }),
      lock('2025-12-31', '2026-01-10'),
      closeYear('2025-12-31'),
      closeYear('2025-12-31'),
      invoice('2025-12-31', [L(1, 100)]),
      invoice('2026-01-15', [L(1, 3_000)]),
      purchase('2026-02-10', [P(1, 10_000, '5500', 2, 'ค่าโฆษณา', 'ค่าโฆษณาออนไลน์')], { supplierInvoiceNo: 'Y-3' }),
      jv('2026-03-31', 'ค่าธรรมเนียมธนาคาร', [dr('5900', 150), cr('1120', 150)]),
      closeYear('2026-12-31'),
      closeYear('2025-11-30'),
      lock('2026-12-31', '2027-01-05'),
      closeYear('2026-11-30'),
      closeYear('2026-12-31'),
      closeYear('2027-12-31'),
    ],
  },
];

/** ยอดยกมาหลังมีรายการ = ถูกปฏิเสธ */
function setOpening(): ScenarioStep {
  return {
    action: 'setOpeningBalances',
    input: {
      date: '2026-08-31',
      lines: [],
      vatCredit: 0,
      whtReceivable: 0,
      receivableControl: 0,
      payableControl: 0,
      receivables: [],
      payables: [],
    },
  };
}
