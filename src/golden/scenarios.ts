import type {
  Address,
  Contact,
  Payment,
  Receipt,
  VatMode,
  SalesDoc,
  SaleType,
  Quotation,
  ETaxStatus,
  JournalLine,
  PurchaseDoc,
  WhtCondition,
  JournalEntry,
  BankTransfer,
  AccountingData,
  CustomerRefund,
  SupplierRefund,
  QuotationStatus,
  BankAccountKind,
  PurchaseCreditNote,
} from 'src/domain';

import { emptyData } from 'src/store/seed';
import {
  toSatang,
  calcDocument,
  outstandingOf,
  customerCreditOf,
  purchaseOutstanding,
  supplierRefundDueOf,
} from 'src/domain';
import {
  closeYear,
  lockPeriod,
  saveContact,
  unmatchBank,
  payPurchase,
  saveQuotation,
  setETaxStatus,
  autoMatchBank,
  transferFunds,
  issueDebitNote,
  receivePayment,
  recordPurchase,
  addBankAccount,
  matchBankItems,
  issueCreditNote,
  issueTaxInvoice,
  addManualJournal,
  BusinessRuleError,
  setQuotationStatus,
  setOpeningBalances,
  issueFromQuotation,
  refundCustomerCredit,
  receiveSupplierRefund,
  addBankStatementLines,
  recordPettyCashExpense,
  deleteBankStatementLines,
  recordSupplierCreditNote,
} from 'src/store/actions';

// ----------------------------------------------------------------------
// Scenario golden (C4) — ลำดับ action ของ store จากบริษัทว่าง (หรือยอดยกมา) พร้อมผลที่สังเกตได้ทุกขั้น
// ฝั่ง C# (go-account-api) replay ทีละขั้นกับ DB จริงผ่าน Application layer แล้วต้องได้ผลเดียวกันทุกตัว:
// เลขที่เอกสาร, ยอด (สตางค์), บรรทัดรายการบัญชี, ยอดค้าง/เงินรอคืน, สถานะ e-Tax และ code + ข้อความของขั้นที่ถูกปฏิเสธ
//
// input ของแต่ละขั้นเป็นรูปแบบเดียวกับ request ของ API: อ้างผู้ติดต่อด้วยรหัส (`contact`) เอกสารด้วยเลขที่ (`invoice`, `docs`,
// `purchase`, `quotation`, `journals` = เลขที่ JV) และรายการ statement ด้วยลำดับที่นำเข้า (`statementRefs` เริ่ม 1, ไม่นับใหม่หลังลบ)
// แทน id (TS สุ่ม id) — เงินใน input เป็นบาท (ตามที่ผู้ใช้กรอก), เงินใน output เป็นสตางค์ (integer)
// ชุด: sales (C4a), purchases / banking / closing (C4b — ดู `scenarios-c4b.ts`)
// ----------------------------------------------------------------------

/** บรรทัดเอกสารตามที่ผู้ใช้กรอก (ไม่มี id) */
export type ScenarioLine = { description: string; qty: number; unitPrice: number; discount: number; accountCode: string };

/** บรรทัดเอกสารซื้อ — หัก ณ ที่จ่ายระดับบรรทัด */
export type ScenarioPurchaseLine = ScenarioLine & { whtIncomeType: string; whtRate: number };

/** บรรทัดใบลดหนี้ผู้ขาย — `purchaseLine` = ลำดับบรรทัดของเอกสารซื้อ (เริ่ม 1) ไม่ส่ง = จับคู่ตามบัญชี */
export type ScenarioCreditLine = ScenarioLine & { purchaseLine?: number };

export type ScenarioContact = Omit<Contact, 'id'>;

type InvoiceInput = {
  date: string;
  dueDate: string;
  contact: string;
  lines: ScenarioLine[];
  vatMode: VatMode;
  saleType?: SaleType;
  note?: string;
};

export type ScenarioStep =
  | { action: 'saveContact'; input: ScenarioContact & { update?: boolean } }
  | { action: 'issueTaxInvoice'; input: InvoiceInput }
  | { action: 'issueCreditNote' | 'issueDebitNote'; input: { invoice: string; date: string; reason: string; lines: ScenarioLine[] } }
  | {
      action: 'receivePayment';
      input: { invoice: string; date: string; amount: number; whtAmount: number; depositAccountCode: string };
    }
  | {
      action: 'refundCustomerCredit';
      input: { contact: string; date: string; amount: number; accountCode: string; note?: string };
    }
  | { action: 'setETaxStatus'; input: { docs: string[]; etax: ETaxStatus; at?: string; reference?: string } }
  | { action: 'lockPeriod'; input: { through: string; today: string } }
  | {
      action: 'setOpeningBalances';
      input: {
        date: string;
        lines: JournalLine[];
        vatCredit: number;
        whtReceivable: number;
        receivableControl: number;
        payableControl: number;
        receivables: { contact: string; docNo: string; date: string; dueDate: string; amount: number; serviceVat?: number }[];
        payables: {
          contact: string;
          docNo: string;
          date: string;
          amount: number;
          vatAmount?: number;
          whtIncomeType?: string;
          whtRate?: number;
        }[];
      };
    }
  // ---------------- C4b ----------------
  | {
      action: 'recordPurchase';
      input: {
        supplierInvoiceNo: string;
        supplierInvoiceDate?: string;
        vatClaimPeriod?: string;
        date: string;
        contact: string;
        vatMode: VatMode;
        claimVat: boolean;
        whtCondition: WhtCondition;
        note?: string;
        lines: ScenarioPurchaseLine[];
        payNow?: { date: string; accountCode: string };
      };
    }
  | { action: 'payPurchase'; input: { purchase: string; date: string; accountCode: string; amount?: number } }
  | {
      action: 'recordSupplierCreditNote';
      input: {
        purchase: string;
        supplierCreditNoteNo: string;
        supplierCreditNoteDate: string;
        date: string;
        reason: string;
        lines: ScenarioCreditLine[];
      };
    }
  | { action: 'receiveSupplierRefund'; input: { contact: string; date: string; amount: number; accountCode: string; note?: string } }
  | {
      action: 'recordPettyCashExpense';
      input: {
        pettyAccountCode: string;
        date: string;
        contact?: string;
        lines: { description: string; accountCode: string; amount: number }[];
        vatMode: VatMode;
        claimVat: boolean;
        supplierInvoiceNo?: string;
        supplierInvoiceDate?: string;
        vatClaimPeriod?: string;
        note?: string;
      };
    }
  | { action: 'transferFunds'; input: { date: string; fromAccountCode: string; toAccountCode: string; amount: number; note?: string } }
  | { action: 'addManualJournal'; input: { date: string; description: string; lines: JournalLine[] } }
  | {
      action: 'addBankAccount';
      input: { kind: BankAccountKind; bankName: string; accountNo: string; branch?: string; accountName?: string };
    }
  | {
      action: 'addBankStatementLines';
      input: {
        accountCode: string;
        lines: { date: string; description: string; amount: number; balance?: number }[];
        imported?: boolean;
      };
    }
  | { action: 'deleteBankStatementLines'; input: { statementRefs: number[] } }
  | { action: 'matchBankItems'; input: { accountCode: string; statementRefs: number[]; journals: string[] } }
  | { action: 'autoMatchBank'; input: { accountCode: string; windowDays?: number } }
  | { action: 'unmatchBank'; input: { statementRef: number } }
  | {
      action: 'saveQuotation';
      input: {
        quotation?: string;
        date: string;
        validDays: number;
        contact: string;
        lines: ScenarioLine[];
        vatMode: VatMode;
        saleType?: SaleType;
        note?: string;
      };
    }
  | { action: 'setQuotationStatus'; input: { quotation: string; status: QuotationStatus } }
  | { action: 'issueFromQuotation'; input: InvoiceInput & { quotation: string } }
  | { action: 'closeYear'; input: { fiscalYearEnd: string } };

export type ScenarioCompany = { name: string; taxId: string; branchNo: string; vatRegistered: boolean; address: Address };

export type Scenario = { name: string; description: string; company: ScenarioCompany; steps: ScenarioStep[] };

// ---------------- error code ----------------

/**
 * code ของข้อความ BusinessRuleError (TS มีแต่ข้อความ) — ฝั่ง C# โยน code เดียวกันที่จุดเดียวกัน แล้ว test เทียบทั้ง code และข้อความ
 * เรียงจากเฉพาะเจาะจงไปทั่วไป: ข้อความแรกที่ตรงชนะ — ข้อความที่ไม่ตรงข้อใดเลย = exporter ล้ม (ต้องเพิ่ม code ก่อน)
 */
