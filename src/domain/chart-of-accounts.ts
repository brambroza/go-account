import type { Account } from './types';

// ----------------------------------------------------------------------

/** รหัสบัญชีที่ posting engine ใช้ — เปลี่ยนรหัสต้องแก้ที่นี่ที่เดียว */
export const ACC = {
  cash: '1110',
  /** เงินสดย่อย (ตั้งต้น) — บัญชีเงินสดย่อยเพิ่มได้ 1112–1119 */
  pettyCash: '1111',
  bank: '1120',
  receivable: '1130',
  whtReceivable: '1160',
  inputVat: '1170',
  /** ภาษีซื้อเกินภาษีขาย ยกไปเดือนถัดไป (ภ.พ.30 ช่อง 12) — ลงโดยการปิดภาษีเดือนเท่านั้น */
  vatCredit: '1180',
  inventory: '1200',
  equipment: '1500',
  payable: '2110',
  /** เงินรอคืนลูกค้า — ใบลดหนี้หลังลูกค้าจ่ายเงินแล้ว (หนี้สิน) */
  customerCredit: '2120',
  outputVat: '2150',
  /** ภาษีขายของงานบริการที่ยังไม่ได้รับชำระ (ม.78/1) — ย้ายเข้า 2150 เมื่อออกใบเสร็จรับเงิน/ใบกำกับภาษี */
  deferredOutputVat: '2151',
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
  { code: ACC.pettyCash, name: 'เงินสดย่อย', nameEn: 'Petty cash', type: 'asset' },
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
  {
    code: ACC.vatCredit,
    name: 'ภาษีมูลค่าเพิ่มชำระเกินยกไป',
    nameEn: 'VAT credit carried forward',
    type: 'asset',
    system: true,
  },
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
    code: ACC.deferredOutputVat,
    name: 'ภาษีขายยังไม่ถึงกำหนดชำระ (งานบริการ)',
    nameEn: 'Deferred output VAT (services)',
    type: 'liability',
    system: true,
  },
  {
    code: ACC.whtPayable,
    name: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย',
    nameEn: 'Withholding tax payable',
    type: 'liability',
    system: true,
  },
  { code: ACC.vatPayable, name: 'ภาษีมูลค่าเพิ่มค้างจ่าย', nameEn: 'VAT payable', type: 'liability', system: true },
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
  ACC.vatCredit,
  ACC.payable,
  ACC.customerCredit,
  ACC.outputVat,
  ACC.deferredOutputVat,
  ACC.whtPayable,
];

export function isControlAccount(code: string): boolean {
  return CONTROL_ACCOUNTS.includes(code);
}

/**
 * บัญชีเงินสด/ธนาคาร ที่ใช้รับ/จ่ายเงินได้ — สินทรัพย์หมวด 111x (เงินสด) และ 112x (เงินฝากธนาคาร)
 * ตามผังบัญชี SME (ลูกหนี้ 113x, ภาษี 116x–117x, สินค้า 1200 ฯลฯ ใช้รับเงินไม่ได้)
 */
export function isCashAccount(account: Pick<Account, 'code' | 'type'> | undefined): boolean {
  return !!account && account.type === 'asset' && /^11[12]\d$/.test(account.code) && !isControlAccount(account.code);
}

/** ประเภทเอกสารที่บรรทัดรายการใช้: ขาย/ลดหนี้ = บัญชีรายได้, ซื้อ = ค่าใช้จ่ายหรือสินทรัพย์ */
export type LineSide = 'sales' | 'purchase';

/**
 * ตรวจบัญชีของบรรทัดเอกสาร — คืนข้อความปัญหา หรือ null ถ้าใช้ได้
 * - ห้ามบัญชีคุม (ภาษีขาย/ภาษีซื้อ/ลูกหนี้/เจ้าหนี้ ฯลฯ) เพราะยอดต้องกระทบกับทะเบียนภาษีและทะเบียนย่อย
 * - ขาย/ลดหนี้: บัญชีรายได้เท่านั้น
 * - ซื้อ: ค่าใช้จ่าย หรือสินทรัพย์ที่ไม่ใช่เงินสด/ธนาคาร (เช่น สินค้า อุปกรณ์)
 */
export function lineAccountProblem(account: Account | undefined, side: LineSide): string | null {
  if (!account) return 'ไม่พบบัญชีในผังบัญชี';
  if (isControlAccount(account.code)) {
    return `${account.code} ${account.name} เป็นบัญชีคุม ใช้ในบรรทัดรายการไม่ได้`;
  }
  if (side === 'sales' && account.type !== 'revenue') {
    return `${account.code} ${account.name} ไม่ใช่บัญชีรายได้`;
  }
  if (side === 'purchase' && !(account.type === 'expense' || (account.type === 'asset' && !isCashAccount(account)))) {
    return `${account.code} ${account.name} ไม่ใช่บัญชีค่าใช้จ่ายหรือสินทรัพย์`;
  }
  return null;
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
