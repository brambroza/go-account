import { diffDays } from './thai-date';
import { isCashAccount } from './chart-of-accounts';
import { round2, sumBaht, toSatang, fromSatang } from './money';

import type {
  ISODate,
  Account,
  BankMatch,
  BankAccount,
  JournalEntry,
  BankTransfer,
  AccountingData,
  BankAccountKind,
  BankStatementLine,
} from './types';

// ----------------------------------------------------------------------
// ธนาคาร / เงินสดย่อย / กระทบยอดธนาคาร (B9)
// - บัญชีธนาคารแต่ละบัญชี = บัญชีแยกประเภท 112x, เงินสดย่อย = 111x (1110 เงินสด ไม่อยู่ในทะเบียน)
// - กระทบยอด: จับคู่รายการ statement กับรายการเคลื่อนไหวของบัญชีนั้นในสมุดรายวัน (ยอดรวมต้องเท่ากัน)
//   การจับคู่ไม่ลงบัญชี — รายการที่ statement มีแต่สมุดไม่มี (ค่าธรรมเนียม ดอกเบี้ย) ให้ลงรายการปรับปรุง/เอกสารเอง
// ----------------------------------------------------------------------

/** รหัสบัญชีที่ใช้ได้ต่อประเภท: ธนาคาร 1120–1129, เงินสดย่อย 1111–1119 */
const CODE_PATTERN: Record<BankAccountKind, RegExp> = {
  bank: /^112\d$/,
  'petty-cash': /^111[1-9]$/,
};

export const BANK_KIND_LABEL: Record<BankAccountKind, string> = {
  bank: 'เงินฝากธนาคาร',
  'petty-cash': 'เงินสดย่อย',
};

export function isBankKindCode(code: string, kind: BankAccountKind): boolean {
  return CODE_PATTERN[kind].test(code);
}

/** รหัสบัญชีถัดไปที่ว่างของประเภทนี้ (null = เต็มแล้ว) */
export function nextBankAccountCode(accounts: Pick<Account, 'code'>[], kind: BankAccountKind): string | null {
  const used = new Set(accounts.map((a) => a.code));
  const start = kind === 'bank' ? 1120 : 1111;
  const end = kind === 'bank' ? 1129 : 1119;
  for (let n = start; n <= end; n += 1) {
    if (!used.has(String(n))) return String(n);
  }
  return null;
}

/** ชื่อแสดงของบัญชีเงิน: "1120 เงินฝากธนาคาร · กสิกรไทย 123-4-56789-0" */
export function cashAccountLabel(account: Pick<Account, 'code' | 'name'>, bank?: Pick<BankAccount, 'bankName' | 'accountNo'>): string {
  // ชื่อบัญชีที่ระบบตั้งให้มีชื่อธนาคาร/เลขที่อยู่แล้ว ("เงินฝากธนาคาร กสิกรไทย 123-4") — ไม่ต่อท้ายซ้ำ (UAT U13)
  const extra = bank
    ? [bank.bankName, bank.accountNo].filter((x) => x && x.trim() && !account.name.includes(x.trim())).join(' ')
    : '';
  return `${account.code} ${account.name}${extra ? ` · ${extra}` : ''}`;
}

/** บัญชีเงินสด/ธนาคารทั้งหมดที่ใช้รับ/จ่ายเงินได้ (ตามผังบัญชี) เรียงตามรหัส */
export function cashAccountsOf(data: Pick<AccountingData, 'accounts'>): Account[] {
  return data.accounts.filter((a) => isCashAccount(a)).sort((a, b) => a.code.localeCompare(b.code));
}

export function bankAccountOf(data: Pick<AccountingData, 'bankAccounts'>, code: string): BankAccount | undefined {
  return data.bankAccounts.find((b) => b.accountCode === code);
}

export function isPettyCashAccount(data: Pick<AccountingData, 'bankAccounts'>, code: string): boolean {
  return bankAccountOf(data, code)?.kind === 'petty-cash';
}

// ---------------- ยอดคงเหลือ ----------------

/** ยอดเคลื่อนไหว (เดบิต − เครดิต) ของบัญชี `code` ในรายการบัญชีหนึ่งรายการ */
export function movementOf(entry: Pick<JournalEntry, 'lines'>, code: string): number {
  return fromSatang(
    entry.lines.filter((l) => l.accountCode === code).reduce((a, l) => a + toSatang(l.debit) - toSatang(l.credit), 0)
  );
}