export const ERROR_CODES: readonly [string, RegExp][] = [
  ['INVALID_DATE', /ไม่ถูกต้อง — ใช้ปี ค\.ศ\. รูปแบบ YYYY-MM-DD$/],
  ['PERIOD_LOCKED', /^ปิดงวดถึงวันที่ .+ แล้ว — ลงรายการวันที่ .+ ไม่ได้/],
  ['BEFORE_OPENING', /^ยอดยกมา ณ .+ — รายการใหม่ต้องลงวันที่หลังวันยอดยกมา/],
  ['DATE_ORDER', /— เลขที่ต้องเรียงตามวันที่$/],
  ['LOCK_IN_FUTURE', /^ปิดงวดได้ถึงสิ้นเดือนที่ผ่านมาแล้วเท่านั้น/],
  ['LOCK_BACKWARD', /— เลื่อนวันที่ปิดงวดย้อนหลังไม่ได้$/],
  ['OPENING_NOT_MONTH_END', /^วันที่ยอดยกมาต้องเป็นวันสิ้นเดือน/],
  ['OPENING_BLOCKED', /^บันทึกยอดยกมาได้ก่อนมีรายการอื่นเท่านั้น/],
  ['OPENING_CONTROL_ACCOUNT', /เป็นบัญชีคุม — ลูกหนี้\/เจ้าหนี้กรอกเป็นรายการค้างทีละใบ/],
  ['JOURNAL_CONTROL_ACCOUNT', /^บรรทัดที่ \d+: .+ เป็นบัญชีคุม ลงด้วยเอกสาร/],
  // บรรทัดบัญชีแยกประเภท (ยอดยกมา / รายการปรับปรุง): ไม่พบบัญชี, จำนวนเงินติดลบ
  ['JOURNAL_LINE_INVALID', /^บรรทัดที่ \d+: /],
  ['JOURNAL_UNBALANCED', /^รายการไม่สมดุล: /],
  ['JOURNAL_EMPTY', /^ยอดรวมต้องมากกว่า 0$/],
  ['DESCRIPTION_REQUIRED', /^ระบุคำอธิบายรายการ$/],
  ['OPENING_DUPLICATE_DOC', /ของผู้ติดต่อเดียวกันซ้ำในรายการค้าง$/],
  ['OPENING_NUMBER_CONFLICT', /ซ้ำรูปแบบเลขที่ที่ระบบนี้จะออกหลังวันยอดยกมา/],
  ['OPENING_DOCNO_REQUIRED', /: ระบุเลขที่เอกสารในระบบเดิม$/],
  ['OPENING_DOC_AFTER_DATE', /: วันที่เอกสารต้องไม่หลังวันยอดยกมา$/],
  ['OPENING_AR_MISMATCH', /^ลูกหนี้คงค้างรวม .+ ไม่เท่ากับยอดลูกหนี้การค้าตามงบทดลองเดิม/],
  ['OPENING_AP_MISMATCH', /^เจ้าหนี้คงค้างรวม .+ ไม่เท่ากับยอดเจ้าหนี้การค้าตามงบทดลองเดิม/],
  ['OPENING_UNBALANCED', /^ยอดยกมาไม่สมดุล/],
  ['OPENING_EMPTY', /^ยังไม่มียอดยกมา$/],
  ['OPENING_SERVICE_VAT', /ภาษีขายยังไม่ถึงกำหนด/],
  ['OPENING_CONTACT_KIND', /^(ลูกหนี้|เจ้าหนี้)รายการที่ \d+: .+ เป็น(ผู้ขาย|ลูกค้า)เท่านั้น$/],
  ['OPENING_ITEM_INVALID', /^(ลูกหนี้|เจ้าหนี้)รายการที่ \d+: /],
  ['DUE_BEFORE_DATE', /^วันครบกำหนดต้องไม่ก่อนวันที่เอกสาร$/],
  ['NO_LINES', /^ต้องมีอย่างน้อย 1 รายการ$/],
  ['LINE_DESCRIPTION', /^รายการที่ \d+ ยังไม่มีคำอธิบาย$/],
  ['LINE_QTY', /^รายการที่ \d+: จำนวนต้องมากกว่า 0$/],
  ['LINE_PRICE', /^รายการที่ \d+: ราคาต่อหน่วยติดลบไม่ได้$/],
  ['LINE_DISCOUNT', /^รายการที่ \d+: ส่วนลด(ติดลบไม่ได้|เกินมูลค่ารายการ)$/],
  ['LINE_ACCOUNT_NOT_FOUND', /^รายการที่ \d+: ไม่พบบัญชี .+ ในผังบัญชี$/],
  ['LINE_ACCOUNT_INVALID', /^รายการที่ \d+: .+ (เป็นบัญชีคุม ใช้ในบรรทัดรายการไม่ได้|ไม่ใช่บัญชีรายได้|ไม่ใช่บัญชีค่าใช้จ่ายหรือสินทรัพย์)$/],
  ['WHT_RATE_INVALID', /^รายการที่ \d+: อัตราหัก ณ ที่จ่ายต้องอยู่ระหว่าง /],
  ['WHT_INCOME_TYPE_REQUIRED', /^รายการที่ \d+: หัก ณ ที่จ่ายต้องระบุประเภทเงินได้$/],
  ['PURCHASE_LINE_NOT_FOUND', /รายการที่ \d+: ไม่พบบรรทัดของ.+ที่อ้างถึง$/],
  ['SUPPLIER_CREDIT_LINE_EXCEEDS', /รายการที่ \d+: ลดเกินมูลค่า/],
  ['CONTACT_NOT_FOUND', /^ไม่พบผู้ติดต่อ/],
  ['CONTACT_NOT_CUSTOMER', /เป็นผู้ขายเท่านั้น — ตั้ง(ประเภทผู้ติดต่อ)?เป็นลูกค้าหรือทั้งสองก่อน/],
  ['CONTACT_NAME_REQUIRED', /^ต้องระบุชื่อ$/],
  ['CONTACT_CODE_DUPLICATE', /^รหัส .+ ซ้ำกับ /],
  ['TOTAL_NOT_POSITIVE', /^ยอดรวมเอกสารต้องมากกว่า 0$/],
  ['INVOICE_NOT_FOUND', /^ไม่พบใบกำกับภาษี/],
  ['OPENING_DOC_ADJUSTMENT', /เป็นยอดยกมาจากระบบเดิม — /],
  ['INVOICE_CANCELLED', /ถูกยกเลิกด้วยใบลดหนี้แล้ว — ออกใบกำกับใหม่แทน$/],
  ['SERVICE_DEBIT_NOT_SUPPORTED', /เป็นใบแจ้งหนี้งานบริการ — ค่าบริการที่เพิ่มให้ออกใบแจ้งหนี้ใบใหม่/],
  ['REASON_REQUIRED', /ต้องระบุเหตุผล$/],
  ['ADJUSTMENT_BEFORE_INVOICE', /ต้องไม่ก่อนวันที่ใบกำกับเดิม$/],
  ['ADJUSTMENT_BEFORE_RECEIPT', /ต้องไม่ก่อนวันรับชำระครั้งล่าสุดของ /],
  ['CREDIT_EXCEEDS_CREDITABLE', /^ยอดลดหนี้ .+ เกินยอดที่ลดได้ /],
  ['CREDIT_VAT_EXCEEDS', /^ภาษีที่ลดรวม .+ เกินภาษีขายของ /],
  ['CREDIT_NET_EXCEEDS', /^มูลค่าที่ลดรวม .+ เกินมูลค่าของ /],
  ['SERVICE_CREDIT_EXCEEDS_OUTSTANDING', /^งานบริการที่ยังรับเงินไม่ครบ ลดหนี้ได้ไม่เกินยอดค้างรับ/],
  ['SERVICE_CREDIT_VAT_EXCEEDS_DEFERRED', /^ภาษีของใบลดหนี้ .+ เกินภาษีขายรอตัดคงเหลือ/],
  ['SERVICE_CREDIT_ROUNDING', /^ภาษีของใบลดหนี้ต่างจากภาษีขายรอตัดคงเหลือ/],
  ['SERVICE_CREDIT_NO_RECEIPT', /ยังไม่มีใบเสร็จรับเงิน\/ใบกำกับภาษี — ลดหนี้ไม่ได้$/],
  ['SERVICE_CREDIT_EXCEEDS_TAXED', /^(ภาษีที่ลด|มูลค่าที่ลด) .+ เกิน(ภาษีขาย|มูลค่า)ที่ออกใบกำกับไปแล้ว/],
  ['RECEIPT_BEFORE_INVOICE', /^วันที่รับชำระต้องไม่ก่อนวันที่ใบกำกับ$/],
  ['AMOUNT_EXCEEDS_OUTSTANDING', /^ยอดรับชำระเกินยอดค้าง/],
  ['WHT_INVALID', /^ภาษีถูกหัก ณ ที่จ่ายต้องน้อยกว่ายอดรับชำระ$/],
  ['WHT_EXCEEDS_MAX', /^ภาษีถูกหัก ณ ที่จ่ายเกิน /],
  ['ACCOUNT_NOT_CASH', /ใช้รับ\/จ่ายเงินไม่ได้ — เลือกบัญชีเงินสดหรือธนาคาร$/],
  ['REFUND_EXCEEDS_CREDIT', /^ยอดคืนเงินเกินยอดรอคืน/],
  ['PETTY_CASH_INSUFFICIENT', /^เงินสดย่อย .+ คงเหลือไม่พอ/],
  ['ETAX_INVALID_TARGET', /^ตั้งสถานะเป็น "ไม่ต้องออก e-Tax" ไม่ได้$/],
  ['ETAX_DOC_NOT_FOUND', /^ไม่พบเอกสารบางใบ$/],
  ['ETAX_NOT_REQUIRED', / ไม่ต้องออก e-Tax$/],
  ['ETAX_BACKWARD', /: สถานะ e-Tax ย้อนกลับไม่ได้$/],
  ['ETAX_SIGN_FIRST', /: ต้องลงนามก่อนนำส่ง e-Tax$/],
  // ---------------- ซื้อ / จ่าย / ใบลดหนี้ผู้ขาย (C4b) ----------------
  ['SUPPLIER_INVOICE_NO_REQUIRED', /^ขอคืนภาษีซื้อต้องมีเลขที่ใบกำกับภาษีของผู้ขาย$/],
  ['VAT_CLAIM_DATE_REQUIRED', /^ขอคืนภาษีซื้อต้องระบุวันที่ในใบกำกับภาษีของผู้ขาย/],
  ['SUPPLIER_INVOICE_AFTER_DATE', /^วันที่ใบกำกับผู้ขายต้องไม่หลังวันที่บันทึก$/],
  ['VAT_CLAIM_PERIOD_REQUIRED', /^ขอคืนภาษีซื้อต้องเลือกเดือนที่ใช้สิทธิ$/],
  ['VAT_CLAIM_PERIOD_BEFORE_INVOICE', /^เดือนที่ใช้สิทธิภาษีซื้อต้องไม่ก่อนเดือนในใบกำกับของผู้ขาย$/],
  ['VAT_CLAIM_PERIOD_EXPIRED', /^ใช้สิทธิภาษีซื้อได้ไม่เกิน \d+ เดือนถัดจากเดือนในใบกำกับ/],
  ['VAT_CLAIM_PERIOD_LOCKED', /^เดือนภาษี .+ ปิดงวดแล้ว \(ยื่น ภ\.พ\.30 ไปแล้ว\)/],
  ['VAT_CLAIM_PERIOD_BEFORE_OPENING', /^เดือนภาษี .+ ยื่นในระบบเดิมแล้ว/],
  ['SUPPLIER_INVOICE_DUPLICATE', /^ใบกำกับผู้ขายเลขที่ .+ บันทึกไปแล้วใน /],
  ['PURCHASE_NOT_FOUND', /^ไม่พบเอกสารซื้อ/],
  ['PURCHASE_PAID', /^\S+ จ่ายชำระแล้ว$/],
  ['PAYMENT_BEFORE_PURCHASE', /^วันที่จ่ายต้องไม่ก่อนวันที่เอกสาร$/],
  ['PAYMENT_EXCEEDS_OUTSTANDING', /^ยอดจ่ายเกินยอดค้าง/],
  ['WHT_EXCEEDS_PAYMENT', /^ภาษีหัก ณ ที่จ่ายเกินยอดที่จ่ายครั้งนี้/],
  ['SUPPLIER_CREDIT_DATE_ORDER', /^วันที่ในใบลดหนี้ของผู้ขายต้องไม่หลังวันที่ได้รับ$/],
  ['ADJUSTMENT_BEFORE_PURCHASE', /^วันที่ได้รับใบลดหนี้ต้องไม่ก่อนวันที่บันทึก /],
  ['ADJUSTMENT_BEFORE_PAYMENT', /^วันที่ได้รับใบลดหนี้ต้องไม่ก่อนการจ่ายครั้งล่าสุดของ /],
  ['SUPPLIER_CREDIT_NO_REQUIRED', /^ลดภาษีซื้อต้องมีเลขที่ใบลดหนี้ของผู้ขาย$/],
  ['SUPPLIER_CREDIT_DUPLICATE', /^ใบลดหนี้ผู้ขายเลขที่ .+ บันทึกไปแล้วใน /],
  ['SUPPLIER_CREDIT_EXCEEDS', /^ยอดลดหนี้ .+ เกินยอดที่ลดได้ของ /],
  ['SUPPLIER_CREDIT_VAT_EXCEEDS', /^ภาษีที่ลดรวมเกินภาษีของ /],
  ['SUPPLIER_CREDIT_NET_EXCEEDS', /^มูลค่าที่ลดรวมเกินมูลค่าของ /],
  ['SUPPLIER_CREDIT_BEFORE_CLAIM', /^ภาษีซื้อของ .+ ใช้สิทธิเดือน .+ — บันทึกใบลดหนี้ \(ลดภาษีซื้อ\) ได้ตั้งแต่เดือนนั้น$/],
  ['SUPPLIER_REFUND_EXCEEDS', /^ยอดรับคืนเกินยอดเงินคืนจากผู้ขาย/],
  ['NOT_PETTY_CASH', /^บัญชี .+ ไม่ใช่เงินสดย่อย$/],
  ['PETTY_VENDOR_REQUIRED', /^ขอคืนภาษีซื้อต้องเลือกผู้ขาย/],
  ['SUPPLIER_TAX_ID_INVALID', /— ขอคืนภาษีซื้อไม่ได้ \(ม\.82\/5\)$/],
  // ---------------- ธนาคาร / กระทบยอด (C4b) ----------------
  ['TRANSFER_SAME_ACCOUNT', /^บัญชีต้นทางและปลายทางต้องต่างกัน$/],
  ['BANK_ACCOUNT_INVALID', /^ระบุ(ชื่อธนาคารและเลขที่บัญชี|ชื่อผู้ถือเงินสดย่อย \/ แผนก)$/],
  ['BANK_ACCOUNT_DUPLICATE', / ลงทะเบียนแล้ว \(บัญชี \d+\)$/],
  ['BANK_ACCOUNT_LIMIT', /^เพิ่ม.+ได้ไม่เกิน 9 บัญชี$/],
  ['NOT_BANK_ACCOUNT', /^บัญชี .+ ไม่ใช่บัญชีธนาคารที่ลงทะเบียน$/],
  ['STATEMENT_EMPTY', /^ไม่มีรายการ statement$/],
  ['STATEMENT_LINE_INVALID', /^แถวที่ \d+: /],
  ['STATEMENT_MATCHED', /^รายการที่จับคู่แล้วลบไม่ได้/],
  ['BANK_MATCH_AMOUNT', /^ยอดไม่เท่ากัน: statement /],
  ['BANK_MATCH_USED', / จับคู่ไปแล้ว$/],
  ['BANK_MATCH_NOT_FOUND', /^ไม่พบการจับคู่$/],
  ['BANK_MATCH_INVALID', /^(เลือกรายการ statement และรายการในสมุดบัญชี|เลือกรายการซ้ำ|ไม่พบรายการ statement ของบัญชีนี้|ไม่พบรายการเคลื่อนไหวของบัญชีนี้)/],
  // ---------------- ใบเสนอราคา (C4b) ----------------
  ['QUOTATION_VALID_DAYS', /^ยืนราคาได้ 0–365 วัน$/],
  ['QUOTATION_NOT_FOUND', /^ไม่พบใบเสนอราคา$/],
  ['QUOTATION_CONVERTED', / ออกเอกสารขาย(แล้ว|ไปแล้ว)/],
  ['QUOTATION_MONTH', /เป็นของเดือนเดิม — แก้วันที่ได้ภายในเดือนเดียวกัน/],
  ['QUOTATION_STATUS_INVALID', /^สถานะไม่ถูกต้อง$/],
  ['QUOTATION_REJECTED', / ลูกค้าไม่อนุมัติ — /],
  ['QUOTATION_EXPIRED', / หมดอายุแล้ว — /],
  ['QUOTATION_CONTACT_MISMATCH', /^ลูกค้าต้องตรงกับใบเสนอราคา /],
  ['QUOTATION_DATE_ORDER', /^วันที่เอกสารต้องไม่ก่อนวันที่ใบเสนอราคา /],
  // ---------------- ปิดบัญชีสิ้นปี (C4b) ----------------
  ['YEAR_END_NOT_MONTH_END', /^วันสิ้นรอบบัญชีต้องเป็นวันสิ้นเดือน$/],
  ['YEAR_CLOSE_NOT_LOCKED', /^ต้องปิดงวดถึง .+ ก่อนปิดบัญชีสิ้นปี/],
  ['YEAR_CLOSE_BEFORE_OPENING', /^วันสิ้นปีต้องหลังวันยอดยกมา/],
  ['YEAR_CLOSE_BACKWARD', /^ปิดบัญชีถึง .+ แล้ว — ปิดย้อนหลังไม่ได้$/],
  ['YEAR_CLOSE_SEQUENCE', /^รอบบัญชีถัดไปต้องสิ้นสุด /],
  ['YEAR_CLOSE_NO_RETAINED', /^ไม่พบบัญชี .+ กำไร \(ขาดทุน\) สะสม ในผังบัญชี$/],
  ['AMOUNT_INVALID', /(ติดลบไม่ได้|ต้องมากกว่า 0)$/],
];

