import { toSatang } from './money';
import { isTaxDocument } from './sales-doc';
import { purchaseVatMonth } from './purchase';
import { pp30Summary, salesVatReport, purchaseVatReport } from './vat-report';
import { periodKey, endOfMonth, monthKeyOf, periodFromKey, shiftMonthKey } from './thai-date';

import type { Period } from './thai-date';
import type { PP30Summary } from './vat-report';
import type { ISODate, VatClose, AccountingData } from './types';

// ----------------------------------------------------------------------
// ภ.พ.30 รวมยอดชำระเกินยกมา และการปิดภาษีเดือน (B6)
//
// ออกแบบ: การปิดภาษีเดือนเกิดพร้อมการปิดงวด (`lockPeriod`) — ทุกเดือนที่ถูกปิดงวดครบทั้งเดือนจะได้ VatClose
// ต่อเนื่องกันตั้งแต่เดือนแรกที่มีรายการภาษี เดือนที่ปิดแล้วจึงไม่มีเอกสารใหม่เข้ามาเปลี่ยนตัวเลข
// (เอกสารขายลงวันที่ในเดือนนั้นไม่ได้ และเลือกเดือนนั้นเป็นเดือนใช้สิทธิภาษีซื้อไม่ได้)
// ระบบเลือก "ยกไป" ภาษีชำระเกินเสมอ (ไม่รองรับขอคืนเป็นเงินสด)
// ----------------------------------------------------------------------

/** ข้อมูลที่ใช้คิดภาษีเดือน — receipts/purchaseCredits/openingBalance ไม่มี = ไม่มีรายการประเภทนั้น */
type VatState = Pick<AccountingData, 'sales' | 'purchases' | 'contacts' | 'vatCloses'> &
  Partial<Pick<AccountingData, 'receipts' | 'purchaseCredits' | 'openingBalance'>>;

/**
 * เดือนที่มีรายการภาษี (เอกสารภาษีขายตามวันที่ / ใบเสร็จรับเงิน/ใบกำกับภาษีตามวันที่รับเงิน /
 * ภาษีซื้อตามเดือนใช้สิทธิ / ใบลดหนี้ผู้ขายตามเดือนที่ได้รับ) เรียงจากเก่าไปใหม่
 */
export function vatActivityMonths(
  state: Pick<AccountingData, 'sales' | 'purchases'> & Partial<Pick<AccountingData, 'receipts' | 'purchaseCredits'>>
): string[] {
  const months = new Set<string>();
  state.sales.filter((s) => s.vatMode !== 'none' && isTaxDocument(s)).forEach((s) => months.add(monthKeyOf(s.date)));
  (state.receipts ?? []).filter((r) => r.isTaxInvoice).forEach((r) => months.add(monthKeyOf(r.date)));
  state.purchases.filter((p) => p.claimVat && p.vatMode !== 'none').forEach((p) => months.add(purchaseVatMonth(p)));
  (state.purchaseCredits ?? [])
    .filter((c) => c.claimVat && c.vatMode !== 'none' && c.vatClaimPeriod)
    .forEach((c) => months.add(c.vatClaimPeriod as string));
  return Array.from(months).sort();
}

/** ภาษีชำระเกินยกมาจากระบบเดิม (ยอดยกมา) — จุดเริ่มของยอดยกมา/ยกไปก่อนการปิดภาษีเดือนครั้งแรก */
export function openingVatCredit(state: Partial<Pick<AccountingData, 'openingBalance'>>): number {
  return state.openingBalance?.vatCredit ?? 0;
}

export type PP30Full = PP30Summary & {
  /** ภาษีชำระเกินยกมา (ช่อง 10) */
  broughtForward: number;
  /** ภาษีที่ต้องชำระสุทธิ (ช่อง 11) */
  payable: number;
  /** ภาษีชำระเกินสุทธิ ยกไปเดือนถัดไป (ช่อง 12) */
  carriedForward: number;
  /** ปิดภาษีเดือนนี้แล้ว (ตัวเลขด้านบนมาจากรายการที่บันทึกไว้) */
  closed?: VatClose;
};

/** ยอดชำระสุทธิ / ยกไป จากภาษีขาย − ภาษีซื้อ − ยอดยกมา */
export function vatCloseFigures(summary: Pick<PP30Summary, 'outputVat' | 'inputVat'>, broughtForward: number) {
  const net = toSatang(summary.outputVat) - toSatang(summary.inputVat) - toSatang(broughtForward);
  return { payable: Math.max(net, 0) / 100, carriedForward: Math.max(-net, 0) / 100 };
}

