import { inPeriod } from './thai-date';
import { resolveParty } from './snapshot';
import { round2, sumBaht, percentOf, prorateBaht } from './money';

import type { Period } from './thai-date';
import type { Contact, DocTotals, WhtCondition, AccountingData } from './types';

// ----------------------------------------------------------------------

/** ประเภทเงินได้ที่พบบ่อยและอัตราหักตามปกติ (ผู้ใช้แก้อัตราเองได้ในเอกสาร) */
export const WHT_INCOME_TYPES: { label: string; rate: number }[] = [
  { label: 'ค่าบริการ', rate: 3 },
  { label: 'ค่าจ้างทำของ', rate: 3 },
  { label: 'ค่าวิชาชีพอิสระ', rate: 3 },
  { label: 'ค่าเช่า', rate: 5 },
  { label: 'ค่าขนส่ง', rate: 1 },
  { label: 'ค่าโฆษณา', rate: 2 },
  { label: 'ค่ารางวัล / ส่งเสริมการขาย', rate: 3 },
];

/**
 * อัตราสูงสุดที่ลูกค้าหัก ณ ที่จ่ายเราได้ตอนรับชำระ = อัตราสูงสุดในตารางประเภทเงินได้ (ค่าเช่า 5%)
 * ใช้กับฐานมูลค่าก่อน VAT ตามสัดส่วนยอดที่รับ (`receiptWhtAmount`) — กันกรอก WHT เกินจริง เช่น 50% ของยอด
 */
export const RECEIPT_WHT_MAX_RATE = Math.max(...WHT_INCOME_TYPES.map((w) => w.rate));

/** อัตราหัก ณ ที่จ่ายสูงสุดที่บันทึกในเอกสารซื้อได้ (อัตราสูงสุดตามกฎหมายสำหรับผู้มีถิ่นที่อยู่ในไทย = 15%) */
export const PURCHASE_WHT_MAX_RATE = 15;

export type WhtForm = 'PND3' | 'PND53';

export type WhtItem = {
  /** ใบสำคัญจ่าย (PV) ของการจ่ายครั้งนี้ */
  paymentId: string;
  purchaseId: string;
  /** เลขที่ใบสำคัญจ่าย */
  docNo: string;
  /** เลขที่เอกสารซื้อ (PI) */
  purchaseDocNo: string;
  /** เลขที่หนังสือรับรอง 50 ทวิ */
  certNo?: string;
  paidDate: string;
  rate: number;
  amount: number;
  tax: number;
  incomeType: string;
  condition: WhtCondition;
};

export type WhtPayee = {
  /**
   * ผู้รับเงิน — ชื่อ/เลขผู้เสียภาษี/ที่อยู่/ประเภทบุคคล มาจาก snapshot ในใบสำคัญจ่าย (ข้อมูลเก่า: เอกสารซื้อ)
   * (`id`, `code` ยังเป็นของผู้ติดต่อ ใช้ลิงก์ไปหน้าผู้ติดต่อได้)
   */
  contact: Contact;
  /** เรียงตามวันที่จ่าย — การจ่ายแต่ละครั้ง (PV) เป็นคนละรายการ แม้มาจากเอกสารซื้อใบเดียวกัน */
  items: WhtItem[];
};

/**
 * รายการหัก ณ ที่จ่ายของงวด แยกตามผู้รับเงิน — นับตามวันที่จ่ายจริงของใบสำคัญจ่ายแต่ละใบ (แบ่งจ่าย = หลายรายการ)
 * ประเภทบุคคล (ภ.ง.ด.3/53) และข้อมูลผู้รับเงินอ่านจาก snapshot — `contacts` ใช้เฉพาะเอกสารที่ไม่มี snapshot
 */
export function whtPayeesForPeriod(
  state: Pick<AccountingData, 'payments' | 'purchases' | 'contacts'>,
  period: Period,
  form: WhtForm
): WhtPayee[] {
  const byId = new Map(state.contacts.map((c) => [c.id, c]));
  const purchases = new Map(state.purchases.map((p) => [p.id, p]));
  const wantLegal = form === 'PND3' ? 'individual' : 'juristic';
  const groups = new Map<string, WhtPayee>();

  state.payments
    .filter((pv) => pv.whtItems.length > 0 && inPeriod(pv.date, period))
    .sort((a, b) => (a.date + a.docNo).localeCompare(b.date + b.docNo))
    .forEach((pv) => {
      const purchase = purchases.get(pv.purchaseId);
      const live = byId.get(pv.contactId);
      const party = pv.payee ?? resolveParty(purchase?.supplier, live);
      if (!party || party.legalForm !== wantLegal) return;
      const contact: Contact = {
        id: pv.contactId,
        code: live?.code ?? '',
        kind: live?.kind ?? 'vendor',
        creditDays: live?.creditDays ?? 0,
        ...party,
      };
      // ผู้รับเงินคนเดิมแต่ snapshot เลขผู้เสียภาษีต่างกัน (แก้ข้อมูลระหว่างเดือน) แยกเป็นคนละแถว
      const key = `${pv.contactId}|${party.taxId}|${party.branchNo}`;
      const g = groups.get(key) ?? { contact, items: [] };
      pv.whtItems.forEach((w) => {
        g.items.push({
          paymentId: pv.id,
          purchaseId: pv.purchaseId,
          docNo: pv.docNo,
          purchaseDocNo: purchase?.docNo ?? '',
          certNo: pv.whtCertNo,
          paidDate: pv.date,
          rate: w.rate,
          amount: w.base,
          tax: w.tax,
          incomeType: w.incomeType,
          condition: purchase?.whtCondition ?? '1',
        });
      });
      groups.set(key, g);
    });

  return Array.from(groups.values());
}

export function whtTotals(payees: WhtPayee[]) {
  const items = payees.flatMap((p) => p.items);
  return {
    payees: payees.length,
    amount: sumBaht(items.map((i) => i.amount)),
    tax: round2(sumBaht(items.map((i) => i.tax))),
  };
}

/**
 * ภาษีที่ลูกค้าหัก ณ ที่จ่ายไว้เมื่อรับชำระ (ฝั่งขาย)
 * ฐานภาษี = มูลค่าก่อน VAT ตามสัดส่วนยอดที่รับครั้งนี้ (net × amount ÷ total) แล้วคูณอัตรา
 */
export function receiptWhtAmount(totals: Pick<DocTotals, 'net' | 'total'>, amount: number, rate: number): number {
  if (!(rate > 0) || !(amount > 0)) return 0;
  return percentOf(prorateBaht(totals.net, amount, totals.total), rate);
}