export function errorCodeOf(message: string): string {
  const hit = ERROR_CODES.find(([, re]) => re.test(message));
  if (!hit) throw new Error(`scenario golden: no error code for message "${message}" — add one to ERROR_CODES`);
  return hit[0];
}

// ---------------- observable output ----------------

type Party = { name: string; taxId: string; branchNo: string } | null;

const party = (p: { name: string; taxId: string; branchNo: string } | undefined): Party =>
  p ? { name: p.name, taxId: p.taxId, branchNo: p.branchNo } : null;

const sat = (baht: number | undefined): number | null => (baht === undefined ? null : toSatang(baht));

function codeOf(state: AccountingData, id: string): string {
  return state.contacts.find((c) => c.id === id)?.code ?? '?';
}

function docNoOf(state: AccountingData, id: string | undefined): string | null {
  if (!id) return null;
  return [...state.sales, ...state.receipts].find((d) => d.id === id)?.docNo ?? '?';
}

function purchaseDocNoOf(state: AccountingData, id: string): string {
  return state.purchases.find((p) => p.id === id)?.docNo ?? '?';
}

function journalDocNo(state: AccountingData, id: string | undefined): string | null {
  if (!id) return null;
  return state.journal.find((e) => e.id === id)?.docNo ?? null;
}

function salesOut(state: AccountingData, s: SalesDoc) {
  const t = calcDocument(s);
  return {
    type: 'sales',
    docNo: s.docNo,
    kind: s.kind,
    isTaxInvoice: s.isTaxInvoice ?? null,
    saleType: s.saleType ?? null,
    opening: s.opening ?? false,
    date: s.date,
    dueDate: s.dueDate,
    contact: codeOf(state, s.contactId),
    vatMode: s.vatMode,
    vatRate: s.vatRate,
    net: toSatang(t.net),
    vat: toSatang(t.vat),
    total: toSatang(t.total),
    refDocNo: docNoOf(state, s.refDocId),
    refReceiptNo: docNoOf(state, s.refReceiptId),
    reason: s.reason ?? null,
    note: s.note ?? null,
    originalNet: sat(s.originalNet),
    correctNet: sat(s.correctNet),
    creditToCustomer: sat(s.creditToCustomer),
    deferredVatRounding: sat(s.deferredVatRounding),
    buyer: party(s.buyer),
    seller: s.seller ? { taxId: s.seller.taxId, vatRegistered: s.seller.vatRegistered } : null,
    journalDocNo: journalDocNo(state, s.journalId),
  };
}

function receiptOut(state: AccountingData, r: Receipt) {
  return {
    type: 'receipt',
    docNo: r.docNo,
    date: r.date,
    invoiceDocNo: docNoOf(state, r.invoiceId),
    contact: codeOf(state, r.contactId),
    amount: toSatang(r.amount),
    whtAmount: toSatang(r.whtAmount),
    depositAccountCode: r.depositAccountCode,
    isTaxInvoice: r.isTaxInvoice ?? false,
    vat: sat(r.vat),
    buyer: party(r.buyer),
    seller: r.seller ? { taxId: r.seller.taxId, vatRegistered: r.seller.vatRegistered } : null,
    journalDocNo: journalDocNo(state, r.journalId),
  };
}

