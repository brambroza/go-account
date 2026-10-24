import type { Contact, DocLine, AccountingData } from 'src/domain';

import { ACC, addDays, todayISO, periodOf, shiftPeriod, DATA_VERSION, DEFAULT_ACCOUNTS } from 'src/domain';

import {
  payPurchase,
  setETaxStatus,
  recordPurchase,
  receivePayment,
  issueCreditNote,
  issueTaxInvoice,
  addManualJournal,
} from './actions';

// ----------------------------------------------------------------------
// ข้อมูลตัวอย่าง — สร้างผ่าน action จริงทั้งหมด รายการบัญชีจึงสมดุลและตรงกับเอกสาร
// วันที่คำนวณจากวันนี้ (เดือนนี้ + 2 เดือนก่อน) เพื่อให้หน้าศูนย์ภาษีมีข้อมูลเสมอ
// เลขผู้เสียภาษีทุกตัวผ่าน check digit แต่เป็นเลขสมมติ
// ----------------------------------------------------------------------

const CONTACTS: Contact[] = [
  {
    id: 'c-abc',
    code: 'C0001',
    kind: 'customer',
    legalForm: 'juristic',
    title: 'บริษัท',
    name: 'เอบีซี ออโต้พาร์ท จำกัด',
    taxId: '0105565012341',
    branchNo: '00000',
    address: { addressNo: '99', street: 'บางนา-ตราด', subDistrict: 'บางนา', district: 'บางนา', province: 'กรุงเทพมหานคร', postalCode: '10260' },
    email: 'ap@abc-autoparts.example',
    creditDays: 30,
  },
  {
    id: 'c-thairung',
    code: 'C0002',
    kind: 'customer',
    legalForm: 'juristic',
    title: 'ห้างหุ้นส่วนจำกัด',
    name: 'ไทยรุ่งเครื่องกล',
    taxId: '0103558024680',
    branchNo: '00002',
    address: { addressNo: '45/7', moo: '3', subDistrict: 'บางพลีใหญ่', district: 'บางพลี', province: 'สมุทรปราการ', postalCode: '10540' },
    creditDays: 30,
  },
  {
    id: 'c-siammold',
    code: 'C0003',
    kind: 'customer',
    legalForm: 'juristic',
    title: 'บริษัท',
    name: 'สยามโมลด์ เทค จำกัด',
    taxId: '0105561098763',
    branchNo: '00000',
    address: { addressNo: '120', subDistrict: 'บ้านเลน', district: 'บางปะอิน', province: 'พระนครศรีอยุธยา', postalCode: '13160' },
    creditDays: 45,
  },
  {
    id: 'c-nakhon',
    code: 'C0004',
    kind: 'customer',
    legalForm: 'juristic',
    title: 'บริษัท',
    name: 'นครพัฒน์ อินดัสตรี จำกัด',
    taxId: '0105559076545',
    branchNo: '00001',
    address: { addressNo: '8', street: 'สุขุมวิท', subDistrict: 'ท้ายบ้าน', district: 'เมืองสมุทรปราการ', province: 'สมุทรปราการ', postalCode: '10280' },
    creditDays: 30,
  },
  {
    id: 'v-resin',
    code: 'V0001',
    kind: 'vendor',
    legalForm: 'juristic',
    title: 'บริษัท',
    name: 'ไทยเม็ดพลาสติก จำกัด',
    taxId: '0105555123409',
    branchNo: '00000',
    address: { addressNo: '77', subDistrict: 'มาบตาพุด', district: 'เมืองระยอง', province: 'ระยอง', postalCode: '21150' },
    creditDays: 30,
  },
  {
    id: 'v-express',
    code: 'V0002',
    kind: 'vendor',
    legalForm: 'juristic',
    title: 'บริษัท',
    name: 'ขนส่งด่วนพิเศษ จำกัด',
    taxId: '0105566001113',
    branchNo: '00000',
    address: { addressNo: '5', subDistrict: 'บางเสาธง', district: 'บางเสาธง', province: 'สมุทรปราการ', postalCode: '10570' },
    creditDays: 15,
  },
  {
    id: 'v-somchai',
    code: 'V0003',
    kind: 'vendor',
    legalForm: 'individual',
    title: 'นาย',
    name: 'สมชาย',
    lastName: 'ใจดี',
    taxId: '3109900123453',
    address: { addressNo: '12/3', subDistrict: 'บางกระสอ', district: 'เมืองนนทบุรี', province: 'นนทบุรี', postalCode: '11000' },
    creditDays: 0,
  },
  {
    id: 'v-somsri',
    code: 'V0004',
    kind: 'vendor',
    legalForm: 'individual',
    title: 'นาง',
    name: 'สมศรี',
    lastName: 'รักงาน',
    taxId: '3500100456782',
    address: { addressNo: '200', subDistrict: 'ในคลองบางปลากด', district: 'พระสมุทรเจดีย์', province: 'สมุทรปราการ', postalCode: '10290' },
    creditDays: 0,
  },
];

