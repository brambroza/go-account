import { outstandingOf } from './receivables';
import { calcDocument } from './document-calc';
import { sumBaht, subBaht, toSatang, prorateBaht } from './money';
import { isTaxDocument, isDeferredVatDoc, isServiceInvoice } from './sales-doc';

import type { Receipt, SalesDoc, DocTotals, AccountingData } from './types';

// ----------------------------------------------------------------------
// งานบริการ (ม.78/1) — ภาษีขายเกิดเมื่อได้รับชำระ
//
// - ออกใบแจ้งหนี้ (ไม่ใช่ใบกำกับภาษี): Dr ลูกหนี้ / Cr รายได้ / Cr 2151 ภาษีขายยังไม่ถึงกำหนด
// - รับเงินแต่ละครั้ง: ออกใบเสร็จรับเงิน/ใบกำกับภาษี (RT) ของส่วนที่รับ — ย้าย VAT ตามสัดส่วนจาก 2151 เข้า 2150
//   ในเดือนที่รับเงิน (ครั้งที่รับครบรับเศษที่เหลือทั้งหมด → 2151 ของใบนั้นเป็นศูนย์)
// - ใบลดหนี้ (กติกาที่เลือก — ง่ายและถูกต้อง):
//   ยังมียอดค้างรับ → ใบลดหนี้ธรรมดา (CM, ไม่ใช่เอกสารภาษี) ลดได้ไม่เกินยอดค้าง กลับ VAT จาก 2151
//     (ส่วนที่รับเงินแล้วออกใบกำกับภาษีไปแล้ว จึงลดด้วยใบนี้ไม่ได้) — ใบที่ปิดยอดค้างทั้งหมดรับเศษปัด VAT
//   รับเงินครบแล้ว → ใบลดหนี้/ใบกำกับภาษี (CN ม.86/10) อ้างใบเสร็จรับเงิน/ใบกำกับภาษีใบล่าสุด ลดภาษีขาย 2150
//     ในเดือนที่ออก ยอดทั้งหมดตั้งเป็นเงินรอคืนลูกค้า (VAT/มูลค่าที่ลดรวมไม่เกินที่ออกใบกำกับไปแล้ว)
// - ใบเพิ่มหนี้ของงานบริการ: ไม่รองรับ — ออกใบแจ้งหนี้ใหม่สำหรับค่าบริการที่เพิ่ม
// ----------------------------------------------------------------------

type ServiceState = Pick<AccountingData, 'sales' | 'receipts'>;

export function receiptsOf(state: Pick<AccountingData, 'receipts'>, invoiceId: string): Receipt[] {
  return state.receipts.filter((r) => r.invoiceId === invoiceId);
}

/** ใบลดหนี้ของใบแจ้งหนี้งานบริการที่กลับ VAT จาก 2151 (ก่อนรับเงินครบ) */
function deferredCreditsOf(state: Pick<AccountingData, 'sales'>, invoiceId: string): SalesDoc[] {
  return state.sales.filter((s) => s.kind === 'credit-note' && s.refDocId === invoiceId && isDeferredVatDoc(s));
}

/** ใบลดหนี้/ใบกำกับภาษีที่อ้างใบเสร็จรับเงิน/ใบกำกับภาษีของใบแจ้งหนี้นี้ (หลังรับเงินครบ) */
function taxCreditsOf(state: Pick<AccountingData, 'sales'>, invoiceId: string): SalesDoc[] {
  return state.sales.filter((s) => s.kind === 'credit-note' && s.refDocId === invoiceId && isTaxDocument(s));
}

/** VAT ที่ใบลดหนี้ใบนี้กลับจาก 2151 (VAT ตามเอกสาร + เศษปัดของใบที่ปิดยอด) */
export function deferredVatOfCredit(doc: SalesDoc): number {
  if (!isDeferredVatDoc(doc) || doc.kind !== 'credit-note') return 0;
  return sumBaht([calcDocument(doc).vat, doc.deferredVatRounding ?? 0]);
}

/** ภาษีขายรอตัด (2151) คงเหลือของใบแจ้งหนี้งานบริการ = VAT ใบแจ้งหนี้ − ใบลดหนี้ก่อนรับครบ − VAT ที่ออกใบกำกับแล้ว */
export function deferredVatOf(state: ServiceState, invoice: SalesDoc): number {
  if (!isServiceInvoice(invoice)) return 0;
  const credited = deferredCreditsOf(state, invoice.id).map(deferredVatOfCredit);
  const recognized = receiptsOf(state, invoice.id).map((r) => r.vat ?? 0);
  return subBaht(calcDocument(invoice).vat, sumBaht([...credited, ...recognized]));
}

/**
 * ภาษีขายของการรับเงินครั้งนี้ (งานบริการ) = ภาษีรอตัดคงเหลือ × ยอดรับ ÷ ยอดค้าง (half-up)
 * ครั้งที่รับครบรับภาษีรอตัดที่เหลือทั้งหมด — ไม่ใช่งานบริการคืน 0
 */
export function receiptVatOf(state: ServiceState, invoice: SalesDoc, amount: number): number {
  if (!isServiceInvoice(invoice)) return 0;
  const deferred = deferredVatOf(state, invoice);
  const outstanding = outstandingOf(state, invoice);
  if (toSatang(amount) >= toSatang(outstanding)) return deferred;
  return Math.min(prorateBaht(deferred, amount, outstanding), deferred);
}

