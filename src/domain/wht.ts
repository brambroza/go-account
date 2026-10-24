import { inPeriod } from './thai-date';
import { resolveParty } from './snapshot';
import { calcDocument } from './document-calc';
import { round2, sumBaht, percentOf, prorateBaht } from './money';

import type { Period } from './thai-date';
import type { Contact, DocTotals, PurchaseDoc, WhtCondition } from './types';

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
  purchaseId: string;
  docNo: string;
  paidDate: string;
  rate: number;
  amount: number;
  tax: number;
  incomeType: string;
  condition: WhtCondition;
};

export type WhtPayee = {
  /**
   * ผู้รับเงิน — ชื่อ/เลขผู้เสียภาษี/ที่อยู่/ประเภทบุคคล มาจาก snapshot ของเอกสารซื้อ
   * (`id`, `code` ยังเป็นของผู้ติดต่อ ใช้ลิงก์ไปหน้าผู้ติดต่อได้)
   */
  contact: Contact;
  items: WhtItem[];
};

/**
 * รายการหัก ณ ที่จ่ายของงวด แยกตามผู้รับเงิน — นับตามวันที่จ่ายจริง
 * ประเภทบุคคล (ภ.ง.ด.3/53) และข้อมูลผู้รับเงินอ่านจาก snapshot ในเอกสารซื้อ — `contacts` ใช้เฉพาะเอกสารที่ไม่มี snapshot
 */
export function whtPayeesForPeriod(
  purchases: PurchaseDoc[],
  contacts: Contact[],
  period: Period,
  form: WhtForm
): WhtPayee[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const wantLegal = form === 'PND3' ? 'individual' : 'juristic';
  const groups = new Map<string, WhtPayee>();

  purchases
    .filter((p) => p.paid && p.paidDate && p.whtRate > 0 && inPeriod(p.paidDate, period))
    .sort((a, b) => (a.paidDate ?? '').localeCompare(b.paidDate ?? ''))
    .forEach((p) => {
      const live = byId.get(p.contactId);
      const party = resolveParty(p.supplier, live);
      if (!party || party.legalForm !== wantLegal) return;
      const contact: Contact = {
        id: p.contactId,
        code: live?.code ?? '',
        kind: live?.kind ?? 'vendor',
        creditDays: live?.creditDays ?? 0,
        ...party,
      };
      const t = calcDocument(p);
      const item: WhtItem = {
        purchaseId: p.id,
        docNo: p.docNo,
        paidDate: p.paidDate as string,
        rate: p.whtRate,
        amount: t.net,
        tax: t.wht,
        incomeType: p.whtIncomeType,
        condition: p.whtCondition,
      };
      // ผู้รับเงินคนเดิมแต่ snapshot เลขผู้เสียภาษีต่างกัน (แก้ข้อมูลระหว่างเดือน) แยกเป็นคนละแถว
      const key = `${p.contactId}|${party.taxId}|${party.branchNo}`;
      const g = groups.get(key) ?? { contact, items: [] };
      g.items.push(item);
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
