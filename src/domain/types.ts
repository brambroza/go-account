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
  note?: string;
  status: SalesDocStatus;
  paidAmount: number;
  etax: ETaxStatus;
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
  whtCertNo?: string;
  note?: string;
  journalId: string;
  paymentJournalId?: string;
  createdAt: string;
};

export type JournalSource = 'sales' | 'credit-note' | 'receipt' | 'purchase' | 'payment' | 'manual';

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

export type AccountingData = {
  version: 1;
  company: Company;
  accounts: Account[];
  contacts: Contact[];
  sales: SalesDoc[];
  receipts: Receipt[];
  purchases: PurchaseDoc[];
  journal: JournalEntry[];
  /** เลขที่ล่าสุดต่อ prefix+งวด เช่น { 'IV6910': 43 } */
  sequences: Record<string, number>;
};
