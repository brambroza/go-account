import { L, S, lock, debit, credit, receive, invoice, contact } from './scenarios';

import type { Scenario, ScenarioStep, ScenarioCompany, ScenarioContact, ScenarioPurchaseLine } from './scenarios';

// ----------------------------------------------------------------------
// Scenario golden ชุดรายงาน (C5) — ข้อมูลที่ตั้งใจให้ครอบคลุมกฎของไฟล์ส่งสรรพากร/รายงาน:
// อักขระต้องห้ามใน Format กลาง (/ * ' " | # &), escape ของ XML (& < > " '), CSV formula injection (= + และ ＝ full-width),
// ผู้รับเงินบุคคลธรรมดาหลายประเภทเงินได้ในใบสำคัญจ่ายใบเดียว (แถว D เกิน 3 ช่อง), ภ.ง.ด.3 ที่ข้อมูลไม่ครบ (errors),
// งานบริการ RT + ใบลดหนี้อ้างใบเสร็จ, กระทบยอดธนาคาร และปิดภาษีเดือน
// รูปแบบเดียวกับ `scenarios.ts` (replay ด้วย `runScenario`) — report golden ใช้ state ของ scenario เหล่านี้ด้วย
// ----------------------------------------------------------------------

/** เลขผู้เสียภาษีที่ check digit ถูกต้องจาก 12 หลักแรก */
function tid(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (13 - i);
  return `${first12}${(11 - (sum % 11)) % 10}`;
}

const REPORT_CO: ScenarioCompany = {
  name: 'บริษัท รายงาน & ภาษี จำกัด',
  taxId: tid('010553912345'),
  branchNo: '00000',
  vatRegistered: true,
  address: {
    buildingName: 'อาคารสาธิต',
    floorNo: '7',
    addressNo: '918/288',
    moo: '10',
    street: 'สุขุมวิท',
    subDistrict: 'บางนา',
    district: 'บางนา',
    province: 'กรุงเทพมหานคร',
    postalCode: '10260',
  },
  email: 'tax@report.example',
  phone: '02-123-4567',
  rdUserId: 'GA000001',
};

const CUSTOMER_AB: ScenarioContact = {
  code: 'C101',
  kind: 'customer',
  legalForm: 'juristic',
  title: 'บริษัท',
  name: 'เอ & บี <เทรดดิ้ง> จำกัด',
  taxId: tid('010555812345'),
  branchNo: '00002',
  address: {
    buildingName: 'อาคาร "สาทร" ทาวเวอร์',
    roomNo: '1201',
    floorNo: '12',
    addressNo: '99/9',
    street: 'สาทรใต้',
    subDistrict: 'ยานนาวา',
    district: 'สาทร',
    province: 'กรุงเทพมหานคร',
    postalCode: '10120',
  },
  email: 'ap@ab.example',
  creditDays: 30,
};

/** ชื่อขึ้นต้นด้วย = (CSV formula injection) บุคคลธรรมดาไม่มีคำนำหน้า */
const CUSTOMER_FORMULA: ScenarioContact = {
  code: 'C102',
  kind: 'customer',
  legalForm: 'individual',
  title: '',
  name: '=SUM(A1) ร้านค้า',
  taxId: tid('110010012345'),
  address: { addressNo: '5', district: 'เมือง', province: 'เชียงใหม่', postalCode: '50000' },
  creditDays: 15,
};

/** ＝ (full-width) — NFKC แล้วเป็น = ต้องกันเหมือนกัน */
const CUSTOMER_FULLWIDTH: ScenarioContact = {
  code: 'C103',
  kind: 'both',
  legalForm: 'juristic',
  title: '',
  name: '＝HYPERLINK("x") จำกัด',
  taxId: tid('010556212345'),
  branchNo: '0',
  address: { addressNo: '1', province: 'ภูเก็ต' },
  creditDays: 0,
};

