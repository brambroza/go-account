import { ACC } from './chart-of-accounts';
import { profitLossBalances } from './ledger';
import { isServiceInvoice } from './sales-doc';
import { calcDocument } from './document-calc';
import { sumBaht, subBaht, toSatang } from './money';
import { endOfMonth, monthKeyOf, shiftMonthKey, formatThaiDate, isValidISODate } from './thai-date';

import type { ProfitLossBalance } from './posting';
import type { ISODate, SalesDoc, YearClose, PurchaseDoc, AccountingData } from './types';

// ----------------------------------------------------------------------
// ปิดบัญชีสิ้นปี (โอนกำไรสะสม) และยอดยกมาจากระบบเดิม (B5)
// ----------------------------------------------------------------------

/** ปิดบัญชีสิ้นปีเรียงตามวันสิ้นปี */
export function sortedYearCloses(state: Pick<AccountingData, 'yearCloses'>): YearClose[] {
  return (state.yearCloses ?? []).slice().sort((a, b) => a.fiscalYearEnd.localeCompare(b.fiscalYearEnd));
}

/** วันสิ้นปีถัดไปที่ต้องปิด: ต่อจากการปิดครั้งล่าสุด 12 เดือน หรือ 31 ธ.ค. ของปีที่ปิดงวดไว้ล่าสุด */
export function suggestedFiscalYearEnd(state: Pick<AccountingData, 'yearCloses' | 'company'>): ISODate | undefined {
  const last = sortedYearCloses(state).pop();
  if (last) return endOfMonth(shiftMonthKey(monthKeyOf(last.fiscalYearEnd), 12));
  const lock = state.company.lockedThrough;
  if (!lock) return undefined;
  const yearEnd = `${lock.slice(0, 4)}-12-31`;
  return yearEnd <= lock ? yearEnd : `${Number(lock.slice(0, 4)) - 1}-12-31`;
}

/**
 * ตรวจก่อนปิดบัญชีสิ้นปี — คืนข้อความปัญหา หรือ null
 * กฎ: วันสิ้นปีเป็นวันสิ้นเดือน, ปิดงวดถึงวันสิ้นปีแล้ว (ไม่มีรายการเข้าปีนั้นได้อีก), หลังวันยอดยกมา,
 * ปีถัดจากการปิดครั้งล่าสุดพอดี 12 เดือน (ปีแรกเลือกเดือนสิ้นปีได้)
 */
export function yearCloseProblem(
  state: Pick<AccountingData, 'company' | 'yearCloses' | 'accounts' | 'openingBalance'>,
  fiscalYearEnd: string
): string | null {
  if (!isValidISODate(fiscalYearEnd)) return 'วันสิ้นปีไม่ถูกต้อง — ใช้ปี ค.ศ. รูปแบบ YYYY-MM-DD';
  if (endOfMonth(monthKeyOf(fiscalYearEnd)) !== fiscalYearEnd) return 'วันสิ้นรอบบัญชีต้องเป็นวันสิ้นเดือน';
  const lock = state.company.lockedThrough;
  if (!lock || lock < fiscalYearEnd) {
    return `ต้องปิดงวดถึง ${formatThaiDate(fiscalYearEnd)} ก่อนปิดบัญชีสิ้นปี (ปิดงวดถึง ${lock ? formatThaiDate(lock) : 'ยังไม่ปิด'})`;
  }
  const opening = state.openingBalance;
  if (opening && fiscalYearEnd <= opening.date) {
    return `วันสิ้นปีต้องหลังวันยอดยกมา (${formatThaiDate(opening.date)}) — ปีก่อนหน้าปิดในระบบเดิมแล้ว`;
  }
  const last = sortedYearCloses(state).pop();
  if (last) {
    if (fiscalYearEnd < last.fiscalYearEnd) return `ปิดบัญชีถึง ${formatThaiDate(last.fiscalYearEnd)} แล้ว — ปิดย้อนหลังไม่ได้`;
    const want = endOfMonth(shiftMonthKey(monthKeyOf(last.fiscalYearEnd), 12));
    if (fiscalYearEnd !== want) return `รอบบัญชีถัดไปต้องสิ้นสุด ${formatThaiDate(want)} (12 เดือนต่อจากปีที่ปิดล่าสุด)`;
  }
  if (!state.accounts.some((a) => a.code === ACC.retained && a.type === 'equity')) {
    return `ไม่พบบัญชี ${ACC.retained} กำไร (ขาดทุน) สะสม ในผังบัญชี`;
  }
  return null;
}

/** ยอดรายได้/ค่าใช้จ่ายสะสมถึงวันสิ้นปีที่ต้องปิด (ไม่รวมรายการ `excludeId`) และกำไรสุทธิ */
export function yearCloseBalances(
  state: Pick<AccountingData, 'accounts' | 'journal'>,
  fiscalYearEnd: ISODate,
  excludeId?: string
): { balances: ProfitLossBalance[]; netProfit: number } {
  const journal = excludeId ? state.journal.filter((e) => e.id !== excludeId) : state.journal;
  const balances = profitLossBalances(state.accounts, journal, fiscalYearEnd);
  return { balances, netProfit: -sumBaht(balances.map((b) => b.debit)) || 0 };
}

