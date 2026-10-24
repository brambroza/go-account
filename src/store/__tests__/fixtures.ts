import type { DocLine, AccountingData } from 'src/domain';

import { ACC } from 'src/domain';

import { buildDemoData } from '../seed';

// ----------------------------------------------------------------------
// ข้อมูลทดสอบร่วม — ข้อมูลตัวอย่าง ณ 24 ต.ค. 2569 (ใบกำกับล่าสุด IV6910-0004 ลงวันที่ 21 ต.ค.)
// ----------------------------------------------------------------------

export const TODAY = '2026-10-24';

export function demo(): AccountingData {
  return buildDemoData(TODAY);
}

let seq = 0;

/** บรรทัดเอกสารสำหรับทดสอบ */
export function ln(qty: number, unitPrice: number, accountCode: string = ACC.sales, discount = 0): DocLine {
  seq += 1;
  return { id: `t-${seq}`, description: `รายการ ${seq}`, qty, unitPrice, discount, accountCode };
}

function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const copy = { ...obj };
  keys.forEach((k) => {
    delete copy[k];
  });
  return copy;
}

/** แปลงข้อมูล v2 กลับเป็นรูปแบบ v1 (ไม่มี snapshot / payments / refunds / WT) เพื่อทดสอบ migration */
export function toV1(data: AccountingData): Record<string, unknown> {
  const pvByPurchase = new Map(data.payments.map((p) => [p.purchaseId, p]));
  return {
    version: 1,
    company: { ...data.company },
    accounts: data.accounts.filter((a) => a.code !== ACC.customerCredit),
    contacts: data.contacts,
    sales: data.sales.map((s) => omit(s, ['seller', 'buyer', 'isTaxInvoice', 'creditToCustomer'])),
    receipts: data.receipts.map((r) => omit(r, ['seller', 'buyer'])),
    purchases: data.purchases.map((p) => {
      const rest = omit(p, ['supplier', 'paymentId', 'paymentDocNo']);
      const pv = pvByPurchase.get(rest.id);
      // v1 ใช้เลข PV แทนเลข 50 ทวิ
      return pv && rest.whtCertNo ? { ...rest, whtCertNo: pv.docNo.replace('PV', 'WT') } : rest;
    }),
    journal: data.journal.map((e) => {
      if (e.source !== 'payment') return e;
      const purchase = data.purchases.find((p) => p.paymentJournalId === e.id);
      return { ...e, sourceId: purchase?.id, sourceDocNo: purchase?.docNo };
    }),
    sequences: Object.fromEntries(Object.entries(data.sequences).filter(([k]) => !k.startsWith('WT'))),
  };
}
