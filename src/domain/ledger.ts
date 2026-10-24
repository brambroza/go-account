import { diffDays } from './thai-date';
import { normalSide } from './chart-of-accounts';
import { round2, sumBaht, toSatang } from './money';

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

/** งบกำไรขาดทุนจากรายการในช่วงวันที่ */
export function profitAndLoss(
  accounts: Account[],
  journal: JournalEntry[],
  from: ISODate,
  to: ISODate
): ProfitAndLoss {
  const rows = trialBalance(
    accounts,
    journal.filter((e) => e.date >= from && e.date <= to)
  );
  const revenue = rows.filter((r) => r.account.type === 'revenue');
  const expense = rows.filter((r) => r.account.type === 'expense');
  const totalRevenue = sumBaht(revenue.map((r) => r.balance));
  const totalExpense = sumBaht(expense.map((r) => r.balance));
  return { revenue, expense, totalRevenue, totalExpense, netProfit: round2(totalRevenue - totalExpense) };
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