// ---------------- ยอดยกมา ----------------

export function openingSales(state: Pick<AccountingData, 'sales'>): SalesDoc[] {
  return state.sales.filter((s) => s.opening);
}

export function openingPurchases(state: Pick<AccountingData, 'purchases'>): PurchaseDoc[] {
  return state.purchases.filter((p) => p.opening);
}

/**
 * ยอดรวมใบค้างรับ/ค้างจ่ายยกมา (รวม VAT) — ต้องเท่ากับยอดลูกหนี้/เจ้าหนี้ในรายการยอดยกมา
 * `deferredVat` = VAT ของใบแจ้งหนี้งานบริการค้างรับ (ยังไม่ถึงกำหนด ม.78/1) ที่ยกมาใน 2151
 */
export function openingItemTotals(state: Pick<AccountingData, 'sales' | 'purchases'>) {
  return {
    receivable: sumBaht(openingSales(state).map((s) => calcDocument(s).total)),
    payable: sumBaht(openingPurchases(state).map((p) => calcDocument(p).total)),
    deferredVat: sumBaht(openingSales(state).filter(isServiceInvoice).map((s) => calcDocument(s).vat)),
  };
}

export type OpeningReconRow = {
  accountCode: string;
  label: string;
  /** ยอดบัญชีคุมตามงบทดลองของระบบเดิม (ที่ผู้ใช้กรอก) */
  control: number;
  /** ยอดรวมรายการย่อย (ใบค้างรับ/ค้างจ่าย) */
  items: number;
  difference: number;
};

/**
 * กระทบยอดบัญชีคุมตามงบทดลองของระบบเดิมกับรายการย่อยที่กรอก (ลูกหนี้ 1130 / เจ้าหนี้ 2110)
 * ใช้ในหน้ายกยอดก่อนบันทึก — ต่างกัน = ยังกรอกใบค้างไม่ครบหรือยอดผิด
 */
export function openingReconciliation(input: {
  receivableControl: number;
  payableControl: number;
  receivables: { amount: number }[];
  payables: { amount: number }[];
}): OpeningReconRow[] {
  const row = (accountCode: string, label: string, control: number, items: number): OpeningReconRow => ({
    accountCode,
    label,
    control,
    items,
    difference: subBaht(control, items),
  });
  return [
    row(ACC.receivable, 'ลูกหนี้การค้า', input.receivableControl, sumBaht(input.receivables.map((r) => r.amount))),
    row(ACC.payable, 'เจ้าหนี้การค้า', input.payableControl, sumBaht(input.payables.map((p) => p.amount))),
  ];
}

/**
 * บันทึก/แก้ยอดยกมาได้หรือไม่ — ได้เฉพาะก่อนมีรายการอื่น (มีแค่รายการยอดยกมาเดิมได้) คืนเหตุผล หรือ null
 */
export function openingBlockedReason(state: AccountingData): string | null {
  const prior = state.openingBalance;
  const hasOther =
    state.journal.some((e) => !prior || e.id !== prior.journalId) ||
    state.sales.some((s) => !s.opening) ||
    state.purchases.some((p) => !p.opening) ||
    state.receipts.length > 0 ||
    state.payments.length > 0 ||
    state.refunds.length > 0 ||
    state.purchaseCredits.length > 0 ||
    state.vatCloses.length > 0 ||
    state.yearCloses.length > 0;
  return hasOther
    ? 'บันทึกยอดยกมาได้ก่อนมีรายการอื่นเท่านั้น — เริ่มจากข้อมูลบริษัทว่าง (ล้างข้อมูลตัวอย่าง) แล้วยกยอดก่อนออกเอกสาร'
    : null;
}

/** เดบิต/เครดิตรวมของรายการยอดยกมาที่จะลง (ใช้แสดงก่อนบันทึก — action ตรวจสมดุลซ้ำด้วย posting engine) */
export function openingEntryTotals(input: {
  lines: { debit: number; credit: number }[];
  vatCredit: number;
  whtReceivable: number;
  receivables: { amount: number }[];
  payables: { amount: number }[];
}): { debit: number; credit: number; difference: number } {
  const debit = sumBaht([
    ...input.lines.map((l) => l.debit || 0),
    ...input.receivables.map((r) => r.amount || 0),
    input.vatCredit || 0,
    input.whtReceivable || 0,
  ]);
  const credit = sumBaht([...input.lines.map((l) => l.credit || 0), ...input.payables.map((p) => p.amount || 0)]);
  return { debit, credit, difference: subBaht(debit, credit) };
}

/** กระทบยอดครบทุกบัญชี */
export function isOpeningReconciled(rows: OpeningReconRow[]): boolean {
  return rows.every((r) => toSatang(r.difference) === 0);
}