/** ภาษีขาย/มูลค่าที่ออกใบเสร็จรับเงิน/ใบกำกับภาษีไปแล้ว หักใบลดหนี้/ใบกำกับภาษีที่อ้างถึง — เพดานของใบลดหนี้หลังรับครบ */
export function taxedPartsOf(state: ServiceState, invoice: SalesDoc): { net: number; vat: number } {
  const receipts = receiptsOf(state, invoice.id).filter((r) => r.isTaxInvoice);
  const credits = taxCreditsOf(state, invoice.id).map((c) => calcDocument(c));
  return {
    vat: subBaht(sumBaht(receipts.map((r) => r.vat ?? 0)), sumBaht(credits.map((c) => c.vat))),
    net: subBaht(sumBaht(receipts.map((r) => subBaht(r.amount, r.vat ?? 0))), sumBaht(credits.map((c) => c.net))),
  };
}

/** ใบเสร็จรับเงิน/ใบกำกับภาษีใบล่าสุด (ตามวันที่/เลขที่) ของใบแจ้งหนี้ */
export function lastTaxReceiptOf(state: Pick<AccountingData, 'receipts'>, invoiceId: string): Receipt | undefined {
  return receiptsOf(state, invoiceId)
    .filter((r) => r.isTaxInvoice)
    .sort((a, b) => (a.date + a.docNo).localeCompare(b.date + b.docNo))
    .pop();
}

export type ServiceCreditPlan = {
  /** deferred = ใบลดหนี้ธรรมดากลับ VAT จาก 2151, tax = ใบลดหนี้/ใบกำกับภาษีอ้างใบเสร็จ/ใบกำกับภาษี */
  mode: 'deferred' | 'tax';
  isTaxInvoice: boolean;
  refReceiptId?: string;
  /** ส่วนที่ตั้งเป็นเงินรอคืนลูกค้า (หลังรับครบ = ทั้งใบ) */
  creditToCustomer: number;
  /** เศษปัด VAT ของใบที่ปิดยอดค้างทั้งหมด (โหมด deferred) */
  deferredVatRounding: number;
  /** เพดานยอดลดหนี้ (รวม VAT) ของโหมดนี้ */
  limit: number;
  /** ข้อความปัญหา (ออกไม่ได้) หรือ null */
  problem: string | null;
};

/**
 * แผนใบลดหนี้ของใบแจ้งหนี้งานบริการ — ใช้ทั้ง action และหน้าจอ (คืน null ถ้าไม่ใช่งานบริการที่คิด VAT)
 * `credit` = ยอดของใบลดหนี้ที่กำลังจะออก (`calcDocument`)
 */
export function serviceCreditNotePlan(
  state: ServiceState,
  invoice: SalesDoc,
  credit: Pick<DocTotals, 'net' | 'vat' | 'total'>
): ServiceCreditPlan | null {
  if (!isServiceInvoice(invoice)) return null;
  const outstanding = outstandingOf(state, invoice);
  if (toSatang(outstanding) > 0) {
    const deferred = deferredVatOf(state, invoice);
    const settles = toSatang(credit.total) === toSatang(outstanding);
    const rounding = settles ? subBaht(deferred, credit.vat) : 0;
    let problem: string | null = null;
    if (toSatang(credit.total) > toSatang(outstanding)) {
      problem = `งานบริการที่ยังรับเงินไม่ครบ ลดหนี้ได้ไม่เกินยอดค้างรับ ${outstanding.toFixed(2)} บาท — ส่วนที่รับเงินแล้วออกใบกำกับภาษีไปแล้ว ลดได้หลังรับเงินครบ (ใบลดหนี้อ้างใบเสร็จรับเงิน/ใบกำกับภาษี)`;
    } else if (!settles && toSatang(credit.vat) > toSatang(deferred)) {
      problem = `ภาษีของใบลดหนี้ ${credit.vat.toFixed(2)} เกินภาษีขายรอตัดคงเหลือ ${deferred.toFixed(2)} บาท`;
    } else if (Math.abs(toSatang(rounding)) >= 100) {
      problem = `ภาษีของใบลดหนี้ต่างจากภาษีขายรอตัดคงเหลือ ${deferred.toFixed(2)} บาทเกินเศษปัด — ตรวจอัตรา/ยอดรายการ`;
    }
    return {
      mode: 'deferred',
      isTaxInvoice: false,
      creditToCustomer: 0,
      deferredVatRounding: rounding,
      limit: outstanding,
      problem,
    };
  }
  const receipt = lastTaxReceiptOf(state, invoice.id);
  const taxed = taxedPartsOf(state, invoice);
  let problem: string | null = null;
  if (!receipt) problem = `${invoice.docNo} ยังไม่มีใบเสร็จรับเงิน/ใบกำกับภาษี — ลดหนี้ไม่ได้`;
  else if (toSatang(credit.vat) > toSatang(taxed.vat)) {
    problem = `ภาษีที่ลด ${credit.vat.toFixed(2)} เกินภาษีขายที่ออกใบกำกับไปแล้ว ${taxed.vat.toFixed(2)} บาท`;
  } else if (toSatang(credit.net) > toSatang(taxed.net)) {
    problem = `มูลค่าที่ลด ${credit.net.toFixed(2)} เกินมูลค่าที่ออกใบกำกับไปแล้ว ${taxed.net.toFixed(2)} บาท`;
  }
  return {
    mode: 'tax',
    isTaxInvoice: true,
    refReceiptId: receipt?.id,
    creditToCustomer: credit.total,
    deferredVatRounding: 0,
    limit: sumBaht([taxed.net, taxed.vat]),
    problem,
  };
}
