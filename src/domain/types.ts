// ----------------------------------------------------------------------
// โมเดลข้อมูลหลักของระบบบัญชี — ใช้ทั้งฝั่ง UI และ (ภายหลัง) สัญญา API กับ backend
// วันที่ทุกช่องเก็บเป็น ISO `YYYY-MM-DD` (ค.ศ.) แล้วค่อยแปลงเป็น พ.ศ. ตอนแสดงผล/ส่งออก
// ----------------------------------------------------------------------

export type ISODate = string;

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export type Account = {
  code: string;
  name: string;
  nameEn: string;
  type: AccountType;
  /** บัญชีที่ระบบใช้ลงอัตโนมัติ ห้ามลบ */
  system?: boolean;
};

export type Address = {
  buildingName?: string;
  roomNo?: string;
  floorNo?: string;
  village?: string;
  addressNo?: string;
  moo?: string;
  soi?: string;
  street?: string;
  subDistrict?: string;
  district?: string;
  province?: string;
  postalCode?: string;
};

export type Company = {
  name: string;
  taxId: string;
  /** 5 หลักตามที่พิมพ์บนใบกำกับ (00000 = สำนักงานใหญ่) */
  branchNo: string;
  address: Address;
  phone?: string;
  email?: string;
  /** รหัสผู้ใช้ e-Filing — ใช้ใน header ของไฟล์ ภ.ง.ด. */
  rdUserId?: string;
  vatRegistered: boolean;
  /** ปิดงวดถึงวันที่นี้ (รวมวันนั้น) — ห้ามลงรายการที่วันที่ ≤ ค่านี้ เลื่อนได้ทางเดียว (`lockPeriod`) */
  lockedThrough?: ISODate;
};

/** ข้อมูลผู้ขาย (บริษัทเรา) ณ วันที่ออกเอกสาร — แก้ข้อมูลบริษัทภายหลังแล้วเอกสารเดิมไม่เปลี่ยน */
export type CompanySnapshot = Pick<Company, 'name' | 'taxId' | 'branchNo' | 'address' | 'email' | 'phone' | 'vatRegistered'>;

/**
 * ข้อมูลคู่ค้า ณ วันที่ออกเอกสาร (ชื่อ/เลขผู้เสียภาษี/สาขา/ที่อยู่/ประเภทบุคคล)
 * รายงาน ภ.พ.30, ภ.ง.ด.3/53 และ XML อ่านจากที่นี่ ไม่อ่านจากผู้ติดต่อปัจจุบัน
 */
export type PartySnapshot = {
  title: string;
  name: string;
  lastName?: string;
  taxId: string;
  /** 5 หลัก */
  branchNo: string;
  address: Address;
  legalForm: LegalForm;
  email?: string;
};

export type ContactKind = 'customer' | 'vendor' | 'both';

/** ภ.ง.ด.3 = บุคคลธรรมดา, ภ.ง.ด.53 = นิติบุคคล */
export type LegalForm = 'individual' | 'juristic';

export type Contact = {
  id: string;
  code: string;
  kind: ContactKind;
  legalForm: LegalForm;
  /** คำนำหน้า เช่น นาย / บริษัท / ห้างหุ้นส่วนจำกัด */
  title: string;
  name: string;
  /** นามสกุล (บุคคลธรรมดา) */
  lastName?: string;
  taxId?: string;
  branchNo?: string;
  address: Address;
  email?: string;
  phone?: string;
  creditDays: number;
};

export type VatMode = 'exclusive' | 'inclusive' | 'none';

export type DocLine = {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
  /** ส่วนลดเป็นจำนวนเงินต่อบรรทัด */
  discount: number;
  /** บัญชีรายได้ (ขาย) หรือบัญชีค่าใช้จ่าย/สินทรัพย์ (ซื้อ) */
  accountCode: string;
};

export type DocTotals = {
  /** ผลรวม จำนวน × ราคา − ส่วนลด ตามที่กรอก */
  gross: number;
  /** มูลค่าก่อน VAT (ฐานภาษี) */
  net: number;
  vat: number;
  /** รวมทั้งสิ้น (รวม VAT) */
  total: number;
  /** ภาษีหัก ณ ที่จ่าย (คิดจากมูลค่าก่อน VAT) */
  wht: number;
  /** ยอดชำระสุทธิหลังหัก ณ ที่จ่าย */
  payable: number;
  /** มูลค่าก่อน VAT แยกตามบัญชี (ใช้ตอนลงบัญชี) */
  netByAccount: Record<string, number>;
};

export type ETaxStatus = 'not-required' | 'pending-sign' | 'signed' | 'uploaded';

export type SalesDocKind = 'tax-invoice' | 'credit-note';

export type SalesDocStatus = 'issued' | 'partial' | 'paid' | 'cancelled';