function refundOut(state: AccountingData, r: CustomerRefund) {
  return {
    type: 'refund',
    docNo: r.docNo,
    date: r.date,
    contact: codeOf(state, r.contactId),
    amount: toSatang(r.amount),
    accountCode: r.accountCode,
    note: r.note ?? null,
    buyer: party(r.buyer),
    journalDocNo: journalDocNo(state, r.journalId),
  };
}

function purchaseOut(state: AccountingData, p: PurchaseDoc) {
  const t = calcDocument(p);
  return {
    type: 'purchase',
    docNo: p.docNo,
    opening: p.opening ?? false,
    supplierInvoiceNo: p.supplierInvoiceNo,
    supplierInvoiceDate: p.supplierInvoiceDate ?? null,
    date: p.date,
    contact: codeOf(state, p.contactId),
    vatMode: p.vatMode,
    vatRate: p.vatRate,
    claimVat: p.claimVat,
    vatClaimPeriod: p.vatClaimPeriod ?? null,
    whtCondition: p.whtCondition,
    note: p.note ?? null,
    net: toSatang(t.net),
    vat: toSatang(t.vat),
    total: toSatang(t.total),
    whtRates: p.lines.map((l) => l.whtRate),
    whtIncomeTypes: p.lines.map((l) => l.whtIncomeType),
    supplier: party(p.supplier),
    journalDocNo: journalDocNo(state, p.journalId),
  };
}

function paymentOut(state: AccountingData, p: Payment) {
  return {
    type: 'payment',
    docNo: p.docNo,
    date: p.date,
    purchaseDocNo: purchaseDocNoOf(state, p.purchaseId),
    contact: codeOf(state, p.contactId),
    amount: toSatang(p.amount),
    whtAmount: toSatang(p.whtAmount),
    netPaid: toSatang(p.netPaid),
    whtItems: p.whtItems.map((i) => ({ incomeType: i.incomeType, rate: i.rate, base: toSatang(i.base), tax: toSatang(i.tax) })),
    accountCode: p.accountCode,
    whtCertNo: p.whtCertNo ?? null,
    payee: party(p.payee),
    journalDocNo: journalDocNo(state, p.journalId),
  };
}

function purchaseCreditOut(state: AccountingData, c: PurchaseCreditNote) {
  const t = calcDocument(c);
  return {
    type: 'purchase-credit',
    docNo: c.docNo,
    supplierCreditNoteNo: c.supplierCreditNoteNo,
    supplierCreditNoteDate: c.supplierCreditNoteDate,
    date: c.date,
    purchaseDocNo: purchaseDocNoOf(state, c.purchaseId),
    contact: codeOf(state, c.contactId),
    vatMode: c.vatMode,
    net: toSatang(t.net),
    vat: toSatang(t.vat),
    total: toSatang(t.total),
    refundDue: sat(c.refundDue),
    claimVat: c.claimVat,
    vatClaimPeriod: c.vatClaimPeriod ?? null,
    reason: c.reason,
    journalDocNo: journalDocNo(state, c.journalId),
  };
}

function supplierRefundOut(state: AccountingData, r: SupplierRefund) {
  return {
    type: 'supplier-refund',
    docNo: r.docNo,
    date: r.date,
    contact: codeOf(state, r.contactId),
    amount: toSatang(r.amount),
    accountCode: r.accountCode,
    note: r.note ?? null,
    journalDocNo: journalDocNo(state, r.journalId),
  };
}

function transferOut(state: AccountingData, t: BankTransfer) {
  return {
    type: 'transfer',
    docNo: t.docNo,
    date: t.date,
    fromAccountCode: t.fromAccountCode,
    toAccountCode: t.toAccountCode,
    amount: toSatang(t.amount),
    note: t.note ?? null,
    journalDocNo: journalDocNo(state, t.journalId),
  };
}

function quotationOut(state: AccountingData, q: Quotation) {
  const t = calcDocument(q);
  return {
    docNo: q.docNo,
    date: q.date,
    validDays: q.validDays,
    contact: codeOf(state, q.contactId),
    status: q.status,
    convertedDocNo: docNoOf(state, q.convertedSalesId),
    vatMode: q.vatMode,
    vatRate: q.vatRate,
    saleType: q.saleType ?? null,
    note: q.note ?? null,
    lines: q.lines.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, accountCode: l.accountCode })),
    net: toSatang(t.net),
    vat: toSatang(t.vat),
    total: toSatang(t.total),
    buyer: party(q.buyer),
  };
}

function entryOut(e: JournalEntry) {
  return {
    docNo: e.docNo,
    date: e.date,
    source: e.source,
    sourceDocNo: e.sourceDocNo ?? null,
    description: e.description,
    lines: e.lines.map((l) => ({
      accountCode: l.accountCode,
      debit: toSatang(l.debit),
      credit: toSatang(l.credit),
      description: l.description ?? null,
    })),
  };
}

const byDocNo = <T extends { docNo: string }>(a: T, b: T) => a.docNo.localeCompare(b.docNo);

/** ลำดับของรายการ statement (เริ่ม 1 ตามลำดับที่เพิ่ม ไม่นับใหม่หลังลบ) — แทน id ที่สุ่ม */
type ReplayContext = { statementRefs: Map<string, number>; nextRef: number };

/** ผลเฉพาะของ action (จำนวนที่นำเข้า/ข้าม, จับคู่อัตโนมัติ, ปิดปีซ้ำ, คำเตือนใบลดหนี้ผู้ขาย) — ไม่มี = null */
export type StepResult =
  | { added: number; skipped: number }
  | { matched: number }
  | { already: boolean; netProfit: number }
  | { warnings: string[] }
  | null;

/** ผลที่สังเกตได้ของขั้นที่สำเร็จ: เอกสาร/รายการบัญชีใหม่ + สถานะทั้งสมุด (ยอดค้างทุกใบ, เงินรอคืน, e-Tax, ปิดงวด, ภาษี, ธนาคาร) */
function observe(before: AccountingData, after: AccountingData, ctx: ReplayContext, result: StepResult) {
  const known = (ids: { id: string }[]) => new Set(ids.map((x) => x.id));
  const isNew = <T extends { id: string }>(prev: T[], next: T[]) => {
    const old = known(prev);
    return next.filter((x) => !old.has(x.id));
  };
  const oldJournal = new Set(before.journal.map((e) => JSON.stringify(e)));
  const docs = [
    ...isNew(before.sales, after.sales).map((s) => salesOut(after, s)),
    ...isNew(before.receipts, after.receipts).map((r) => receiptOut(after, r)),
    ...isNew(before.refunds, after.refunds).map((r) => refundOut(after, r)),
    ...isNew(before.purchases, after.purchases).map((p) => purchaseOut(after, p)),
    ...isNew(before.payments, after.payments).map((p) => paymentOut(after, p)),
    ...isNew(before.purchaseCredits, after.purchaseCredits).map((c) => purchaseCreditOut(after, c)),
    ...isNew(before.supplierRefunds ?? [], after.supplierRefunds ?? []).map((r) => supplierRefundOut(after, r)),
    ...isNew(before.transfers, after.transfers).map((t) => transferOut(after, t)),
  ].sort((a, b) => a.type.localeCompare(b.type) || a.docNo.localeCompare(b.docNo));
  // C4b: รวมรายการปิดภาษีเดือน (vat-close) ที่ lockPeriod ลง และปิดบัญชีสิ้นปี (year-close)
  const journal = after.journal
    .filter((e) => !oldJournal.has(JSON.stringify(e)))
    .map(entryOut)
    .sort(byDocNo);
  const invoices = after.sales
    .filter((s) => s.kind === 'tax-invoice')
    .map((s) => ({ docNo: s.docNo, status: s.status, paidAmount: toSatang(s.paidAmount), outstanding: toSatang(outstandingOf(after, s)) }))
    .sort(byDocNo);
  const purchases = after.purchases
    .map((p) => ({ docNo: p.docNo, paid: p.paid, outstanding: toSatang(purchaseOutstanding(after, p)) }))
    .sort(byDocNo);
  const etax = [
    ...after.sales.filter((s) => s.etax !== 'not-required').map((s) => ({ docNo: s.docNo, etax: s.etax, at: s.etaxUploadedAt ?? null, reference: s.etaxReference ?? null })),
    ...after.receipts
      .filter((r) => r.etax && r.etax !== 'not-required')
      .map((r) => ({ docNo: r.docNo, etax: r.etax as ETaxStatus, at: r.etaxUploadedAt ?? null, reference: r.etaxReference ?? null })),
  ].sort(byDocNo);
  const customerCredit = Object.fromEntries(
    after.contacts
      .filter((c) => c.kind !== 'vendor')
      .map((c) => [c.code, toSatang(customerCreditOf(after, c.id))])
  );
  const supplierRefundDue = Object.fromEntries(
    after.contacts
      .filter((c) => c.kind !== 'customer')
      .map((c) => [c.code, toSatang(supplierRefundDueOf(after, c.id))])
  );
  const vatCloses = after.vatCloses
    .slice()
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((c) => ({
      period: c.period,
      date: c.date,
      outputVat: toSatang(c.outputVat),
      inputVat: toSatang(c.inputVat),
      broughtForward: toSatang(c.broughtForward),
      payable: toSatang(c.payable),
      carriedForward: toSatang(c.carriedForward),
      journalDocNo: journalDocNo(after, c.journalId),
    }));
  const yearCloses = after.yearCloses
    .slice()
    .sort((a, b) => a.fiscalYearEnd.localeCompare(b.fiscalYearEnd))
    .map((c) => ({ fiscalYearEnd: c.fiscalYearEnd, netProfit: toSatang(c.netProfit), journalDocNo: journalDocNo(after, c.journalId) }));
  const accountName = (code: string) => after.accounts.find((a) => a.code === code)?.name ?? null;
  const bankAccounts = after.bankAccounts
    .slice()
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
    .map((b) => ({
      accountCode: b.accountCode,
      kind: b.kind,
      bankName: b.bankName,
      accountNo: b.accountNo,
      branch: b.branch ?? null,
      reconcileFrom: b.reconcileFrom ?? null,
      accountName: accountName(b.accountCode),
    }));
  after.bankStatements.forEach((l) => {
    if (!ctx.statementRefs.has(l.id)) {
      ctx.statementRefs.set(l.id, ctx.nextRef);
      ctx.nextRef += 1;
    }
  });
  const ref = (id: string) => ctx.statementRefs.get(id) ?? 0;
  const bankStatements = after.bankStatements
    .map((l) => ({
      ref: ref(l.id),
      accountCode: l.accountCode,
      date: l.date,
      description: l.description,
      amount: toSatang(l.amount),
      balance: sat(l.balance),
      imported: !!l.batchId,
    }))
    .sort((a, b) => a.ref - b.ref);
  const bankMatches = after.bankMatches
    .map((m) => ({
      accountCode: m.accountCode,
      statementRefs: m.statementLineIds.map(ref),
      journalDocNos: m.journalIds.map((id) => journalDocNo(after, id)),
      auto: m.auto,
    }))
    .sort((a, b) => a.statementRefs[0] - b.statementRefs[0]);
  return {
    docs,
    journal,
    invoices,
    purchases,
    etax,
    customerCredit,
    supplierRefundDue,
    quotations: after.quotations.map((q) => quotationOut(after, q)).sort(byDocNo),
    vatCloses,
    yearCloses,
    bankAccounts,
    bankStatements,
    bankMatches,
    result,
    lockedThrough: after.company.lockedThrough ?? null,
    openingDate: after.openingBalance?.date ?? null,
  };
}