/** ผู้รับเงินบุคคลธรรมดา: ชื่อ/ที่อยู่มีอักขระต้องห้ามของ Format กลาง */
const VENDOR_PERSON: ScenarioContact = {
  code: 'V101',
  kind: 'vendor',
  legalForm: 'individual',
  title: 'นาง',
  name: 'สมศรี "ช่างภาพ"',
  lastName: "ใจ'ดี|มาก",
  taxId: tid('360010099887'),
  address: {
    village: 'หมู่บ้าน #1 & 2',
    addressNo: '45/6',
    moo: '3',
    soi: 'ลาดพร้าว 101/1',
    street: 'ลาดพร้าว*',
    subDistrict: 'คลองจั่น',
    district: 'บางกะปิ',
    province: 'กรุงเทพมหานคร',
    postalCode: '10240',
  },
  creditDays: 0,
};

const VENDOR_FIRM: ScenarioContact = {
  code: 'V102',
  kind: 'vendor',
  legalForm: 'juristic',
  title: 'ห้างหุ้นส่วนจำกัด',
  name: 'ขนส่ง & โลจิสติกส์ #1',
  taxId: tid('010356012345'),
  branchNo: '00001',
  address: { addressNo: '7/77', street: 'บางนา-ตราด', district: 'บางพลี', province: 'สมุทรปราการ', postalCode: '10540' },
  creditDays: 30,
};

/** บุคคลธรรมดาข้อมูลไม่ครบ (เลขผู้เสียภาษีผิด, ไม่มีอำเภอ/รหัสไปรษณีย์) — ภ.ง.ด.3 มี errors */
const VENDOR_INCOMPLETE: ScenarioContact = {
  code: 'V103',
  kind: 'vendor',
  legalForm: 'individual',
  title: 'นาย',
  name: 'ดำ',
  lastName: 'ไม่ครบ',
  taxId: '1234567890123',
  address: { addressNo: '1', province: 'ขอนแก่น' },
  creditDays: 0,
};

const P = (qty: number, unitPrice: number, accountCode: string, whtRate: number, whtIncomeType: string, description: string): ScenarioPurchaseLine => ({
  description,
  qty,
  unitPrice,
  discount: 0,
  accountCode,
  whtIncomeType,
  whtRate,
});

const pay = (doc: string, date: string, amount?: number, accountCode = '1120'): ScenarioStep => ({
  action: 'payPurchase',
  input: { purchase: doc, date, accountCode, ...(amount !== undefined ? { amount } : {}) },
});

