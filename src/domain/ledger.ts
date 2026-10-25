import { diffDays } from './thai-date';
import { normalSide } from './chart-of-accounts';
import { round2, sumBaht, subBaht, toSatang, fromSatang } from './money';

import type { Account, ISODate, SalesDoc, JournalEntry } from './types';

// ----------------------------------------------------------------------

export type TrialBalanceRow = {
  account: Account;
  debit: number;
  credit: number;
  /** ยอดคงเหลือด้านปกติของบัญชี */
  balance: number;
};

/** งบทดลอง ณ วันที่ (รวมทุกรายการจนถึง asOf) */
export function trialBalance(
  accounts: Account[],
  journal: JournalEntry[],
  asOf?: ISODate
): TrialBalanceRow[] {
  const sums = new Map<string, { debit: number; credit: number }>();
  journal
    .filter((e) => !asOf || e.date <= asOf)
    .forEach((e) =>
      e.lines.forEach((l) => {
        const cur = sums.get(l.accountCode) ?? { debit: 0, credit: 0 };
        sums.set(l.accountCode, {
          debit: sumBaht([cur.debit, l.debit]),
          credit: sumBaht([cur.credit, l.credit]),
        });
      })
    );

  return accounts
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((account) => {
      const s = sums.get(account.code) ?? { debit: 0, credit: 0 };
      const balance =
        normalSide(account.type) === 'debit' ? round2(s.debit - s.credit) : round2(s.credit - s.debit);
      return { account, debit: s.debit, credit: s.credit, balance };
    })
    .filter((r) => toSatang(r.debit) !== 0 || toSatang(r.credit) !== 0);
}

export type TrialBalanceTotals = {
  /** ผลรวมยอดคงเหลือด้านเดบิต */
  debit: number;
  /** ผลรวมยอดคงเหลือด้านเครดิต */
  credit: number;
  balanced: boolean;
};

/** ยอดรวมท้ายงบทดลอง (แสดงยอดคงเหลือสุทธิแต่ละบัญชีเข้าด้านใดด้านหนึ่ง) */
export function trialBalanceTotals(rows: TrialBalanceRow[]): TrialBalanceTotals {
  let debit = 0;
  let credit = 0;
  rows.forEach((r) => {
    const net = toSatang(r.debit) - toSatang(r.credit);
    if (net > 0) debit += net;
    else credit -= net;
  });
  return { debit: fromSatang(debit), credit: fromSatang(credit), balanced: debit === credit };
}

export function balanceOf(rows: TrialBalanceRow[], code: string): number {
  return rows.find((r) => r.account.code === code)?.balance ?? 0;
}

export type ProfitAndLoss = {
  revenue: TrialBalanceRow[];
  expense: TrialBalanceRow[];
  totalRevenue: number;
  totalExpense: number;
  netProfit: number;
};

/** งบกำไรขาดทุนจากรายการในช่วงวันที่ — ไม่รวมรายการปิดบัญชีสิ้นปี (ไม่อย่างนั้นปีที่ปิดแล้วจะเป็นศูนย์) */
export function profitAndLoss(
  accounts: Account[],
  journal: JournalEntry[],
  from: ISODate,
  to: ISODate
): ProfitAndLoss {
  const rows = trialBalance(
    accounts,
    journal.filter((e) => e.date >= from && e.date <= to && e.source !== 'year-close')
  );
  const revenue = rows.filter((r) => r.account.type === 'revenue');
  const expense = rows.filter((r) => r.account.type === 'expense');
  const totalRevenue = sumBaht(revenue.map((r) => r.balance));
  const totalExpense = sumBaht(expense.map((r) => r.balance));
  return { revenue, expense, totalRevenue, totalExpense, netProfit: round2(totalRevenue - totalExpense) };
}

export type BalanceSheetRow = { account: Account; balance: number };