export type SalesDoc = {
  id: string;
  kind: SalesDocKind;
  /**
   * true = ใบกำกับภาษี / ใบลดหนี้ตาม ม.86/10 (ผู้จด VAT เท่านั้น)
   * false = ใบแจ้งหนี้ / ใบลดหนี้ธรรมดา (บริษัทไม่จด VAT — ห้ามพิมพ์คำว่า "ใบกำกับภาษี")
   * ไม่มีค่า = ข้อมูลเก่า ถือว่า true เมื่อ vatMode ≠ none
   */
  isTaxInvoice?: boolean;
  docNo: string;
  date: ISODate;
  dueDate: ISODate;
  contactId: string;
  lines: DocLine[];
  vatMode: VatMode;
  vatRate: number;
  /** ใบลดหนี้: อ้างถึงใบกำกับเดิม */
  refDocId?: string;
  reason?: string;
  /** ใบลดหนี้: ส่วนที่เกินยอดค้างชำระ (ลูกค้าจ่ายแล้ว) ตั้งเป็นเงินรอคืนลูกค้า — 0 ถ้าลดลูกหนี้ทั้งหมด */
  creditToCustomer?: number;
  note?: string;
  status: SalesDocStatus;
  paidAmount: number;
  etax: ETaxStatus;
  /** วันเวลาที่บันทึกว่านำส่ง e-Tax แล้ว (ISO) */
  etaxUploadedAt?: string;
  /** เลขอ้างอิงการนำส่งจากระบบสรรพากร */
  etaxReference?: string;
  /** snapshot ผู้ขาย/ผู้ซื้อ ณ วันที่ออก (ข้อมูลเก่าได้ค่าจาก migration) */
  seller?: CompanySnapshot;
  buyer?: PartySnapshot;
  journalId: string;
  createdAt: string;
};

export type Receipt = {
  id: string;
  docNo: string;
  date: ISODate;
  invoiceId: string;
  contactId: string;
  /** ยอดที่ตัดลูกหนี้ */
  amount: number;
  /** ลูกค้าหักภาษี ณ ที่จ่ายไว้ */
  whtAmount: number;
  depositAccountCode: string;
  seller?: CompanySnapshot;
  buyer?: PartySnapshot;
  journalId: string;
};

export type WhtCondition = '1' | '2' | '3';

export type PurchaseDoc = {
  id: string;
  /** เลขที่ภายในของเรา */
  docNo: string;
  /** เลขที่ใบกำกับภาษีของผู้ขาย */
  supplierInvoiceNo: string;
  date: ISODate;
  contactId: string;
  lines: DocLine[];
  vatMode: VatMode;
  vatRate: number;
  /** ภาษีซื้อขอคืนได้ในงวดนี้หรือไม่ (มีใบกำกับเต็มรูป) */
  claimVat: boolean;
  whtRate: number;
  whtIncomeType: string;
  whtCondition: WhtCondition;
  paid: boolean;
  paidDate?: ISODate;
  paymentAccountCode?: string;
  /** เลขที่ใบสำคัญจ่าย (PV) ของการจ่ายชำระ */
  paymentId?: string;
  paymentDocNo?: string;
  /** เลขที่หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) — sequence `WT` ของตัวเอง ออกเฉพาะเมื่อมีหัก */
  whtCertNo?: string;
  note?: string;
  /** snapshot ผู้ขาย ณ วันที่บันทึก */
  supplier?: PartySnapshot;
  journalId: string;
  paymentJournalId?: string;
  createdAt: string;
};

/** ใบสำคัญจ่าย (PV) — เก็บทุกครั้งที่จ่ายชำระเจ้าหนี้ */
export type Payment = {
  id: string;
  docNo: string;
  date: ISODate;
  purchaseId: string;
  contactId: string;
  /** ยอดตัดเจ้าหนี้ (รวม VAT) */
  amount: number;
  /** ภาษีหัก ณ ที่จ่าย */
  whtAmount: number;
  /** เงินที่จ่ายออกจริง = amount − whtAmount */
  netPaid: number;
  accountCode: string;
  whtCertNo?: string;
  payer?: CompanySnapshot;
  payee?: PartySnapshot;
  journalId: string;
};

/** คืนเงินลูกค้าจากยอดเงินรอคืน (เกิดจากใบลดหนี้หลังรับเงินแล้ว) */
export type CustomerRefund = {
  id: string;
  docNo: string;
  date: ISODate;
  contactId: string;
  amount: number;
  accountCode: string;
  note?: string;
  buyer?: PartySnapshot;
  journalId: string;
};

export type JournalSource = 'sales' | 'credit-note' | 'receipt' | 'purchase' | 'payment' | 'refund' | 'manual';

export type JournalLine = {
  accountCode: string;
  description?: string;
  debit: number;
  credit: number;
};

export type JournalEntry = {
  id: string;
  docNo: string;
  date: ISODate;
  description: string;
  source: JournalSource;
  sourceId?: string;
  sourceDocNo?: string;
  lines: JournalLine[];
};

/** เวอร์ชันโครงข้อมูลปัจจุบัน — เปลี่ยนเมื่อไรต้องเพิ่ม migration ใน `store/migrations.ts` */
export const DATA_VERSION = 3;

export type AccountingData = {
  version: typeof DATA_VERSION;
  company: Company;
  accounts: Account[];
  contacts: Contact[];
  sales: SalesDoc[];
  receipts: Receipt[];
  purchases: PurchaseDoc[];
  payments: Payment[];
  refunds: CustomerRefund[];
  journal: JournalEntry[];
  /** เลขที่ล่าสุดต่อ prefix+งวด เช่น { 'IV6910': 43 } */
  sequences: Record<string, number>;
  /**
   * เอกสารที่ลงวันที่ไม่เกินวันนี้ออกเลขก่อนระบบบังคับ "เลขที่เรียงตามวันที่" (ข้อมูล v1)
   * การตรวจลำดับเลขที่ยกเว้นคู่ที่ใบก่อนหน้าลงวันที่ ≤ ค่านี้ — ตั้งโดย migration เท่านั้น
   */
  legacyOrderThrough?: ISODate;
};
