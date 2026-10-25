import type { Contact, DocLine, PurchaseLine, AccountingData } from 'src/domain';

import { ACC, addDays, todayISO, periodOf, shiftPeriod, DATA_VERSION, DEFAULT_ACCOUNTS, withAddressCodes } from 'src/domain';

import {
  payPurchase,
  setETaxStatus,
  saveQuotation,
  recordPurchase,
  receivePayment,
  issueCreditNote,
  issueTaxInvoice,
  addManualJournal,
  updateBankAccount,
  setQuotationStatus,
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

/** บรรทัดเอกสารซื้อ — `wht` = [ประเภทเงินได้, อัตรา] (ไม่ส่ง = สินค้า ไม่หัก) */
function pline(description: string, qty: number, unitPrice: number, accountCode: string, wht?: [string, number]): PurchaseLine {
  return { ...line(description, qty, unitPrice, accountCode), whtIncomeType: wht?.[0] ?? '', whtRate: wht?.[1] ?? 0 };
}

/** ทะเบียนบัญชีเงินตั้งต้น: เงินฝากธนาคาร 1120 (ยังไม่ระบุธนาคาร) และเงินสดย่อย 1111 */
export const DEFAULT_BANK_ACCOUNTS: AccountingData['bankAccounts'] = [
  { accountCode: ACC.pettyCash, kind: 'petty-cash', bankName: 'เงินสดย่อยสำนักงาน', accountNo: '' },
  { accountCode: ACC.bank, kind: 'bank', bankName: '', accountNo: '' },
];

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
        provinceCode: '11',
        districtCode: '1105',
        subDistrictCode: '110505',
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
    vatCloses: [],
    purchaseCredits: [],
    supplierRefunds: [],
    yearCloses: [],
    bankAccounts: DEFAULT_BANK_ACCOUNTS,
    transfers: [],
    bankStatements: [],
    bankMatches: [],
    quotations: [],
    journal: [],
    sequences: {},
  };
}

/**
 * ข้อมูลว่างของบริษัทเดิม — คงข้อมูลบริษัท (ไม่รวมการปิดงวด) ผังบัญชี และผู้ติดต่อ ไว้ยกยอดมาจากระบบเดิม
 * (ไม่มีเอกสาร/รายการบัญชี ตัวนับเลขที่เริ่มใหม่)
 */
