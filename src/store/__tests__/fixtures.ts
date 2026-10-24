import type { DocLine, PurchaseLine, AccountingData } from 'src/domain';

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

/** บรรทัดเอกสารซื้อ — `wht` = [ประเภทเงินได้, อัตรา] (ไม่ส่ง = ไม่หัก) */
export function pln(qty: number, unitPrice: number, accountCode: string = ACC.misc, wht?: [string, number]): PurchaseLine {
  return { ...ln(qty, unitPrice, accountCode), whtIncomeType: wht?.[0] ?? '', whtRate: wht?.[1] ?? 0 };
}

function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const copy = { ...obj };
  keys.forEach((k) => {
    delete copy[k];
  });
  return copy;
}

/** แปลงข้อมูลปัจจุบัน (v7) กลับเป็นโครง v6 — ไม่มีการรับเงินคืนจากผู้ขาย / บัญชี 1150 */
export function toV6(data: AccountingData): Record<string, unknown> {
  return {
    ...omit(data, ['supplierRefunds']),
    version: 6,
    accounts: data.accounts.filter((a) => a.code !== ACC.supplierRefundReceivable),
  };
}

/** แปลงข้อมูลปัจจุบัน (v6) กลับเป็นโครง v5 — ไม่มีทะเบียนธนาคาร / โอนเงิน / กระทบยอด / ใบเสนอราคา / บัญชี 1111 */
export function toV5(data: AccountingData): AccountingData & Record<string, unknown> {
  const quotationKeys = Object.keys(data.sequences).filter((k) => k.startsWith('QT'));
  return {
    ...(omit(data, ['bankAccounts', 'transfers', 'bankStatements', 'bankMatches', 'quotations']) as AccountingData),
    version: 5,
    accounts: data.accounts.filter((a) => a.code !== ACC.pettyCash),
    sequences: Object.fromEntries(Object.entries(data.sequences).filter(([k]) => !quotationKeys.includes(k))),
  } as unknown as AccountingData & Record<string, unknown>;
}

/** แปลงข้อมูลปัจจุบันกลับเป็นโครง v4 — ไม่มีใบลดหนี้ผู้ขาย / ปิดปี / ยอดยกมา / บัญชี 2151 */
export function toV4(data: AccountingData): Record<string, unknown> {
  const v5 = toV5(data);
  return {
    ...omit(v5, ['purchaseCredits', 'yearCloses', 'openingBalance']),
    version: 4,
    accounts: v5.accounts.filter((a) => a.code !== ACC.deferredOutputVat),
  };
}

/**
 * แปลงข้อมูลปัจจุบัน (v5) กลับเป็นโครง v3 — หัก ณ ที่จ่ายระดับเอกสาร + ข้อมูลการจ่ายครั้งเดียวในเอกสารซื้อ
 * (ใช้ได้กับข้อมูลที่ทุกเอกสารซื้อมีหัก ณ ที่จ่ายประเภทเดียวและจ่ายครั้งเดียว เช่นข้อมูลตัวอย่าง)
 */
export function toV3(source: AccountingData): Record<string, unknown> {
  const data = toV5(source);
  const pvByPurchase = new Map(data.payments.map((p) => [p.purchaseId, p]));
  return {
    ...omit(data, ['vatCloses', 'purchaseCredits', 'yearCloses', 'openingBalance']),
    version: 3,
    accounts: data.accounts.filter((a) => a.code !== ACC.vatCredit && a.code !== ACC.deferredOutputVat),
    sales: data.sales.map((s) => omit(s, ['originalNet', 'correctNet'])),
    purchases: data.purchases.map((p) => {
      const pv = pvByPurchase.get(p.id);
      const withheld = p.lines.find((l) => l.whtRate > 0);
      return {
        ...omit(p, ['supplierInvoiceDate', 'vatClaimPeriod']),
        lines: p.lines.map((l) => omit(l, ['whtIncomeType', 'whtRate'])),
        whtRate: withheld?.whtRate ?? 0,
        whtIncomeType: withheld?.whtIncomeType ?? '',
        ...(pv
          ? {
              paidDate: pv.date,
              paymentAccountCode: pv.accountCode,
              paymentId: pv.id,
              paymentDocNo: pv.docNo,
              whtCertNo: pv.whtCertNo,
              paymentJournalId: pv.journalId,
            }
          : {}),
      };
    }),
    payments: data.payments.map((pv) => omit(pv, ['whtItems'])),
  };
}

type V3Purchase = { id: string; whtCertNo?: string; paymentJournalId?: string; docNo: string };

/** แปลงข้อมูลปัจจุบันกลับเป็นรูปแบบ v1 (ไม่มี snapshot / payments / refunds / WT) เพื่อทดสอบ migration */
export function toV1(source: AccountingData): Record<string, unknown> {
  const data = toV5(source);
  const v3 = toV3(data) as { purchases: (V3Purchase & Record<string, unknown>)[] };
  const pvByPurchase = new Map(data.payments.map((p) => [p.purchaseId, p]));
  return {
    version: 1,
    company: { ...data.company },
    accounts: data.accounts.filter(
      (a) => a.code !== ACC.customerCredit && a.code !== ACC.vatCredit && a.code !== ACC.deferredOutputVat
    ),
    contacts: data.contacts,
    sales: data.sales.map((s) => omit(s, ['seller', 'buyer', 'isTaxInvoice', 'creditToCustomer', 'originalNet', 'correctNet'])),
    receipts: data.receipts.map((r) => omit(r, ['seller', 'buyer'])),
    purchases: v3.purchases.map((p) => {
      const rest = omit(p, ['supplier', 'paymentId', 'paymentDocNo']);
      const pv = pvByPurchase.get(p.id);
      // v1 ใช้เลข PV แทนเลข 50 ทวิ
      return pv && p.whtCertNo ? { ...rest, whtCertNo: pv.docNo.replace('PV', 'WT') } : rest;
    }),
    journal: data.journal.map((e) => {
      if (e.source !== 'payment') return e;
      const purchase = v3.purchases.find((p) => p.paymentJournalId === e.id);
      return { ...e, sourceId: purchase?.id, sourceDocNo: purchase?.docNo };
    }),
    sequences: Object.fromEntries(Object.entries(data.sequences).filter(([k]) => !k.startsWith('WT'))),
  };
}