export const REPORT_SCENARIOS: Scenario[] = [
  {
    name: 'reports-tax-files-and-escaping',
    description:
      'ข้อมูลสำหรับรายงาน/ไฟล์ภาษี: ใบกำกับ/ใบลด/เพิ่มหนี้ที่มีอักขระพิเศษ (XML escape), งานบริการ RT + ใบลดหนี้อ้างใบเสร็จ, ภ.ง.ด.3 บุคคลธรรมดา 4 ประเภทเงินได้แบ่งจ่าย 2 เดือน, ภ.ง.ด.53 สาขา, ผู้รับเงินข้อมูลไม่ครบ, CSV formula injection, statement + จับคู่อัตโนมัติ, ปิดภาษีเดือน',
    company: REPORT_CO,
    steps: [
      contact(CUSTOMER_AB),
      contact(CUSTOMER_FORMULA),
      contact(CUSTOMER_FULLWIDTH),
      contact(VENDOR_PERSON),
      contact(VENDOR_FIRM),
      contact(VENDOR_INCOMPLETE),
      invoice('2026-10-03', [L(2.5, 1234.567, '4100', 10, 'สินค้า A & B <รุ่นใหม่>'), L(1, 99.995, '4900', 0, "ค่าขนส่ง 'ด่วน'")], 'exclusive', {
        contact: 'C101',
        dueDate: '2026-11-02',
        note: 'ชำระภายใน 30 วัน',
      }),
      invoice('2026-10-05', [L(3, 500)], 'inclusive', { contact: 'C102', dueDate: '2026-10-20' }),
      invoice('2026-10-06', [L(1, 1000)], 'exclusive', { contact: 'C103' }),
      credit('IV6910-0001', '2026-10-08', [L(1, 500, '4100', 0, 'คืน <ชำรุด>')], 'สินค้า "ชำรุด" & เสียหาย'),
      debit('IV6910-0001', '2026-10-09', [L(1, 200, '4100', 0, 'ค่าติดตั้งเพิ่ม')], 'เพิ่มงานติดตั้ง'),
      receive('IV6910-0002', '2026-10-10', 1500),
      invoice('2026-10-12', [S(1, 20_000, 'ที่ปรึกษา & อบรม')], 'exclusive', { contact: 'C101', saleType: 'service', dueDate: '2026-11-11' }),
      receive('BL6910-0001', '2026-10-15', 10_700, 300),
      receive('BL6910-0001', '2026-10-20', 10_700),
      credit('BL6910-0001', '2026-10-21', [S(1, 1_000, 'ส่วนลดหลังการขาย')], 'ส่วนลดพิเศษ'),
      { action: 'setETaxStatus', input: { docs: ['IV6910-0001', 'CN6910-0001', 'RT6910-0001'], etax: 'signed' } },
      {
        action: 'recordPurchase',
        input: {
          supplierInvoiceNo: 'บิล 1/2569',
          date: '2026-10-10',
          contact: 'V101',
          vatMode: 'none',
          claimVat: false,
          whtCondition: '1',
          lines: [
            P(1, 10_000, '5600', 3, 'ค่าบริการ', 'ถ่ายภาพสินค้า'),
            P(1, 5_000, '5300', 5, 'ค่าเช่า', 'เช่าสตูดิโอ'),
            P(1, 2_000, '5400', 1, 'ค่าขนส่ง', 'ขนส่งอุปกรณ์'),
            P(1, 3_000, '5500', 2, 'ค่าโฆษณา', 'โฆษณาออนไลน์'),
          ],
        },
      },
      pay('PI6910-0001', '2026-10-15', 8_000),
      {
        action: 'recordPurchase',
        input: {
          supplierInvoiceNo: 'INV-77',
          supplierInvoiceDate: '2026-10-12',
          vatClaimPeriod: '2026-10',
          date: '2026-10-12',
          contact: 'V102',
          vatMode: 'exclusive',
          claimVat: true,
          whtCondition: '1',
          lines: [P(1, 5_000, '5400', 1, 'ค่าขนส่ง', 'ค่าขนส่งสินค้า')],
        },
      },
      pay('PI6910-0002', '2026-10-20'),
      {
        action: 'recordPurchase',
        input: {
          supplierInvoiceNo: '',
          date: '2026-10-14',
          contact: 'V103',
          vatMode: 'none',
          claimVat: false,
          whtCondition: '2',
          lines: [P(1, 3_000, '5600', 3, 'ค่าจ้างทำของ', 'ซ่อมเครื่อง')],
        },
      },
      pay('PI6910-0003', '2026-10-25', undefined, '1110'),
      {
        action: 'addBankStatementLines',
        input: {
          accountCode: '1120',
          imported: true,
          lines: [
            { date: '2026-10-10', description: 'รับโอน =SUM ร้านค้า', amount: 1_500, balance: 1_500 },
            { date: '2026-10-16', description: 'รับโอน เอ & บี', amount: 10_400, balance: 11_900 },
            { date: '2026-10-16', description: 'โอนจ่ายช่างภาพ', amount: -7_670, balance: 4_230 },
            { date: '2026-10-21', description: 'รับโอน เอ & บี', amount: 10_700, balance: 14_930 },
            { date: '2026-10-31', description: 'ค่าธรรมเนียม', amount: -25, balance: 14_905 },
          ],
        },
      },
      { action: 'autoMatchBank', input: { accountCode: '1120' } },
      lock('2026-10-31', '2026-11-10'),
      pay('PI6910-0001', '2026-11-05'),
      invoice('2026-11-06', [L(1, 4_000)], 'exclusive', { contact: 'C102', dueDate: '2026-11-06' }),
    ],
  },
];