export type BalanceSheet = {
  asOf: ISODate;
  assets: BalanceSheetRow[];
  liabilities: BalanceSheetRow[];
  equity: BalanceSheetRow[];
  totalAssets: number;
  totalLiabilities: number;
  /** ส่วนของเจ้าของตามบัญชี (ทุน กำไรสะสม) ไม่รวมกำไรที่ยังไม่ปิดบัญชี */
  totalEquityAccounts: number;
  /** กำไร (ขาดทุน) ที่ยังไม่ได้ปิดเข้ากำไรสะสม = รายได้ − ค่าใช้จ่ายคงเหลือ ณ วันที่ */
  unclosedProfit: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  /** สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ (รวมกำไรที่ยังไม่ปิด) */
  balanced: boolean;
};

/**
 * งบแสดงฐานะการเงิน ณ วันที่ (TFRS for NPAEs แบบย่อ) — ยอดคงเหลือด้านปกติของแต่ละบัญชีจากงบทดลอง
 * กำไรงวดปัจจุบัน (รายได้ − ค่าใช้จ่ายที่ยังไม่ปิดเข้ากำไรสะสม) แสดงในส่วนของเจ้าของ
 */
export function balanceSheet(accounts: Account[], journal: JournalEntry[], asOf: ISODate): BalanceSheet {
  const tb = trialBalance(accounts, journal, asOf);
  const pick = (type: Account['type']) =>
    tb.filter((r) => r.account.type === type && toSatang(r.balance) !== 0).map((r) => ({ account: r.account, balance: r.balance }));
  const assets = pick('asset');
  const liabilities = pick('liability');
  const equity = pick('equity');
  const total = (rows: { balance: number }[]) => sumBaht(rows.map((r) => r.balance));
  const unclosedProfit = subBaht(
    total(tb.filter((r) => r.account.type === 'revenue')),
    total(tb.filter((r) => r.account.type === 'expense'))
  );
  const totalAssets = total(assets);
  const totalLiabilities = total(liabilities);
  const totalEquityAccounts = total(equity);
  const totalEquity = sumBaht([totalEquityAccounts, unclosedProfit]);
  const totalLiabilitiesAndEquity = sumBaht([totalLiabilities, totalEquity]);
  return {
    asOf,
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquityAccounts,
    unclosedProfit,
    totalEquity,
    totalLiabilitiesAndEquity,
    balanced: toSatang(totalAssets) === toSatang(totalLiabilitiesAndEquity),
  };
}

/** ยอดคงเหลือ (เดบิต − เครดิต) ของบัญชีรายได้/ค่าใช้จ่าย จากรายการที่ลงวันที่ไม่เกิน `through` */
export function profitLossBalances(
  accounts: Account[],
  journal: JournalEntry[],
  through: ISODate
): { accountCode: string; type: Account['type']; debit: number }[] {
  return trialBalance(accounts, journal, through)
    .filter((r) => r.account.type === 'revenue' || r.account.type === 'expense')
    .map((r) => ({ accountCode: r.account.code, type: r.account.type, debit: subBaht(r.debit, r.credit) }))
    .filter((b) => toSatang(b.debit) !== 0);
}

export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export type ArAgingRow = {
  doc: SalesDoc;
  outstanding: number;
  daysOverdue: number;
  bucket: AgingBucket;
};

export function bucketOf(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

/** อายุลูกหนี้: ใบกำกับที่ยังค้างชำระ (หักใบลดหนี้ที่อ้างถึงแล้ว) */
export function arAging(sales: SalesDoc[], outstandingOf: (doc: SalesDoc) => number, asOf: ISODate) {
  return sales
    .filter((d) => d.kind === 'tax-invoice' && d.status !== 'cancelled')
    .map((doc) => {
      const outstanding = outstandingOf(doc);
      const daysOverdue = diffDays(doc.dueDate, asOf);
      return { doc, outstanding, daysOverdue, bucket: bucketOf(daysOverdue) };
    })
    .filter((r) => toSatang(r.outstanding) > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}