/** ยอดคงเหลือตามบัญชี (เดบิต − เครดิต) ถึงวันที่ `asOf` (ไม่ส่ง = ทั้งหมด) */
export function cashBalanceOf(data: Pick<AccountingData, 'journal'>, code: string, asOf?: ISODate): number {
  return sumBaht(data.journal.filter((e) => !asOf || e.date <= asOf).map((e) => movementOf(e, code)));
}

/**
 * ยอดคงเหลือต่ำสุดของบัญชีตั้งแต่วันที่ `from` เป็นต้นไป (รวมรายการที่ลงวันที่หลังจากนั้นแล้ว)
 * ใช้ตรวจว่าจ่ายเงินสดย่อยวันที่ `from` แล้วยอดไม่ติดลบในวันใดหลังจากนั้น
 */
export function minCashBalanceFrom(data: Pick<AccountingData, 'journal'>, code: string, from: ISODate): number {
  const dates = Array.from(new Set(data.journal.filter((e) => e.date >= from).map((e) => e.date))).sort();
  return [from, ...dates].reduce((min, d) => Math.min(min, cashBalanceOf(data, code, d)), Number.POSITIVE_INFINITY);
}

// ---------------- โอนเงิน ----------------

/** ชื่อรายการโอน: เข้าเงินสดย่อย = เบิกชดเชยเงินสดย่อย */
export function transferTitle(t: Pick<BankTransfer, 'fromAccountCode' | 'toAccountCode'>, data?: Pick<AccountingData, 'bankAccounts'>): string {
  const toPetty = data ? isPettyCashAccount(data, t.toAccountCode) : false;
  return toPetty ? 'เบิกชดเชยเงินสดย่อย' : 'โอนเงินระหว่างบัญชี';
}

// ---------------- รายการเคลื่อนไหวในสมุด (ฝั่งบัญชี) ----------------

export type BankMovement = {
  journalId: string;
  docNo: string;
  sourceDocNo?: string;
  date: ISODate;
  description: string;
  /** บวก = เงินเข้า (เดบิต), ลบ = เงินออก (เครดิต) */
  amount: number;
};

/** รายการเคลื่อนไหวของบัญชี `code` ทุกรายการ (ไม่รวมรายการที่ยอดสุทธิเป็นศูนย์) เรียงตามวันที่/เลขที่ */
export function bankMovements(data: Pick<AccountingData, 'journal'>, code: string): BankMovement[] {
  return data.journal
    .map((e) => ({
      journalId: e.id,
      docNo: e.docNo,
      sourceDocNo: e.sourceDocNo,
      date: e.date,
      description: e.description,
      amount: movementOf(e, code),
    }))
    .filter((m) => toSatang(m.amount) !== 0)
    .sort((a, b) => (a.date + a.docNo).localeCompare(b.date + b.docNo));
}

