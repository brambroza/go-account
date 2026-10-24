import { sumBaht } from './money';
import { bahtText } from './baht-text';
import { periodOf } from './thai-date';
import { parseDocNo } from './numbering';
import { whtPayeesForPeriod } from './wht';
import { whtDetailRows } from './rd-wht-file';
import { resolveParty, companySnapshot } from './snapshot';

import type { WhtForm } from './wht';
import type { ISODate, Payment, PurchaseDoc, WhtCondition, PartySnapshot, AccountingData, CompanySnapshot } from './types';

// ----------------------------------------------------------------------
// ข้อมูลสำหรับพิมพ์หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ของใบสำคัญจ่าย 1 ใบ
// ----------------------------------------------------------------------

export type WhtCertificate = {
  /** เลขที่หนังสือรับรอง เช่น WT6910-0004 */
  certNo: string;
  /** เล่มที่ = prefix + งวด (WT6910), เลขที่ในเล่ม = 0004 */
  bookNo: string;
  seqInBook: string;
  /** วันที่ออกหนังสือรับรอง = วันที่จ่าย */
  date: ISODate;
  form: WhtForm;
  /** ลำดับที่ของผู้ถูกหักในแบบ ภ.ง.ด. ของเดือนนั้น (แถว D แรกของใบสำคัญจ่ายนี้) */
  sequence?: number;
  payer: CompanySnapshot;
  payee: PartySnapshot;
  items: { incomeType: string; rate: number; paidDate: ISODate; base: number; tax: number }[];
  totalBase: number;
  totalTax: number;
  /** ภาษีที่หักนำส่งเป็นตัวอักษร */
  totalTaxText: string;
  condition: WhtCondition;
  paymentDocNo: string;
  purchaseDocNo: string;
};

/**
 * สร้างข้อมูล 50 ทวิ ของใบสำคัญจ่าย — คืน null ถ้าไม่มีหัก ณ ที่จ่าย / ไม่พบเอกสาร
 * ผู้จ่าย/ผู้รับเงินอ่านจาก snapshot ในใบสำคัญจ่าย (ข้อมูล ณ วันที่จ่าย)
 */
export function whtCertificateOf(data: AccountingData, paymentId: string): WhtCertificate | null {
  const payment: Payment | undefined = data.payments.find((p) => p.id === paymentId);
  if (!payment || !payment.whtCertNo || !payment.whtItems.length) return null;
  const purchase: PurchaseDoc | undefined = data.purchases.find((p) => p.id === payment.purchaseId);
  const payee = payment.payee ?? resolveParty(purchase?.supplier, data.contacts.find((c) => c.id === payment.contactId));
  if (!payee) return null;
  const form: WhtForm = payee.legalForm === 'individual' ? 'PND3' : 'PND53';
  const rows = whtDetailRows(whtPayeesForPeriod(data, periodOf(payment.date), form));
  const parsed = parseDocNo(payment.whtCertNo);
  const totalTax = sumBaht(payment.whtItems.map((i) => i.tax));
  return {
    certNo: payment.whtCertNo,
    bookNo: parsed ? `${parsed.prefix}${parsed.period}` : '',
    seqInBook: parsed ? String(parsed.seq).padStart(4, '0') : payment.whtCertNo,
    date: payment.date,
    form,
    sequence: rows.find((r) => r.items.some((i) => i.paymentId === payment.id))?.seq,
    payer: payment.payer ?? companySnapshot(data.company),
    payee,
    items: payment.whtItems.map((i) => ({ ...i, paidDate: payment.date })),
    totalBase: sumBaht(payment.whtItems.map((i) => i.base)),
    totalTax,
    totalTaxText: bahtText(totalTax),
    condition: purchase?.whtCondition ?? '1',
    paymentDocNo: payment.docNo,
    purchaseDocNo: purchase?.docNo ?? '',
  };
}