function sortedCloses(state: Pick<AccountingData, 'vatCloses'>): VatClose[] {
  return state.vatCloses.slice().sort((a, b) => a.period.localeCompare(b.period));
}

function summaryOf(state: VatState, month: string): PP30Summary {
  const period = periodFromKey(month);
  return pp30Summary(
    salesVatReport(state.sales, state.contacts, period, state.receipts ?? []),
    purchaseVatReport(state.purchases, state.contacts, period, state.purchaseCredits ?? [])
  );
}

/**
 * ภาษีชำระเกินยกมาของเดือน `month` — เดือนที่ปิดแล้วใช้ตัวเลขที่บันทึกไว้, เดือนที่ยังไม่ปิดคำนวณต่อจาก
 * การปิดครั้งล่าสุด (หรือจากเดือนแรกที่มีรายการภาษี) ทีละเดือนจนถึงเดือนก่อนหน้า
 */
export function vatBroughtForward(state: VatState, month: string): number {
  const closes = sortedCloses(state);
  const closed = closes.find((c) => c.period === month);
  if (closed) return closed.broughtForward;
  const last = closes.filter((c) => c.period < month).pop();
  let cursor = last ? shiftMonthKey(last.period, 1) : vatActivityMonths(state)[0];
  let carry = last?.carriedForward ?? openingVatCredit(state);
  if (!cursor) return carry;
  while (cursor < month) {
    carry = vatCloseFigures(summaryOf(state, cursor), carry).carriedForward;
    cursor = shiftMonthKey(cursor, 1);
  }
  return carry;
}

/** ตัวเลข ภ.พ.30 ของงวด รวมยอดยกมา / ยอดชำระสุทธิ / ยอดยกไป */
export function pp30ForPeriod(state: VatState, period: Period): PP30Full {
  const month = periodKey(period);
  const summary = summaryOf(state, month);
  const closed = state.vatCloses.find((c) => c.period === month);
  const broughtForward = closed ? closed.broughtForward : vatBroughtForward(state, month);
  return { ...summary, broughtForward, ...vatCloseFigures(summary, broughtForward), closed };
}

/** ข้อมูลการปิดภาษีเดือน (ยังไม่มี id / รายการบัญชี) */
export type VatCloseDraft = Omit<VatClose, 'id' | 'journalId'>;

/** คำนวณการปิดภาษีเดือน `month` จากข้อมูลปัจจุบัน */
export function vatCloseDraft(state: VatState, month: string): VatCloseDraft {
  const summary = summaryOf(state, month);
  const broughtForward = vatBroughtForward(state, month);
  return {
    period: month,
    date: endOfMonth(month),
    outputVat: summary.outputVat,
    inputVat: summary.inputVat,
    broughtForward,
    ...vatCloseFigures(summary, broughtForward),
  };
}

/**
 * เดือนที่ต้องปิดภาษีเมื่อปิดงวดถึง `through`: ทุกเดือนที่ปิดงวดครบทั้งเดือน ต่อจากการปิดครั้งล่าสุด
 * (หรือตั้งแต่เดือนแรกที่มีรายการภาษี) — เดือนที่ไม่มีรายการก็ปิดด้วยเพื่อให้ยอดยกมาต่อเนื่อง
 */
export function monthsToVatClose(state: VatState, through: ISODate): string[] {
  const closes = sortedCloses(state);
  const last = closes[closes.length - 1];
  const start = last ? shiftMonthKey(last.period, 1) : vatActivityMonths(state)[0];
  if (!start) return [];
  const months: string[] = [];
  for (let m = start; endOfMonth(m) <= through; m = shiftMonthKey(m, 1)) months.push(m);
  return months;
}

/** ยอดยกไปล่าสุด (บัญชี 1180 ต้องเท่ากับค่านี้) — ยังไม่เคยปิด = ยอดยกมาจากระบบเดิม */
export function latestVatCredit(state: Pick<AccountingData, 'vatCloses'> & Partial<Pick<AccountingData, 'openingBalance'>>): number {
  const closes = sortedCloses(state);
  return closes.length ? closes[closes.length - 1].carriedForward : openingVatCredit(state);
}