let lineSeq = 0;
function line(description: string, qty: number, unitPrice: number, accountCode: string = ACC.sales): DocLine {
  lineSeq += 1;
  return { id: `seed-l${lineSeq}`, description, qty, unitPrice, discount: 0, accountCode };
}

export function emptyData(): AccountingData {
  return {
    version: DATA_VERSION,
    company: {
      name: 'บริษัท สาธิต แมนูแฟคเจอริ่ง จำกัด',
      taxId: '0105562077778',
      branchNo: '00000',
      address: {
        addressNo: '918/288',
        moo: '10',
        subDistrict: 'ในคลองบางปลากด',
        district: 'พระสมุทรเจดีย์',
        province: 'สมุทรปราการ',
        postalCode: '10290',
      },
      email: 'account@demo.example',
      vatRegistered: true,
    },
    accounts: DEFAULT_ACCOUNTS,
    contacts: [],
    sales: [],
    receipts: [],
    purchases: [],
    payments: [],
    refunds: [],
    journal: [],
    sequences: {},
  };
}

export function buildDemoData(today: string = todayISO()): AccountingData {
  lineSeq = 0;
  const cur = periodOf(today);
  const ym = (offset: number, day: number) => {
    const p = shiftPeriod(cur, offset);
    const d = offset === 0 ? Math.min(day, Number(today.slice(8, 10))) : day;
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  let s: AccountingData = { ...emptyData(), contacts: CONTACTS };
  const due = (date: string, days = 30) => addDays(date, days);

  // ทุนเริ่มต้น
  s = addManualJournal(s, {
    date: ym(-2, 1),
    description: 'ยอดยกมา — ทุนจดทะเบียนชำระแล้ว',
    lines: [
      { accountCode: ACC.bank, debit: 1500000, credit: 0 },
      { accountCode: ACC.capital, debit: 0, credit: 1500000 },
    ],
  }).state;

  // ---------------- 2 เดือนก่อน ----------------
  let r = issueTaxInvoice(s, {
    date: ym(-2, 12),
    dueDate: due(ym(-2, 12)),
    contactId: 'c-siammold',
    vatMode: 'exclusive',
    lines: [line('ฝาครอบพลาสติก รุ่น SC-88', 5000, 12.5)],
  });
  s = r.state; // ค้างชำระ เกินกำหนด

  // ---------------- เดือนก่อน ----------------
  r = issueTaxInvoice(s, {
    date: ym(-1, 3),
    dueDate: due(ym(-1, 3)),
    contactId: 'c-abc',
    vatMode: 'exclusive',
    lines: [line('ชิ้นส่วนพลาสติกฉีด รุ่น PX-100', 3000, 36), line('ค่าออกแบบแม่พิมพ์', 1, 25000, ACC.service)],
  });
  s = r.state;
  s = receivePayment(s, {
    invoiceId: r.doc.id,
    date: ym(-1, 28),
    amount: 142310,
    whtAmount: 750,
    depositAccountCode: ACC.bank,
  }).state;

  // จ่ายชำระเรียงตามวันที่ (เลข PV ต้องเรียงตามวันที่)
  s = recordPurchase(s, {
    supplierInvoiceNo: '',
    date: ym(-1, 1),
    contactId: 'v-somsri',
    vatMode: 'none',
    claimVat: false,
    whtRate: 5,
    whtIncomeType: 'ค่าเช่าอาคาร',
    whtCondition: '1',
    lines: [line('ค่าเช่าโกดังเก็บสินค้า', 1, 30000, ACC.rent)],
    payNow: { date: ym(-1, 5), accountCode: ACC.bank },
  }).state;

  s = recordPurchase(s, {
    supplierInvoiceNo: 'TP-2025-1180',
    date: ym(-1, 5),
    contactId: 'v-resin',
    vatMode: 'exclusive',
    claimVat: true,
    whtRate: 0,
    whtIncomeType: '',
    whtCondition: '1',
    lines: [line('เม็ดพลาสติก PP เกรดฉีด', 4000, 52, ACC.cogs)],
    payNow: { date: ym(-1, 20), accountCode: ACC.bank },
  }).state;
  s = recordPurchase(s, {
    supplierInvoiceNo: 'EX-0931',
    date: ym(-1, 15),
    contactId: 'v-express',
    vatMode: 'exclusive',
    claimVat: true,
    whtRate: 1,
    whtIncomeType: 'ค่าขนส่ง',
    whtCondition: '1',
    lines: [line('ค่าขนส่งสินค้าไปลูกค้า', 1, 18000, ACC.freight)],
    payNow: { date: ym(-1, 25), accountCode: ACC.bank },
  }).state;
  // ---------------- เดือนนี้ ----------------
  r = issueTaxInvoice(s, {
    date: ym(0, 3),
    dueDate: due(ym(0, 3)),
    contactId: 'c-abc',
    vatMode: 'exclusive',
    lines: [line('ชิ้นส่วนพลาสติกฉีด รุ่น PX-120', 4000, 38)],
  });
  s = r.state;
  const abcInvoice = r.doc;

  r = issueTaxInvoice(s, {
    date: ym(0, 8),
    dueDate: due(ym(0, 8)),
    contactId: 'c-thairung',
    vatMode: 'exclusive',
    lines: [line('ค่าบริการฉีดขึ้นรูปตามแบบลูกค้า', 1, 98500, ACC.service)],
  });
  s = r.state;
  s = receivePayment(s, {
    invoiceId: r.doc.id,
    date: ym(0, 20),
    amount: 105395,
    whtAmount: 2955,
    depositAccountCode: ACC.bank,
  }).state;

  r = issueTaxInvoice(s, {
    date: ym(0, 12),
    dueDate: due(ym(0, 12), 45),
    contactId: 'c-siammold',
    vatMode: 'exclusive',
    lines: [line('ถาดพลาสติกบรรจุชิ้นงาน', 8000, 30)],
  });
  s = r.state;

  r = issueTaxInvoice(s, {
    date: ym(0, 21),
    dueDate: due(ym(0, 21)),
    contactId: 'c-nakhon',
    vatMode: 'exclusive',
    lines: [line('ชิ้นส่วนพลาสติก รุ่น NK-7 (สั่งผลิตพิเศษ)', 5000, 50.2)],
  });
  s = r.state;

  s = issueCreditNote(s, {
    invoiceId: abcInvoice.id,
    date: ym(0, 22),
    reason: 'ลูกค้าคืนสินค้าชำรุด 100 ชิ้น',
    lines: [line('ชิ้นส่วนพลาสติกฉีด รุ่น PX-120 (คืน)', 100, 38)],
  }).state;

  // จ่ายชำระเรียงตามวันที่ (เลข PV/WT ต้องเรียงตามวันที่)
  s = recordPurchase(s, {
    supplierInvoiceNo: '',
    date: ym(0, 1),
    contactId: 'v-somsri',
    vatMode: 'none',
    claimVat: false,
    whtRate: 5,
    whtIncomeType: 'ค่าเช่าอาคาร',
    whtCondition: '1',
    lines: [line('ค่าเช่าโกดังเก็บสินค้า', 1, 30000, ACC.rent)],
    payNow: { date: ym(0, 5), accountCode: ACC.bank },
  }).state;

  const somchai = recordPurchase(s, {
    supplierInvoiceNo: '',
    date: ym(0, 14),
    contactId: 'v-somchai',
    vatMode: 'none',
    claimVat: false,
    whtRate: 3,
    whtIncomeType: 'ค่าบริการซ่อมเครื่องฉีด',
    whtCondition: '1',
    lines: [line('ค่าซ่อมบำรุงเครื่องฉีดพลาสติก', 1, 15000, ACC.misc)],
  });
  s = somchai.state;
  s = payPurchase(s, { purchaseId: somchai.doc.id, date: ym(0, 16), accountCode: ACC.bank }).state;

  s = recordPurchase(s, {
    supplierInvoiceNo: 'EX-1017',
    date: ym(0, 10),
    contactId: 'v-express',
    vatMode: 'exclusive',
    claimVat: true,
    whtRate: 1,
    whtIncomeType: 'ค่าขนส่ง',
    whtCondition: '1',
    lines: [line('ค่าขนส่งสินค้าไปลูกค้า', 1, 22000, ACC.freight)],
    payNow: { date: ym(0, 18), accountCode: ACC.bank },
  }).state;

  s = recordPurchase(s, {
    supplierInvoiceNo: 'TP-2025-1302',
    date: ym(0, 6),
    contactId: 'v-resin',
    vatMode: 'exclusive',
    claimVat: true,
    whtRate: 0,
    whtIncomeType: '',
    whtCondition: '1',
    lines: [line('เม็ดพลาสติก PP เกรดฉีด', 6000, 52, ACC.cogs)],
  }).state; // ยังไม่จ่าย

  // สถานะ e-Tax: เอกสารเดือนก่อน ๆ นำส่งแล้ว เดือนนี้ลงนามแล้วบางส่วน
  const before = s.sales.filter((d) => d.date < ym(0, 1)).map((d) => d.id);
  s = setETaxStatus(s, before, 'uploaded');
  const thisMonth = s.sales.filter((d) => d.date >= ym(0, 1));
  s = setETaxStatus(
    s,
    thisMonth.slice(0, 2).map((d) => d.id),
    'signed'
  );

  return s;
}