// ---------------- replay ----------------

const withIds = <T extends ScenarioLine>(lines: T[], tag: string) => lines.map((l, i) => ({ ...l, id: `${tag}-${i + 1}` }));

function contactId(state: AccountingData, code: string): string {
  // รหัสที่ไม่มี = id ที่ไม่มีจริง (action ตอบ "ไม่พบผู้ติดต่อ")
  return state.contacts.find((c) => c.code === code)?.id ?? `missing:${code}`;
}

function docId(state: AccountingData, docNo: string): string {
  return [...state.sales, ...state.receipts].find((d) => d.docNo === docNo)?.id ?? `missing:${docNo}`;
}

function purchaseOf(state: AccountingData, docNo: string): PurchaseDoc | undefined {
  return state.purchases.find((p) => p.docNo === docNo);
}

function quotationId(state: AccountingData, docNo: string): string {
  return state.quotations.find((q) => q.docNo === docNo)?.id ?? `missing:${docNo}`;
}

function journalId(state: AccountingData, docNo: string): string {
  return state.journal.find((e) => e.docNo === docNo)?.id ?? `missing:${docNo}`;
}

function statementIds(ctx: ReplayContext, refs: number[]): string[] {
  const byRef = new Map(Array.from(ctx.statementRefs.entries()).map(([id, n]) => [n, id]));
  return refs.map((n) => byRef.get(n) ?? `missing:${n}`);
}

function apply(state: AccountingData, step: ScenarioStep, tag: string, ctx: ReplayContext): { state: AccountingData; result: StepResult } {
  const plain = (next: AccountingData) => ({ state: next, result: null });
  switch (step.action) {
    case 'saveContact': {
      const { update, ...contact } = step.input;
      const id = update ? state.contacts.find((c) => c.code === contact.code)?.id : undefined;
      return plain(saveContact(state, { ...contact, ...(id ? { id } : {}) }).state);
    }
    case 'issueTaxInvoice': {
      const { contact, lines, ...rest } = step.input;
      return plain(issueTaxInvoice(state, { ...rest, contactId: contactId(state, contact), lines: withIds(lines, tag) }).state);
    }
    case 'issueCreditNote':
    case 'issueDebitNote': {
      const { invoice, lines, ...rest } = step.input;
      const fn = step.action === 'issueCreditNote' ? issueCreditNote : issueDebitNote;
      return plain(fn(state, { ...rest, invoiceId: docId(state, invoice), lines: withIds(lines, tag) }).state);
    }
    case 'receivePayment': {
      const { invoice, ...rest } = step.input;
      return plain(receivePayment(state, { ...rest, invoiceId: docId(state, invoice) }).state);
    }
    case 'refundCustomerCredit': {
      const { contact, ...rest } = step.input;
      return plain(refundCustomerCredit(state, { ...rest, contactId: contactId(state, contact) }).state);
    }
    case 'setETaxStatus': {
      const { docs, etax, at, reference } = step.input;
      return plain(setETaxStatus(state, docs.map((d) => docId(state, d)), etax, { at, reference }));
    }
    case 'lockPeriod':
      return plain(lockPeriod(state, step.input.through, step.input.today));
    case 'setOpeningBalances': {
      const { receivables, payables, ...rest } = step.input;
      return plain(
        setOpeningBalances(state, {
          ...rest,
          receivables: receivables.map(({ contact, ...r }) => ({ ...r, contactId: contactId(state, contact) })),
          payables: payables.map(({ contact, ...p }) => ({ ...p, contactId: contactId(state, contact) })),
        }).state
      );
    }
    case 'recordPurchase': {
      const { contact, lines, ...rest } = step.input;
      return plain(recordPurchase(state, { ...rest, contactId: contactId(state, contact), lines: withIds(lines, tag) }).state);
    }
    case 'payPurchase': {
      const { purchase, ...rest } = step.input;
      return plain(payPurchase(state, { ...rest, purchaseId: purchaseOf(state, purchase)?.id ?? `missing:${purchase}` }).state);
    }
    case 'recordSupplierCreditNote': {
      const { purchase, lines, ...rest } = step.input;
      const doc = purchaseOf(state, purchase);
      const credit = withIds(lines, tag).map(({ purchaseLine, ...l }) => ({
        ...l,
        ...(purchaseLine ? { purchaseLineId: doc?.lines[purchaseLine - 1]?.id ?? `missing:${purchaseLine}` } : {}),
      }));
      const r = recordSupplierCreditNote(state, { ...rest, purchaseId: doc?.id ?? `missing:${purchase}`, lines: credit });
      return { state: r.state, result: { warnings: r.warnings } };
    }
    case 'receiveSupplierRefund': {
      const { contact, ...rest } = step.input;
      return plain(receiveSupplierRefund(state, { ...rest, contactId: contactId(state, contact) }).state);
    }
    case 'recordPettyCashExpense': {
      const { contact, lines, ...rest } = step.input;
      return plain(
        recordPettyCashExpense(state, {
          ...rest,
          ...(contact ? { contactId: contactId(state, contact) } : {}),
          lines: lines.map((l, i) => ({ ...l, id: `${tag}-${i + 1}` })),
        }).state
      );
    }
    case 'transferFunds':
      return plain(transferFunds(state, step.input).state);
    case 'addManualJournal':
      return plain(addManualJournal(state, step.input).state);
    case 'addBankAccount':
      return plain(addBankAccount(state, step.input).state);
    case 'addBankStatementLines': {
      const r = addBankStatementLines(state, step.input);
      return { state: r.state, result: { added: r.added, skipped: r.skipped } };
    }
    case 'deleteBankStatementLines':
      return plain(deleteBankStatementLines(state, statementIds(ctx, step.input.statementRefs)));
    case 'matchBankItems': {
      const { accountCode, statementRefs, journals } = step.input;
      return plain(
        matchBankItems(state, {
          accountCode,
          statementLineIds: statementIds(ctx, statementRefs),
          journalIds: journals.map((no) => journalId(state, no)),
        }).state
      );
    }
    case 'autoMatchBank': {
      const r = autoMatchBank(state, step.input.accountCode, step.input.windowDays);
      return { state: r.state, result: { matched: r.matched } };
    }
    case 'unmatchBank': {
      const [lineId] = statementIds(ctx, [step.input.statementRef]);
      const match = state.bankMatches.find((m) => m.statementLineIds.includes(lineId));
      return plain(unmatchBank(state, match?.id ?? `missing:${step.input.statementRef}`));
    }
    case 'saveQuotation': {
      const { quotation, contact, lines, ...rest } = step.input;
      return plain(
        saveQuotation(state, {
          ...rest,
          ...(quotation ? { id: quotationId(state, quotation) } : {}),
          contactId: contactId(state, contact),
          lines: withIds(lines, tag),
        }).state
      );
    }
    case 'setQuotationStatus':
      return plain(setQuotationStatus(state, quotationId(state, step.input.quotation), step.input.status));
    case 'issueFromQuotation': {
      const { quotation, contact, lines, ...rest } = step.input;
      return plain(
        issueFromQuotation(state, quotationId(state, quotation), { ...rest, contactId: contactId(state, contact), lines: withIds(lines, tag) }).state
      );
    }
    case 'closeYear': {
      const r = closeYear(state, step.input.fiscalYearEnd);
      return { state: r.state, result: { already: r.already, netProfit: toSatang(r.close.netProfit) } };
    }
    default:
      throw new Error('unknown scenario action');
  }
}

export type ScenarioStepResult =
  | { ok: true; output: ReturnType<typeof observe> }
  | { ok: false; error: { code: string; message: string } };

/** replay scenario จากบริษัทว่าง — คืนผลทีละขั้น (ขั้นที่ถูกปฏิเสธไม่เปลี่ยน state) */
export function runScenario(scenario: Scenario): ScenarioStepResult[] {
  const base = emptyData();
  let state: AccountingData = { ...base, company: { ...base.company, ...scenario.company } };
  const ctx: ReplayContext = { statementRefs: new Map(), nextRef: 1 };
  return scenario.steps.map((step, i) => {
    try {
      const next = apply(state, step, `${scenario.name}-${i + 1}`, ctx);
      const output = observe(state, next.state, ctx, next.result);
      ({ state } = next);
      return { ok: true, output };
    } catch (error) {
      if (!(error instanceof BusinessRuleError)) throw error;
      return { ok: false, error: { code: errorCodeOf(error.message), message: error.message } };
    }
  });
}