export function blankCompanyData(from: AccountingData): AccountingData {
  return {
    ...emptyData(),
    company: { ...from.company, lockedThrough: undefined },
    accounts: from.accounts,
    contacts: from.contacts,
    // ทะเบียนบัญชีธนาคารคงไว้ (ผูกกับผังบัญชี) แต่เริ่มกระทบยอดใหม่
    bankAccounts: from.bankAccounts.map((b) => {
      const copy = { ...b };
      delete copy.reconcileFrom;
      return copy;
    }),
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

  // ที่อยู่ตัวอย่างพิมพ์เป็นชื่อ — เติมรหัส TIS 1099 เหมือนบันทึกผ่านฟอร์ม (`saveContact`)
  let s: AccountingData = { ...emptyData(), contacts: CONTACTS.map((c) => ({ ...c, address: withAddressCodes(c.address) })) };
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

  // บันทึก (PI) และจ่ายชำระ (PV) เรียงตามวันที่ — เลขที่ทั้งสองชุดต้องเรียงตามวันที่
  s = recordPurchase(s, {
    supplierInvoiceNo: '',
    date: ym(-1, 1),
    contactId: 'v-somsri',
    vatMode: 'none',
    claimVat: false,
    whtCondition: '1',
    lines: [pline('ค่าเช่าโกดังเก็บสินค้า', 1, 30000, ACC.rent, ['ค่าเช่าอาคาร', 5])],
    payNow: { date: ym(-1, 5), accountCode: ACC.bank },
  }).state;

  s = recordPurchase(s, {
    supplierInvoiceNo: 'TP-2025-1180',
    supplierInvoiceDate: ym(-1, 5),
    vatClaimPeriod: ym(-1, 5).slice(0, 7),
    date: ym(-1, 5),
    contactId: 'v-resin',
    vatMode: 'exclusive',
    claimVat: true,
    whtCondition: '1',
    lines: [pline('เม็ดพลาสติก PP เกรดฉีด', 4000, 52, ACC.cogs)],
    payNow: { date: ym(-1, 20), accountCode: ACC.bank },
  }).state;
  s = recordPurchase(s, {
    supplierInvoiceNo: 'EX-0931',
    supplierInvoiceDate: ym(-1, 15),
    vatClaimPeriod: ym(-1, 15).slice(0, 7),
    date: ym(-1, 15),
    contactId: 'v-express',
    vatMode: 'exclusive',
    claimVat: true,
    whtCondition: '1',
    lines: [pline('ค่าขนส่งสินค้าไปลูกค้า', 1, 18000, ACC.freight, ['ค่าขนส่ง', 1])],
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

  // บันทึก (PI) และจ่ายชำระ (PV/WT) เรียงตามวันที่
  s = recordPurchase(s, {
    supplierInvoiceNo: '',
    date: ym(0, 1),
    contactId: 'v-somsri',
    vatMode: 'none',
    claimVat: false,
    whtCondition: '1',
    lines: [pline('ค่าเช่าโกดังเก็บสินค้า', 1, 30000, ACC.rent, ['ค่าเช่าอาคาร', 5])],
    payNow: { date: ym(0, 5), accountCode: ACC.bank },
  }).state;

  s = recordPurchase(s, {
    supplierInvoiceNo: 'TP-2025-1302',
    supplierInvoiceDate: ym(0, 6),
    vatClaimPeriod: ym(0, 6).slice(0, 7),
    date: ym(0, 6),
    contactId: 'v-resin',
    vatMode: 'exclusive',
    claimVat: true,
    whtCondition: '1',
    lines: [pline('เม็ดพลาสติก PP เกรดฉีด', 6000, 52, ACC.cogs)],
  }).state; // ยังไม่จ่าย

  const express = recordPurchase(s, {
    supplierInvoiceNo: 'EX-1017',
    supplierInvoiceDate: ym(0, 10),
    vatClaimPeriod: ym(0, 10).slice(0, 7),
    date: ym(0, 10),
    contactId: 'v-express',
    vatMode: 'exclusive',
    claimVat: true,
    whtCondition: '1',
    lines: [pline('ค่าขนส่งสินค้าไปลูกค้า', 1, 22000, ACC.freight, ['ค่าขนส่ง', 1])],
  });
  s = express.state;

  const somchai = recordPurchase(s, {
    supplierInvoiceNo: '',
    date: ym(0, 14),
    contactId: 'v-somchai',
    vatMode: 'none',
    claimVat: false,
    whtCondition: '1',
    lines: [pline('ค่าซ่อมบำรุงเครื่องฉีดพลาสติก', 1, 15000, ACC.misc, ['ค่าบริการซ่อมเครื่องฉีด', 3])],
  });
  s = somchai.state;
  s = payPurchase(s, { purchaseId: somchai.doc.id, date: ym(0, 16), accountCode: ACC.bank }).state;
  s = payPurchase(s, { purchaseId: express.doc.id, date: ym(0, 18), accountCode: ACC.bank }).state;

  // สถานะ e-Tax: เอกสารเดือนก่อน ๆ นำส่งแล้ว เดือนนี้ลงนามแล้วบางส่วน
  const before = s.sales.filter((d) => d.date < ym(0, 1)).map((d) => d.id);
  s = setETaxStatus(setETaxStatus(s, before, 'signed'), before, 'uploaded');
  const thisMonth = s.sales.filter((d) => d.date >= ym(0, 1));
  s = setETaxStatus(
    s,
    thisMonth.slice(0, 2).map((d) => d.id),
    'signed'
  );

  // ทะเบียนธนาคาร + ใบเสนอราคา (ไม่ลงบัญชี — ตัวเลขทุกรายงานของข้อมูลตัวอย่างเท่าเดิม)
  s = updateBankAccount(s, ACC.bank, { bankName: 'ธนาคารกสิกรไทย', accountNo: '123-4-56789-0', branch: 'บางนา' });
  const qt = saveQuotation(s, {
    date: ym(0, 2),
    validDays: 30,
    contactId: 'c-nakhon',
    vatMode: 'exclusive',
    lines: [line('ชิ้นส่วนพลาสติก รุ่น NK-9 (เสนอราคา)', 3000, 48.5), line('ค่าทำแม่พิมพ์', 1, 45000, ACC.service)],
    note: 'ราคานี้รวมค่าขนส่งในเขตกรุงเทพฯ และปริมณฑล',
  });
  s = setQuotationStatus(qt.state, qt.quotation.id, 'sent');
  s = saveQuotation(s, {
    date: ym(0, 1),
    validDays: 15,
    contactId: 'c-thairung',
    vatMode: 'exclusive',
    saleType: 'service',
    lines: [line('ค่าบริการฉีดขึ้นรูปตามแบบลูกค้า (รอบถัดไป)', 1, 92000, ACC.service)],
  }).state;

  return s;
}
