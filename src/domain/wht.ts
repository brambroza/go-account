import { inPeriod } from './thai-date';
import { round2, sumBaht } from './money';
import { calcDocument } from './document-calc';

import type { Period } from './thai-date';
import type { Contact, PurchaseDoc, WhtCondition } from './types';

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
  contact: Contact;
  items: WhtItem[];
};

/** รายการหัก ณ ที่จ่ายของงวด แยกตามผู้รับเงิน — นับตามวันที่จ่ายจริง */
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
      const contact = byId.get(p.contactId);
      if (!contact || contact.legalForm !== wantLegal) return;
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
      const g = groups.get(contact.id) ?? { contact, items: [] };
      g.items.push(item);
      groups.set(contact.id, g);
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