// ---------------- scenarios ----------------

export const VAT_CO: ScenarioCompany = {
  name: 'บริษัท สาธิต แมนูแฟคเจอริ่ง จำกัด',
  taxId: '0105562077778',
  branchNo: '00000',
  vatRegistered: true,
  address: { addressNo: '918/288', province: 'สมุทรปราการ', postalCode: '10290' },
};

export const NON_VAT_CO: ScenarioCompany = {
  name: 'ร้าน สมใจการค้า',
  taxId: '3100500123456',
  branchNo: '00000',
  vatRegistered: false,
  address: { addressNo: '12', province: 'นนทบุรี', postalCode: '11000' },
};

export const CUSTOMER: ScenarioContact = {
  code: 'C001',
  kind: 'customer',
  legalForm: 'juristic',
  title: 'บริษัท',
  name: 'เอบีซี ออโต้พาร์ท จำกัด',
  taxId: '0105565012341',
  branchNo: '0',
  address: { addressNo: '99', street: 'บางนา-ตราด', province: 'กรุงเทพมหานคร', postalCode: '10260' },
  email: 'ap@abc.example',
  creditDays: 30,
};

export const PERSON: ScenarioContact = {
  code: 'C002',
  kind: 'both',
  legalForm: 'individual',
  title: 'นาย',
  name: 'สมชาย',
  lastName: 'ใจดี',
  taxId: '3-1099-00123-45-3',
  address: { addressNo: '12/3', province: 'นนทบุรี' },
  creditDays: 0,
};

export const VENDOR: ScenarioContact = {
  code: 'V001',
  kind: 'vendor',
  legalForm: 'juristic',
  title: 'บริษัท',
  name: 'ไทยเม็ดพลาสติก จำกัด',
  taxId: '0105555123409',
  branchNo: '00000',
  address: { addressNo: '77', province: 'ระยอง' },
  creditDays: 30,
};

export const L = (qty: number, unitPrice: number, accountCode = '4100', discount = 0, description = 'สินค้า'): ScenarioLine => ({
  description,
  qty,
  unitPrice,
  discount,
  accountCode,
});

export const S = (qty: number, unitPrice: number, description = 'ค่าบริการ'): ScenarioLine => L(qty, unitPrice, '4200', 0, description);

export const contact = (c: ScenarioContact): ScenarioStep => ({ action: 'saveContact', input: c });