export function statementLinesOf(data: Pick<AccountingData, 'bankStatements'>, code: string): BankStatementLine[] {
  return data.bankStatements
    .filter((l) => l.accountCode === code)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function matchesOf(data: Pick<AccountingData, 'bankMatches'>, code: string): BankMatch[] {
  return data.bankMatches.filter((m) => m.accountCode === code);
}

/** map: รหัสรายการ statement / รายการบัญชี → การจับคู่ที่ใช้อยู่ (ของบัญชี `code`) */
export function matchIndex(data: Pick<AccountingData, 'bankMatches'>, code: string) {
  const byLine = new Map<string, BankMatch>();
  const byJournal = new Map<string, BankMatch>();
  matchesOf(data, code).forEach((m) => {
    m.statementLineIds.forEach((id) => byLine.set(id, m));
    m.journalIds.forEach((id) => byJournal.set(id, m));
  });
  return { byLine, byJournal };
}

/**
 * ตรวจการจับคู่ด้วยมือ/อัตโนมัติ — คืนข้อความปัญหา หรือ null ถ้าจับคู่ได้
 * กติกา: บัญชีธนาคารที่ลงทะเบียน, ทั้งสองฝั่งมีอย่างน้อย 1 รายการ, ทุกรายการเป็นของบัญชีนี้และยังไม่ถูกจับคู่,
 * ยอดรวม statement = ยอดรวมรายการเคลื่อนไหวในสมุด (สตางค์)
 */
export function bankMatchProblem(
  data: Pick<AccountingData, 'bankAccounts' | 'bankStatements' | 'bankMatches' | 'journal'>,
  input: { accountCode: string; statementLineIds: string[]; journalIds: string[] },
  ignoreMatchId?: string
): string | null {
  const bank = bankAccountOf(data, input.accountCode);
  if (!bank || bank.kind !== 'bank') return `บัญชี ${input.accountCode} ไม่ใช่บัญชีธนาคารที่ลงทะเบียน`;
  if (!input.statementLineIds.length || !input.journalIds.length) return 'เลือกรายการ statement และรายการในสมุดบัญชีอย่างน้อยฝั่งละ 1 รายการ';
  if (new Set(input.statementLineIds).size !== input.statementLineIds.length || new Set(input.journalIds).size !== input.journalIds.length) {
    return 'เลือกรายการซ้ำ';
  }
  const lines = new Map(data.bankStatements.map((l) => [l.id, l]));
  const entries = new Map(data.journal.map((e) => [e.id, e]));
  const others = data.bankMatches.filter((m) => m.id !== ignoreMatchId && m.accountCode === input.accountCode);
  const usedLines = new Set(others.flatMap((m) => m.statementLineIds));
  const usedJournal = new Set(others.flatMap((m) => m.journalIds));

  let statementSum = 0;
  for (let i = 0; i < input.statementLineIds.length; i += 1) {
    const line = lines.get(input.statementLineIds[i]);
    if (!line || line.accountCode !== input.accountCode) return 'ไม่พบรายการ statement ของบัญชีนี้';
    if (usedLines.has(line.id)) return `รายการ statement ${line.description || line.date} จับคู่ไปแล้ว`;
    statementSum += toSatang(line.amount);
  }
  let bookSum = 0;
  for (let i = 0; i < input.journalIds.length; i += 1) {
    const entry = entries.get(input.journalIds[i]);
    const amount = entry ? toSatang(movementOf(entry, input.accountCode)) : 0;
    if (!entry || amount === 0) return 'ไม่พบรายการเคลื่อนไหวของบัญชีนี้ในสมุดบัญชี';
    if (usedJournal.has(entry.id)) return `${entry.docNo} จับคู่ไปแล้ว`;
    bookSum += amount;
  }
  if (statementSum !== bookSum) {
    return `ยอดไม่เท่ากัน: statement ${fromSatang(statementSum).toFixed(2)} ≠ สมุดบัญชี ${fromSatang(bookSum).toFixed(2)}`;
  }
  return null;
}

/**
 * ข้อเสนอจับคู่อัตโนมัติแบบ 1 ต่อ 1: ยอดเท่ากัน (สตางค์) และวันที่ห่างกันไม่เกิน `windowDays` วัน
 * ไล่ statement ตามวันที่ เลือกรายการในสมุดที่วันที่ใกล้ที่สุด (เท่ากัน = เลขที่น้อยกว่า) และใช้ได้ครั้งเดียว
 */
export function autoMatchProposals(
  lines: BankStatementLine[],
  movements: BankMovement[],
  windowDays = 3
): { statementLineId: string; journalId: string }[] {
  const used = new Set<string>();
  const out: { statementLineId: string; journalId: string }[] = [];
  lines
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .forEach((line) => {
      const amount = toSatang(line.amount);
      const best = movements
        .filter((m) => !used.has(m.journalId) && toSatang(m.amount) === amount)
        .map((m) => ({ m, gap: Math.abs(diffDays(m.date, line.date)) }))
        .filter((c) => c.gap <= windowDays)
        .sort((a, b) => a.gap - b.gap || a.m.docNo.localeCompare(b.m.docNo))[0];
      if (!best) return;
      used.add(best.m.journalId);
      out.push({ statementLineId: line.id, journalId: best.m.journalId });
    });
  return out;
}

/** รายการที่ยังไม่ถูกจับคู่ (ทั้งสองฝั่ง) ของบัญชี — ใช้กับ `autoMatchProposals` */
export function unmatchedItems(data: AccountingData, code: string) {
  const { byLine, byJournal } = matchIndex(data, code);
  return {
    lines: statementLinesOf(data, code).filter((l) => !byLine.has(l.id)),
    movements: bankMovements(data, code).filter((m) => !byJournal.has(m.journalId)),
  };
}

// ---------------- รายงานกระทบยอด ----------------

export type BankReconciliation = {
  asOf: ISODate;
  /** ยอดตามบัญชี (สมุด) ณ วันที่ */
  bookBalance: number;
  /** รายการในสมุดที่ธนาคารยังไม่ผ่านรายการ ณ วันที่ (เช็คค้างจ่าย / เงินฝากระหว่างทาง) */
  outstanding: BankMovement[];
  /** รายการใน statement ที่ยังไม่ได้ลงบัญชี ณ วันที่ (ค่าธรรมเนียม ดอกเบี้ย เงินโอนเข้าที่ยังไม่ออกใบเสร็จ) */
  unbooked: BankStatementLine[];
  /** ยอดที่ statement ควรเป็น = ยอดตามบัญชี − รายการค้างในสมุด + รายการค้างใน statement */
  expectedStatementBalance: number;
  /** ยอดคงเหลือตาม statement (รายการล่าสุด ณ วันที่ที่มียอดคงเหลือ) */
  statementBalance?: number;
  /** ผลต่าง statement − ยอดที่ควรเป็น (0 = กระทบยอดลง) */
  difference?: number;
  matchedCount: number;
};

/**
 * รายงานกระทบยอดธนาคาร ณ วันที่ `asOf` (ยอดธนาคาร vs ยอดตามบัญชี พร้อมรายการค้าง)
 * รายการก่อน `reconcileFrom` ของบัญชีถือว่ากระทบยอดแล้ว — รายการที่จับคู่กับอีกฝั่งที่ลงวันที่หลัง `asOf` ยังนับเป็นรายการค้าง
 */
export function bankReconciliation(data: AccountingData, code: string, asOf: ISODate, statementBalanceInput?: number): BankReconciliation {
  const from = bankAccountOf(data, code)?.reconcileFrom;
  const inRange = (d: ISODate) => d <= asOf && (!from || d >= from);
  const lines = statementLinesOf(data, code);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const movements = bankMovements(data, code);
  const movementById = new Map(movements.map((m) => [m.journalId, m]));
  const { byLine, byJournal } = matchIndex(data, code);

  // จับคู่แล้ว "ณ วันที่" ก็ต่อเมื่ออีกฝั่งทุกรายการลงวันที่ไม่หลัง asOf
  const sideCleared = (dates: (ISODate | undefined)[]) => dates.every((d) => !!d && d <= asOf);
  const outstanding = movements.filter((m) => {
    if (!inRange(m.date)) return false;
    const match = byJournal.get(m.journalId);
    return !match || !sideCleared(match.statementLineIds.map((id) => lineById.get(id)?.date));
  });
  const unbooked = lines.filter((l) => {
    if (!inRange(l.date)) return false;
    const match = byLine.get(l.id);
    return !match || !sideCleared(match.journalIds.map((id) => movementById.get(id)?.date));
  });

  const bookBalance = cashBalanceOf(data, code, asOf);
  const expectedStatementBalance = round2(
    bookBalance - sumBaht(outstanding.map((m) => m.amount)) + sumBaht(unbooked.map((l) => l.amount))
  );
  const lastWithBalance = lines.filter((l) => l.date <= asOf && l.balance !== undefined).slice(-1)[0];
  const statementBalance = statementBalanceInput ?? lastWithBalance?.balance;
  return {
    asOf,
    bookBalance,
    outstanding,
    unbooked,
    expectedStatementBalance,
    statementBalance,
    difference: statementBalance === undefined ? undefined : round2(statementBalance - expectedStatementBalance),
    matchedCount: matchesOf(data, code).length,
  };
}

/** สรุปต่อบัญชี (หน้าภาพรวมธนาคาร): ยอดตามบัญชี, รายการ statement ที่ยังไม่จับคู่, รายการในสมุดที่ยังไม่จับคู่ */
export function bankAccountSummary(data: AccountingData, code: string, asOf: ISODate) {
  const { lines, movements } = unmatchedItems(data, code);
  const from = bankAccountOf(data, code)?.reconcileFrom;
  return {
    balance: cashBalanceOf(data, code, asOf),
    unmatchedStatement: lines.length,
    unmatchedBook: movements.filter((m) => !from || m.date >= from).length,
  };
}
