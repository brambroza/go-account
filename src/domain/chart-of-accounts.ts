import type { Account } from './types';

// ----------------------------------------------------------------------

/** รหัสบัญชีที่ posting engine ใช้ — เปลี่ยนรหัสต้องแก้ที่นี่ที่เดียว */
export const ACC = {
  cash: '1110',
  bank: '1120',
  receivable: '1130',
  whtReceivable: '1160',
  inputVat: '1170',
  inventory: '1200',
  equipment: '1500',
  payable: '2110',
  /** เงินรอคืนลูกค้า — ใบลดหนี้หลังลูกค้าจ่ายเงินแล้ว (หนี้สิน) */
  customerCredit: '2120',
  outputVat: '2150',
  whtPayable: '2160',
  vatPayable: '2170',
  capital: '3100',
  retained: '3200',
  sales: '4100',
  service: '4200',
  otherIncome: '4900',
  cogs: '5100',
  subcontract: '5200',
  rent: '5300',
  freight: '5400',
  advertising: '5500',
  professional: '5600',
  utilities: '5700',
  supplies: '5800',
  misc: '5900',
} as const;

/** ผังบัญชีตั้งต้นสำหรับ SME ไทย (ปรับเพิ่มได้ในหน้าผังบัญชี) */
export const DEFAULT_ACCOUNTS: Account[] = [
  { code: ACC.cash, name: 'เงินสด', nameEn: 'Cash', type: 'asset', system: true },
  { code: ACC.bank, name: 'เงินฝากธนาคาร', nameEn: 'Bank deposits', type: 'asset', system: true },
  { code: ACC.receivable, name: 'ลูกหนี้การค้า', nameEn: 'Accounts receivable', type: 'asset', system: true },
  {
    code: ACC.whtReceivable,
    name: 'ภาษีถูกหัก ณ ที่จ่าย',
    nameEn: 'Withholding tax receivable',
    type: 'asset',
    system: true,
  },
  { code: ACC.inputVat, name: 'ภาษีซื้อ', nameEn: 'Input VAT', type: 'asset', system: true },
  { code: ACC.inventory, name: 'สินค้าคงเหลือ', nameEn: 'Inventory', type: 'asset' },
  { code: ACC.equipment, name: 'อุปกรณ์สำนักงาน', nameEn: 'Office equipment', type: 'asset' },
  { code: ACC.payable, name: 'เจ้าหนี้การค้า', nameEn: 'Accounts payable', type: 'liability', system: true },
  {
    code: ACC.customerCredit,
    name: 'เงินรอคืนลูกค้า (ลดหนี้หลังรับชำระ)',
    nameEn: 'Customer credits payable',
    type: 'liability',
    system: true,
  },
  { code: ACC.outputVat, name: 'ภาษีขาย', nameEn: 'Output VAT', type: 'liability', system: true },
  {
    code: ACC.whtPayable,
    name: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย',
    nameEn: 'Withholding tax payable',
    type: 'liability',
    system: true,
  },
  { code: ACC.vatPayable, name: 'ภาษีมูลค่าเพิ่มค้างจ่าย', nameEn: 'VAT payable', type: 'liability' },
  { code: ACC.capital, name: 'ทุนจดทะเบียน', nameEn: 'Share capital', type: 'equity' },
  { code: ACC.retained, name: 'กำไร (ขาดทุน) สะสม', nameEn: 'Retained earnings', type: 'equity' },
  { code: ACC.sales, name: 'รายได้จากการขาย', nameEn: 'Sales revenue', type: 'revenue', system: true },
  { code: ACC.service, name: 'รายได้ค่าบริการ', nameEn: 'Service revenue', type: 'revenue' },
  { code: ACC.otherIncome, name: 'รายได้อื่น', nameEn: 'Other income', type: 'revenue' },
  { code: ACC.cogs, name: 'ต้นทุนขาย / วัตถุดิบ', nameEn: 'Cost of goods sold', type: 'expense' },
  { code: ACC.subcontract, name: 'ค่าจ้างผลิต / รับเหมา', nameEn: 'Subcontract', type: 'expense' },
  { code: ACC.rent, name: 'ค่าเช่า', nameEn: 'Rent', type: 'expense' },
  { code: ACC.freight, name: 'ค่าขนส่ง', nameEn: 'Freight', type: 'expense' },
  { code: ACC.advertising, name: 'ค่าโฆษณา', nameEn: 'Advertising', type: 'expense' },
  { code: ACC.professional, name: 'ค่าบริการวิชาชีพ', nameEn: 'Professional fees', type: 'expense' },
  { code: ACC.utilities, name: 'ค่าน้ำ ค่าไฟ ค่าโทรศัพท์', nameEn: 'Utilities', type: 'expense' },
  { code: ACC.supplies, name: 'วัสดุสิ้นเปลือง', nameEn: 'Supplies', type: 'expense' },
  { code: ACC.misc, name: 'ค่าใช้จ่ายเบ็ดเตล็ด', nameEn: 'Miscellaneous expense', type: 'expense' },
];

/**
 * บัญชีคุม (control account) ที่มีทะเบียนย่อยรองรับ — ยอดต้องมาจากเอกสารเท่านั้น
 * รายการปรับปรุงคีย์มือห้ามลงบัญชีเหล่านี้ ไม่อย่างนั้น GL กับทะเบียนลูกหนี้/เจ้าหนี้/ภาษีกระทบยอดไม่ลง
 * (เงินสด/ธนาคาร/รายได้ เป็น system แต่ไม่ใช่บัญชีคุม จึงคีย์มือได้ เช่น ยอดยกมา ค่าธรรมเนียมธนาคาร)
 */
export const CONTROL_ACCOUNTS: readonly string[] = [
  ACC.receivable,
  ACC.whtReceivable,
  ACC.inputVat,
  ACC.payable,
  ACC.customerCredit,
  ACC.outputVat,
  ACC.whtPayable,
];

export function isControlAccount(code: string): boolean {
  return CONTROL_ACCOUNTS.includes(code);
}

/** ด้านปกติของบัญชี: สินทรัพย์/ค่าใช้จ่าย = เดบิต, ที่เหลือ = เครดิต */
export function normalSide(type: Account['type']): 'debit' | 'credit' {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit';
}

export const ACCOUNT_TYPE_LABEL: Record<Account['type'], string> = {
  asset: 'สินทรัพย์',
  liability: 'หนี้สิน',
  equity: 'ส่วนของเจ้าของ',
  revenue: 'รายได้',
  expense: 'ค่าใช้จ่าย',
};