export const invoice = (
  date: string,
  lines: ScenarioLine[],
  vatMode: VatMode = 'exclusive',
  extra: { contact?: string; dueDate?: string; saleType?: SaleType; note?: string } = {}
): ScenarioStep => ({
  action: 'issueTaxInvoice',
  input: {
    date,
    dueDate: extra.dueDate ?? date,
    contact: extra.contact ?? 'C001',
    lines,
    vatMode,
    ...(extra.saleType ? { saleType: extra.saleType } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  },
});

export const receive = (inv: string, date: string, amount: number, whtAmount = 0, depositAccountCode = '1120'): ScenarioStep => ({
  action: 'receivePayment',
  input: { invoice: inv, date, amount, whtAmount, depositAccountCode },
});

export const credit = (inv: string, date: string, lines: ScenarioLine[], reason = 'ลดราคา'): ScenarioStep => ({
  action: 'issueCreditNote',
  input: { invoice: inv, date, reason, lines },
});

export const debit = (inv: string, date: string, lines: ScenarioLine[], reason = 'เพิ่มราคา'): ScenarioStep => ({
  action: 'issueDebitNote',
  input: { invoice: inv, date, reason, lines },
});

export const refund = (date: string, amount: number, contactCode = 'C001', accountCode = '1120', note?: string): ScenarioStep => ({
  action: 'refundCustomerCredit',
  input: { contact: contactCode, date, amount, accountCode, ...(note ? { note } : {}) },
});

export const etax = (docs: string[], status: ETaxStatus, at?: string, reference?: string): ScenarioStep => ({
  action: 'setETaxStatus',
  input: { docs, etax: status, ...(at ? { at } : {}), ...(reference ? { reference } : {}) },
});

export const lock = (through: string, today = '2026-10-24'): ScenarioStep => ({ action: 'lockPeriod', input: { through, today } });

export const SALES_SCENARIOS: Scenario[] = [
  {
    name: 'goods-exclusive-full-payment-etax',
    description: 'ใบกำกับภาษีสินค้า VAT แยก 2 บัญชีรายได้ → รับชำระเต็ม (หัก 3%) → e-Tax ลงนาม/นำส่ง และการเปลี่ยนสถานะที่ไม่อนุญาต',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      invoice('2026-10-01', [L(10, 1250), L(1, 500, '4900', 50, 'ค่าขนส่ง')], 'exclusive', { dueDate: '2026-10-31', note: 'ชำระภายใน 30 วัน' }),
      invoice('2026-10-02', [L(3, 333.33)]),
      etax(['IV6910-0001'], 'uploaded', '2026-10-03T02:00:00.000Z'),
      etax(['IV6910-0001'], 'signed'),
      etax(['IV6910-0001', 'IV6910-0002'], 'signed'),
      etax(['IV6910-0001'], 'pending-sign'),
      etax(['IV6910-0001'], 'not-required'),
      etax(['IV6910-0099'], 'signed'),
      etax(['IV6910-0001'], 'uploaded', '2026-10-03T02:00:00.000Z', ' RD-REF-001 '),
      etax(['IV6910-0001'], 'uploaded', '2026-10-04T02:00:00.000Z', 'RD-REF-002'),
      receive('IV6910-0001', '2026-10-15', 13_856.5, 388.5),
      receive('IV6910-0001', '2026-10-16', 0.01),
      receive('IV6910-0002', '2026-10-16', 1069.99, 0, '1110'),
    ],
  },
  {
    name: 'goods-inclusive-partial-receipts',
    description: 'ใบกำกับราคารวม VAT (เศษปัด) → รับชำระบางส่วนหลายครั้ง, หัก ณ ที่จ่ายเกินเพดาน/เท่ายอด/บัญชีไม่ใช่เงินสด ถูกปฏิเสธ',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      invoice('2026-09-05', [L(3, 33.33), L(7, 99.99, '4100', 0.5), L(1, 1000, '4200', 0, 'ค่าติดตั้ง')], 'inclusive'),
      receive('IV6909-0001', '2026-09-10', 500, 30),
      receive('IV6909-0001', '2026-09-10', 500, 11.69),
      receive('IV6909-0001', '2026-09-10', 500, 500),
      receive('IV6909-0001', '2026-09-10', 0),
      receive('IV6909-0001', '2026-09-10', 500, 0, '4100'),
      receive('IV6909-0001', '2026-09-10', 500, 0, '1130'),
      receive('IV6909-0001', '2026-09-04', 500),
      receive('IV6909-0001', '2026-09-10', 500, 11.68),
      receive('IV6909-0001', '2026-10-01', 2000),
      receive('IV6909-0001', '2026-10-01', 799.42),
      receive('IV6909-0001', '2026-10-02', 0.01),
    ],
  },
  {
    name: 'goods-vat-none-and-person',
    description: 'บริษัทจด VAT ออกใบกำกับ VAT none (ไม่ต้อง e-Tax) ให้บุคคลธรรมดา + ใบกำกับปกติให้ลูกค้า kind both',
    company: VAT_CO,
    steps: [
      contact(PERSON),
      invoice('2026-10-05', [L(2, 150.25)], 'none', { contact: 'C002' }),
      etax(['IV6910-0001'], 'signed'),
      invoice('2026-10-05', [L(1, 99.995)], 'exclusive', { contact: 'C002' }),
      receive('IV6910-0001', '2026-10-06', 300.5, 9.01, '1110'),
      receive('IV6910-0002', '2026-10-06', 107),
    ],
  },
  {
    name: 'non-vat-company-bl-cm-dm',
    description: 'บริษัทไม่จด VAT: ใบแจ้งหนี้ BL (vatMode ที่ส่งมาถูกบังคับเป็น none), ใบลดหนี้ CM, ใบเพิ่มหนี้ DM, รับเงิน RE, คืนเงิน RF',
    company: NON_VAT_CO,
    steps: [
      contact(CUSTOMER),
      invoice('2026-08-10', [L(4, 2500)], 'exclusive'),
      debit('BL6908-0001', '2026-08-12', [L(1, 800, '4100', 0, 'ค่าส่งเพิ่ม')]),
      etax(['BL6908-0001'], 'signed'),
      receive('BL6908-0001', '2026-08-20', 10_800),
      credit('BL6908-0001', '2026-08-25', [L(1, 1800, '4100', 0, 'สินค้าชำรุด')], 'สินค้าชำรุด'),
      refund('2026-08-26', 1000),
      refund('2026-08-27', 800.01),
      refund('2026-08-27', 800, 'C001', '1110', 'คืนเงินสด'),
      invoice('2026-08-28', [S(1, 3000)], 'inclusive', { saleType: 'service' }),
      credit('BL6908-0002', '2026-08-29', [S(1, 3000)], 'ยกเลิกงาน'),
      receive('BL6908-0002', '2026-08-30', 1),
    ],
  },
  {
    name: 'service-partial-receipts-across-months',
    description: 'งานบริการ ม.78/1: ใบแจ้งหนี้ BL (VAT พัก 2151) → รับเงิน 3 เดือน ออก RT ทุกครั้ง ย้าย VAT ตามสัดส่วน + หัก 3% → e-Tax ของ RT',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      invoice('2026-08-20', [S(1, 10_000), S(3, 333.33, 'ค่าที่ปรึกษา')], 'exclusive', { saleType: 'service', dueDate: '2026-09-20' }),
      etax(['BL6908-0001'], 'signed'),
      receive('BL6908-0001', '2026-08-31', 3_000, 84.11),
      receive('BL6908-0001', '2026-09-15', 4_000.4, 112.15),
      etax(['RT6908-0001', 'RT6909-0001'], 'signed'),
      etax(['RT6908-0001'], 'uploaded', '2026-09-16T09:30:00.000Z', 'ETAX-0001'),
      receive('BL6908-0001', '2026-10-01', 4_769.59),
      debit('BL6908-0001', '2026-10-02', [S(1, 100)]),
    ],
  },
  {
    name: 'service-credit-before-full-payment',
    description: 'งานบริการ: ลดหนี้ก่อนรับครบ = CM กลับ VAT จาก 2151 (ใบที่ปิดยอดรับเศษปัด) — เกินยอดค้างถูกปฏิเสธ',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      invoice('2026-09-01', [S(3, 1111.11)], 'inclusive', { saleType: 'service' }),
      receive('BL6909-0001', '2026-09-10', 1_000),
      credit('BL6909-0001', '2026-09-11', [S(1, 2_400)]),
      credit('BL6909-0001', '2026-09-11', [S(1, 1_000)]),
      credit('BL6909-0001', '2026-09-12', [S(1, 1_333.33)], 'ปิดยอดงานที่ไม่ได้ทำ'),
      credit('BL6909-0001', '2026-09-13', [S(1, 1)]),
      receive('BL6909-0001', '2026-09-13', 1),
    ],
  },
  {
    name: 'service-credit-after-full-payment',
    description: 'งานบริการรับครบแล้ว: CN (ใบลดหนี้/ใบกำกับภาษี) อ้าง RT ใบล่าสุด ยอดทั้งใบเข้าเงินรอคืน 2120 → คืนเงิน',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      invoice('2026-09-01', [S(1, 5_000)], 'exclusive', { saleType: 'service' }),
      receive('BL6909-0001', '2026-09-05', 2_675, 75),
      receive('BL6909-0001', '2026-09-20', 2_675),
      credit('BL6909-0001', '2026-09-21', [S(1, 6_000)]),
      credit('BL6909-0001', '2026-09-21', [S(1, 1_000)], 'ส่วนลดหลังการขาย'),
      etax(['CN6909-0001'], 'signed'),
      refund('2026-09-20', 500),
      refund('2026-09-22', 1_070.01),
      refund('2026-09-22', 1_070),
      refund('2026-09-23', 1),
    ],
  },
  {
    name: 'credit-note-before-payment-cancels',
    description: 'ใบลดหนี้ก่อนรับเงิน: ลดบางส่วน → ลดส่วนที่เหลือทั้งหมด = ใบกำกับถูกยกเลิก → รับเงิน/เพิ่มหนี้ถูกปฏิเสธ',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      invoice('2026-10-01', [L(10, 100)]),
      credit('IV6910-0001', '2026-10-02', [L(2, 100)]),
      credit('IV6910-0001', '2026-10-03', [L(9, 100)]),
      credit('IV6910-0001', '2026-10-03', [L(8, 100)], ' '),
      credit('IV6910-0001', '2026-09-30', [L(8, 100)]),
      credit('IV6910-0001', '2026-10-03', [L(8, 100)]),
      receive('IV6910-0001', '2026-10-04', 1),
      debit('IV6910-0001', '2026-10-04', [L(1, 100)]),
      credit('IV6910-0001', '2026-10-04', [L(1, 1)]),
      etax(['CN6910-0001', 'CN6910-0002'], 'signed'),
    ],
  },
  {
    name: 'credit-note-after-payment-excess-to-2120',
    description: 'ใบลดหนี้หลังรับเงิน (มีหัก ณ ที่จ่าย): ส่วนที่เกินยอดค้างเข้า 2120 → คืนเงินบางส่วน, คืนเกิน/ก่อนวันใบลดหนี้ถูกปฏิเสธ',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      contact(VENDOR),
      invoice('2026-10-01', [L(1, 20_000)]),
      receive('IV6910-0001', '2026-10-05', 15_000, 420.56),
      credit('IV6910-0001', '2026-10-04', [L(1, 1_000)]),
      credit('IV6910-0001', '2026-10-06', [L(1, 8_000)], 'คืนสินค้า'),
      receive('IV6910-0001', '2026-10-07', 1),
      refund('2026-10-05', 100),
      refund('2026-10-07', 100, 'V001'),
      refund('2026-10-07', 100, 'X999'),
      refund('2026-10-07', 2_000, 'C001', '1111'),
      refund('2026-10-07', 1_000),
      refund('2026-10-06', 100),
      refund('2026-10-08', 2_000),
      credit('IV6910-0001', '2026-10-09', [L(1, 12_000.01)]),
      credit('IV6910-0001', '2026-10-09', [L(1, 12_000)]),
      refund('2026-10-10', 12_840),
    ],
  },
  {
    name: 'debit-note-then-credit-ceiling',
    description: 'ใบเพิ่มหนี้ DN รวมเข้ายอดค้างของใบเดิม → รับชำระรวม DN → ใบลดหนี้ลดได้ถึงเพดานใบเดิม + DN (ม.86/10)',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      invoice('2026-10-01', [L(1, 1_000)], 'inclusive'),
      debit('IV6910-0001', '2026-09-30', [L(1, 100)]),
      debit('IV6910-0001', '2026-10-02', [L(1, 100)], ''),
      debit('IV6910-0001', '2026-10-02', [L(1, 214)], 'ส่งสินค้าเพิ่ม'),
      etax(['DN6910-0001'], 'signed'),
      receive('IV6910-0001', '2026-10-03', 1_214),
      receive('IV6910-0001', '2026-10-03', 0.01),
      credit('IV6910-0001', '2026-10-04', [L(1, 1_214.01)]),
      credit('IV6910-0001', '2026-10-04', [L(1, 607)]),
      credit('IV6910-0001', '2026-10-04', [L(1, 607)]),
      debit('IV6910-0001', '2026-10-05', [L(1, 10)]),
    ],
  },
  {
    name: 'lock-period-effects',
    description: 'ปิดงวดถึง 30 ก.ย.: เอกสาร/รับเงิน/ลดหนี้/คืนเงินในงวดที่ปิดถูกปฏิเสธ, ปิดล่วงหน้า/ย้อนหลังไม่ได้, ลดหนี้ใบเดือนก่อนในงวดเปิดได้',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      invoice('2026-09-10', [L(1, 3_000)]),
      receive('IV6909-0001', '2026-09-20', 1_000),
      credit('IV6909-0001', '2026-09-25', [L(1, 2_000)]),
      lock('2026-10-31'),
      lock('2026-09-30'),
      invoice('2026-09-30', [L(1, 100)]),
      receive('IV6909-0001', '2026-09-30', 100),
      credit('IV6909-0001', '2026-09-30', [L(1, 100)]),
      debit('IV6909-0001', '2026-09-29', [L(1, 100)]),
      refund('2026-09-30', 100),
      lock('2026-08-31'),
      lock('2026-09-30'),
      receive('IV6909-0001', '2026-10-01', 100),
      credit('IV6909-0001', '2026-10-02', [L(1, 500)]),
      refund('2026-10-03', 535),
      refund('2026-10-03', 465, 'C001', '1110'),
      invoice('2026-10-01', [L(1, 100)]),
    ],
  },
  {
    name: 'date-order-and-validation',
    description: 'เลขที่เรียงตามวันที่ (IV/RE/CN/RF), วันที่ผิดรูปแบบ/พ.ศ., ครบกำหนดก่อนวันที่, บรรทัดผิด, ผู้ติดต่อ, ยอดศูนย์',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      contact(VENDOR),
      invoice('2026-10-15', [L(1, 1_000)]),
      invoice('2026-10-14', [L(1, 1_000)]),
      invoice('2569-10-15', [L(1, 1_000)]),
      invoice('2026-02-30', [L(1, 1_000)]),
      invoice('2026-10-15', [L(1, 1_000)], 'exclusive', { dueDate: '2026-10-14' }),
      invoice('2026-10-15', [L(1, 1_000)], 'exclusive', { dueDate: '' }),
      invoice('2026-10-15', []),
      invoice('2026-10-15', [L(1, 100), { ...L(1, 100), description: '  ' }]),
      invoice('2026-10-15', [L(0, 100)]),
      invoice('2026-10-15', [L(1, -1)]),
      invoice('2026-10-15', [L(1, 100, '4100', -1)]),
      invoice('2026-10-15', [L(2, 50, '4100', 100.01)]),
      invoice('2026-10-15', [L(1, 100, '9999')]),
      invoice('2026-10-15', [L(1, 100, '5100')]),
      invoice('2026-10-15', [L(1, 100, '2150')]),
      invoice('2026-10-15', [L(1, 100)], 'exclusive', { contact: 'V001' }),
      invoice('2026-10-15', [L(1, 100)], 'exclusive', { contact: 'X999' }),
      invoice('2026-10-15', [L(2, 50, '4100', 100)]),
      invoice('2026-10-15', [L(1, 0.004)], 'none'),
      invoice('2026-10-16', [L(1, 2_000)]),
      receive('IV6910-0002', '2026-10-20', 500),
      receive('IV6910-0001', '2026-10-19', 500),
      receive('IV6910-0001', '2026-10-14', 500),
      receive('RE6910-0001', '2026-10-21', 1),
      receive('IV6910-0001', '2026-10-21', 500),
      credit('IV6910-0001', '2026-10-20', [L(1, 100)]),
      credit('IV6910-0002', '2026-10-22', [L(1, 100)]),
      credit('IV6910-0001', '2026-10-21', [L(1, 100)]),
      credit('IV6910-0002', '2026-10-22', [L(1, 100, '5100')]),
      credit('IV6910-0002', '2026-10-22', []),
      credit('IV6910-0002', '2026-10-22', [L(1, 1_000)]),
      refund('2026-10-23', 100),
      refund('2026-10-22', 1),
      credit('IV6910-0001', '2026-10-24', [L(1, 600)]),
      refund('2026-10-24', 72),
      refund('2026-10-23', 1),
    ],
  },
  {
    name: 'contacts-and-snapshots',
    description: 'ผู้ติดต่อ: ชื่อว่าง/รหัสซ้ำถูกปฏิเสธ, แก้ข้อมูลแล้วเอกสารเดิมคง snapshot เดิม เอกสารใหม่ได้ข้อมูลใหม่',
    company: VAT_CO,
    steps: [
      contact({ ...CUSTOMER, name: '  ' }),
      contact(CUSTOMER),
      contact({ ...PERSON, code: 'C001' }),
      contact(PERSON),
      invoice('2026-10-01', [L(1, 100)]),
      { action: 'saveContact', input: { ...CUSTOMER, name: 'เอบีซี ออโต้พาร์ท (ประเทศไทย) จำกัด', branchNo: '00002', update: true } },
      { action: 'saveContact', input: { ...PERSON, code: 'C001', update: true } },
      invoice('2026-10-02', [L(1, 100)]),
      receive('IV6910-0001', '2026-10-03', 107),
      invoice('2026-10-03', [L(1, 100)], 'exclusive', { contact: 'C002' }),
    ],
  },
  {
    name: 'opening-balances-receivables',
    description: 'ยกยอด ณ 31 ส.ค.: GL + ลูกหนี้ค้างรับ (สินค้า, งานบริการ VAT รอตัด) + เจ้าหนี้ → รับเงิน RE/RT, ลด/เพิ่มหนี้ใบยกมาไม่ได้, ลงวันที่ก่อน/เท่าวันยกยอดไม่ได้',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      contact(PERSON),
      contact(VENDOR),
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-15',
          lines: [],
          vatCredit: 0,
          whtReceivable: 0,
          receivableControl: 0,
          payableControl: 0,
          receivables: [],
          payables: [],
        },
      },
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-31',
          lines: [
            { accountCode: '1120', description: 'เงินฝากธนาคาร', debit: 50_000, credit: 0 },
            { accountCode: '3100', description: 'ทุน', debit: 0, credit: 60_000 },
          ],
          vatCredit: 1_000,
          whtReceivable: 500,
          receivableControl: 11_000,
          payableControl: 3_500,
          receivables: [
            { contact: 'C001', docNo: 'EX-IV001', date: '2026-08-20', dueDate: '2026-09-20', amount: 10_700 },
            { contact: 'C002', docNo: 'EX-SV001', date: '2026-08-25', dueDate: '2026-09-25', amount: 1_300, serviceVat: 85.05 },
          ],
          payables: [{ contact: 'V001', docNo: 'EX-PI001', date: '2026-08-28', amount: 3_500 }],
        },
      },
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-31',
          lines: [
            { accountCode: '1120', description: 'เงินฝากธนาคาร', debit: 50_000, credit: 0 },
            { accountCode: '3100', description: 'ทุน', debit: 0, credit: 60_000 },
          ],
          vatCredit: 1_000,
          whtReceivable: 500,
          receivableControl: 12_000,
          payableControl: 3_500,
          receivables: [
            { contact: 'C001', docNo: 'EX-IV001', date: '2026-08-20', dueDate: '2026-09-20', amount: 10_700 },
            { contact: 'C002', docNo: 'EX-SV001', date: '2026-08-25', dueDate: '2026-09-25', amount: 1_300, serviceVat: 85.05 },
          ],
          payables: [{ contact: 'V001', docNo: 'EX-PI001', date: '2026-08-28', amount: 3_500, vatAmount: 228.97, whtIncomeType: 'ค่าบริการ', whtRate: 3 }],
        },
      },
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-31',
          lines: [
            { accountCode: '1120', description: 'เงินฝากธนาคาร', debit: 50_000, credit: 0 },
            { accountCode: '3100', description: 'ทุน', debit: 0, credit: 59_914.95 },
          ],
          vatCredit: 1_000,
          whtReceivable: 500,
          receivableControl: 12_000,
          payableControl: 3_500,
          receivables: [
            { contact: 'C001', docNo: 'EX-IV001', date: '2026-08-20', dueDate: '2026-09-20', amount: 10_700 },
            { contact: 'C002', docNo: 'EX-SV001', date: '2026-08-25', dueDate: '2026-09-25', amount: 1_300, serviceVat: 85.05 },
          ],
          payables: [{ contact: 'V001', docNo: 'EX-PI001', date: '2026-08-28', amount: 3_500, vatAmount: 228.97, whtIncomeType: 'ค่าบริการ', whtRate: 3 }],
        },
      },
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-31',
          lines: [
            { accountCode: '1120', description: 'เงินฝากธนาคาร', debit: 40_000, credit: 0 },
            { accountCode: '3100', description: 'ทุน', debit: 0, credit: 49_914.95 },
          ],
          vatCredit: 1_000,
          whtReceivable: 500,
          receivableControl: 12_000,
          payableControl: 3_500,
          receivables: [
            { contact: 'C001', docNo: 'EX-IV001', date: '2026-08-20', dueDate: '2026-09-20', amount: 10_700 },
            { contact: 'C002', docNo: 'EX-SV001', date: '2026-08-25', dueDate: '2026-09-25', amount: 1_300, serviceVat: 85.05 },
          ],
          payables: [{ contact: 'V001', docNo: 'EX-PI001', date: '2026-08-28', amount: 3_500, vatAmount: 228.97, whtIncomeType: 'ค่าบริการ', whtRate: 3 }],
        },
      },
      invoice('2026-08-31', [L(1, 100)]),
      receive('EX-IV001', '2026-09-05', 5_000, 0),
      receive('EX-SV001', '2026-09-06', 650),
      credit('EX-IV001', '2026-09-07', [L(1, 100)]),
      debit('EX-IV001', '2026-09-07', [L(1, 100)]),
      invoice('2026-09-01', [S(1, 1_000)], 'exclusive', { saleType: 'service', contact: 'C002' }),
      receive('EX-SV001', '2026-09-08', 650),
      receive('EX-IV001', '2026-09-08', 5_700, 0, '1110'),
      {
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
      },
    ],
  },
  {
    name: 'opening-validation',
    description: 'ยกยอด: บัญชีคุมในบรรทัด, ยอดคุมไม่ตรง, เลขที่ชนรูปแบบระบบ, เลขซ้ำ, ผู้ติดต่อผิดประเภท, VAT รอตัดไม่ตรง, ไม่จด VAT มี VAT รอตัด',
    company: VAT_CO,
    steps: [
      contact(CUSTOMER),
      contact(VENDOR),
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-31',
          lines: [{ accountCode: '1130', description: 'ลูกหนี้', debit: 100, credit: 0 }],
          vatCredit: 0,
          whtReceivable: 0,
          receivableControl: 0,
          payableControl: 0,
          receivables: [],
          payables: [],
        },
      },
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-31',
          lines: [{ accountCode: '3100', debit: 0, credit: 1_000 }],
          vatCredit: 0,
          whtReceivable: 0,
          receivableControl: 900,
          payableControl: 0,
          receivables: [{ contact: 'C001', docNo: 'EX-1', date: '2026-08-01', dueDate: '2026-08-31', amount: 1_000 }],
          payables: [],
        },
      },
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-31',
          lines: [{ accountCode: '3100', debit: 0, credit: 1_000 }],
          vatCredit: 0,
          whtReceivable: 0,
          receivableControl: 1_000,
          payableControl: 0,
          receivables: [{ contact: 'C001', docNo: 'IV6909-0001', date: '2026-08-01', dueDate: '2026-08-31', amount: 1_000 }],
          payables: [],
        },
      },
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-31',
          lines: [{ accountCode: '3100', debit: 0, credit: 1_000 }],
          vatCredit: 0,
          whtReceivable: 0,
          receivableControl: 1_000,
          payableControl: 0,
          receivables: [
            { contact: 'C001', docNo: 'iv6908-0001', date: '2026-08-01', dueDate: '2026-08-31', amount: 500 },
            { contact: 'C001', docNo: 'IV6908-0001 ', date: '2026-08-01', dueDate: '2026-08-31', amount: 500 },
          ],
          payables: [],
        },
      },
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-31',
          lines: [{ accountCode: '3100', debit: 0, credit: 1_000 }],
          vatCredit: 0,
          whtReceivable: 0,
          receivableControl: 1_000,
          payableControl: 0,
          receivables: [{ contact: 'V001', docNo: 'EX-1', date: '2026-08-01', dueDate: '2026-08-31', amount: 1_000 }],
          payables: [],
        },
      },
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-31',
          lines: [{ accountCode: '3100', debit: 0, credit: 1_000 }],
          vatCredit: 0,
          whtReceivable: 0,
          receivableControl: 1_000,
          payableControl: 0,
          receivables: [{ contact: 'C001', docNo: 'EX-1', date: '2026-08-01', dueDate: '2026-08-31', amount: 1_000, serviceVat: 70 }],
          payables: [],
        },
      },
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-31',
          lines: [{ accountCode: '3100', debit: 0, credit: 1_000 }],
          vatCredit: 0,
          whtReceivable: 0,
          receivableControl: 1_000,
          payableControl: 0,
          receivables: [{ contact: 'C001', docNo: 'EX-1', date: '2026-09-01', dueDate: '2026-09-30', amount: 1_000 }],
          payables: [],
        },
      },
      {
        action: 'setOpeningBalances',
        input: {
          date: '2026-08-31',
          lines: [{ accountCode: '3100', debit: 0, credit: 1_000 }],
          vatCredit: 0,
          whtReceivable: 0,
          receivableControl: 1_070,
          payableControl: 0,
          receivables: [{ contact: 'C001', docNo: 'EX-1', date: '2026-08-01', dueDate: '2026-08-31', amount: 1_070, serviceVat: 70 }],
          payables: [],
        },
      },
      receive('EX-1', '2026-09-01', 1_070, 30),
    ],
  },
];
