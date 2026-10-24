import { demo } from '../../store/__tests__/fixtures';
import { quotationTotals, quotationValidUntil, QUOTATION_STATUS_LABEL, quotationConvertProblem } from '../quotation';
import {
  readStatementCsv,
  mapStatementRows,
  parseStatementDate,
  parseStatementAmount,
  guessStatementMapping,
} from '../bank-statement-import';
import {
  contactMatches,
  filterContacts,
  isSubmitShortcut,
  contactCodePrefix,
  lastReceiptWhtRate,
  shouldAppendLineOnEnter,
} from '../quick-entry';
import {
  bankMovements,
  transferTitle,
  cashAccountsOf,
  isBankKindCode,
  cashAccountLabel,
  minCashBalanceFrom,
  autoMatchProposals,
  bankAccountSummary,
  nextBankAccountCode,
} from '../bank';

import type { Contact, BankStatementLine } from '../types';

// ----------------------------------------------------------------------

describe('bank statement CSV import', () => {
  it('parses Thai bank amounts', () => {
    expect(parseStatementAmount('1,234.50')).toBe(1234.5);
    expect(parseStatementAmount('-1,234.50')).toBe(-1234.5);
    expect(parseStatementAmount('(500.00)')).toBe(-500);
    expect(parseStatementAmount('500.00-')).toBe(-500);
    expect(parseStatementAmount('฿ 2,000')).toBe(2000);
    expect(parseStatementAmount('+12.345')).toBe(12.35);
    expect(parseStatementAmount('')).toBeNull();
    expect(parseStatementAmount('-')).toBeNull();
    expect(parseStatementAmount(undefined)).toBeNull();
    expect(parseStatementAmount('abc')).toBeNaN();
  });

  it('parses Buddhist / Christian era dates in several shapes', () => {
    expect(parseStatementDate('24/10/2569')).toBe('2026-10-24');
    expect(parseStatementDate('24/10/69')).toBe('2026-10-24');
    expect(parseStatementDate('1-9-2026')).toBe('2026-09-01');
    expect(parseStatementDate('05.01.2570 09:15')).toBe('2027-01-05');
    expect(parseStatementDate('2026-10-24')).toBe('2026-10-24');
    expect(parseStatementDate('31/02/2569')).toBeNull();
    expect(parseStatementDate('ยอดยกมา')).toBeNull();
    expect(parseStatementDate(undefined)).toBeNull();
  });

  it('guesses columns from a KBank-style header with separate withdrawal / deposit columns', () => {
    const csv = [
      'วันที่ทำรายการ,เวลา,รายการ,ถอนเงิน,ฝากเงิน,ยอดคงเหลือ,ช่องทาง',
      ',,ยอดยกมา,,,"500,000.00",',
      '20/10/2569,10:01,รับโอนเงิน,,"102,440.00","602,440.00",K PLUS',
      '21/10/2569,11:15,ชำระค่าสินค้า,"14,550.00",,"587,890.00",K PLUS',
      'xx/10/2569,,ผิดรูปแบบ,1,,,',
      '22/10/2569,,ไม่มีจำนวนเงิน,,,,',
      '23/10/2569,,จำนวนผิด,abc,,,',
    ].join('\r\n');
    const { table, mapping } = readStatementCsv(csv);
    expect(mapping).toEqual({ hasHeader: true, date: 0, description: 2, withdrawal: 3, deposit: 4, balance: 5 });
    const result = mapStatementRows(table, mapping);
    expect(result.rows).toEqual([
      { date: '2026-10-20', description: 'รับโอนเงิน', amount: 102440, balance: 602440 },
      { date: '2026-10-21', description: 'ชำระค่าสินค้า', amount: -14550, balance: 587890 },
    ]);
    expect(result.errors).toEqual([
      { row: 5, message: 'วันที่ "xx/10/2569" อ่านไม่ได้' },
      { row: 6, message: 'จำนวนเงินเป็นศูนย์' },
      { row: 7, message: 'จำนวนเงินอ่านไม่ได้' },
    ]);
  });

  it('supports a single signed amount column and files without a header', () => {
    expect(guessStatementMapping(['Date', 'Description', 'Amount'])).toEqual({ hasHeader: true, date: 0, description: 1, amount: 2 });
    const table = [
      ['2026-10-01', 'Interest', '12.50'],
      ['2026-10-02', 'Fee', '-25'],
      ['2026-10-03', 'Bad', 'x'],
    ];
    const mapping = guessStatementMapping(table[0]);
    expect(mapping.hasHeader).toBe(false);
    const result = mapStatementRows(table, mapping);
    expect(result.rows.map((r) => r.amount)).toEqual([12.5, -25]);
    expect(result.errors).toEqual([{ row: 3, message: 'จำนวนเงินอ่านไม่ได้' }]);
    expect(mapStatementRows([['2026-10-01', 'x']], { hasHeader: false, date: 0, description: 1 }).errors).toHaveLength(1);
    expect(mapStatementRows([['2026-10-01', 'x', '5']], { hasHeader: false, date: 0, description: 1, deposit: 2 }).rows[0].amount).toBe(5);
  });
});

// ----------------------------------------------------------------------

const line = (id: string, date: string, amount: number): BankStatementLine => ({
  id,
  accountCode: '1120',
  date,
  description: id,
  amount,
  createdAt: '',
});

describe('bank helpers', () => {
  it('allocates bank / petty cash codes inside their ranges', () => {
    expect(nextBankAccountCode([{ code: '1120' }], 'bank')).toBe('1121');
    expect(nextBankAccountCode([{ code: '1110' }], 'petty-cash')).toBe('1111');
    expect(nextBankAccountCode([{ code: '1111' }, { code: '1112' }], 'petty-cash')).toBe('1113');
    expect(isBankKindCode('1120', 'bank')).toBe(true);
    expect(isBankKindCode('1110', 'petty-cash')).toBe(false);
    expect(cashAccountLabel({ code: '1120', name: 'เงินฝากธนาคาร' }, { bankName: 'กสิกรไทย', accountNo: '123' })).toBe('1120 เงินฝากธนาคาร · กสิกรไทย 123');
    expect(cashAccountLabel({ code: '1110', name: 'เงินสด' })).toBe('1110 เงินสด');
    const data = demo();
    expect(cashAccountsOf(data).map((a) => a.code)).toEqual(['1110', '1111', '1120']);
    expect(transferTitle({ fromAccountCode: '1120', toAccountCode: '1111' }, data)).toBe('เบิกชดเชยเงินสดย่อย');
    expect(transferTitle({ fromAccountCode: '1120', toAccountCode: '1110' }, data)).toBe('โอนเงินระหว่างบัญชี');
    expect(transferTitle({ fromAccountCode: '1120', toAccountCode: '1111' })).toBe('โอนเงินระหว่างบัญชี');
  });

  it('auto-match proposals pick the closest date, one-to-one, inside the window', () => {
    const movements = [
      { journalId: 'a', docNo: 'JV1', date: '2026-10-10', description: '', amount: 100 },
      { journalId: 'b', docNo: 'JV2', date: '2026-10-12', description: '', amount: 100 },
      { journalId: 'c', docNo: 'JV3', date: '2026-10-01', description: '', amount: -50 },
    ];
    const lines = [line('s1', '2026-10-12', 100), line('s2', '2026-10-11', 100), line('s3', '2026-10-09', -50), line('s4', '2026-10-11', 100)];
    expect(autoMatchProposals(lines, movements)).toEqual([
      // ไล่ตามวันที่ statement: s2 (11 ต.ค.) ห่าง a/b เท่ากัน → เลขที่น้อยกว่า, s4 ได้ b, s1 ไม่เหลือคู่
      { statementLineId: 's2', journalId: 'a' },
      { statementLineId: 's4', journalId: 'b' },
    ]);
    expect(autoMatchProposals(lines, movements, 10)).toContainEqual({ statementLineId: 's3', journalId: 'c' });
  });

  it('minimum balance from a date looks at every later day', () => {
    const data = demo();
    expect(minCashBalanceFrom(data, '1120', '2026-10-17')).toBe(bankMovements(data, '1120').filter((m) => m.date <= '2026-10-18').reduce((a, m) => a + m.amount, 0));
    const summary = bankAccountSummary(data, '1120', '2026-10-24');
    expect(summary.unmatchedStatement).toBe(0);
    expect(summary.unmatchedBook).toBe(bankMovements(data, '1120').length);
  });
});

// ----------------------------------------------------------------------

describe('quick entry helpers (B10/B11)', () => {
  const contacts = demo().contacts as Contact[];

  it('searches contacts by code, name and tax id', () => {
    const abc = contacts.find((c) => c.code === 'C0001') as Contact;
    expect(contactMatches(abc, 'c0001')).toBe(true);
    expect(contactMatches(abc, 'เอบีซี')).toBe(true);
    expect(contactMatches(abc, '0-1055-65012-34-1')).toBe(true);
    expect(contactMatches(abc, 'ไทยรุ่ง')).toBe(false);
    expect(contactMatches(abc, ' ')).toBe(true);
    expect(filterContacts(contacts, 'v000').map((c) => c.code)).toEqual(['V0001', 'V0002', 'V0003', 'V0004']);
    expect(filterContacts(contacts, 'สมชาย').map((c) => c.code)).toEqual(['V0003']);
    expect(filterContacts(contacts, '', 2)).toHaveLength(2);
    // รหัสตรงตัวมาก่อนชื่อที่มีคำค้น
    const named = [{ ...abc, id: 'x', code: 'C0100', name: 'C0002 ร้านค้า' }, ...contacts];
    expect(filterContacts(named, 'C0002')[0].code).toBe('C0002');
    expect(contactCodePrefix('vendor')).toBe('V');
    expect(contactCodePrefix('both')).toBe('C');
  });

  it('remembers the WHT rate a customer withheld last time', () => {
    const data = demo();
    expect(lastReceiptWhtRate(data, 'c-thairung', [0, 1, 2, 3, 5])).toBe(3);
    // ยอดหักไม่ตรงอัตราใดเลย (ผู้ใช้แก้ตาม 50 ทวิ) = ไม่เดา
    expect(lastReceiptWhtRate(data, 'c-abc', [0, 1, 2, 3, 5])).toBeUndefined();
    expect(lastReceiptWhtRate(data, 'c-nakhon', [0, 3])).toBeUndefined();
    const orphan = { ...data, sales: [] };
    expect(lastReceiptWhtRate(orphan, 'c-thairung', [3])).toBeUndefined();
  });

  it('keyboard rules: Ctrl/⌘+Enter submits, plain Enter on the last row appends a line', () => {
    expect(isSubmitShortcut({ key: 'Enter', ctrlKey: true })).toBe(true);
    expect(isSubmitShortcut({ key: 'Enter', metaKey: true })).toBe(true);
    expect(isSubmitShortcut({ key: 'Enter' })).toBe(false);
    expect(isSubmitShortcut({ key: 'Enter', ctrlKey: true, altKey: true })).toBe(false);
    expect(shouldAppendLineOnEnter({ key: 'Enter' }, 2, 3, true)).toBe(true);
    expect(shouldAppendLineOnEnter({ key: 'Enter' }, 1, 3, true)).toBe(false);
    expect(shouldAppendLineOnEnter({ key: 'Enter' }, 2, 3, false)).toBe(false);
    expect(shouldAppendLineOnEnter({ key: 'Enter', ctrlKey: true }, 2, 3, true)).toBe(false);
    expect(shouldAppendLineOnEnter({ key: 'Tab' }, 2, 3, true)).toBe(false);
  });
});

describe('quotation helpers', () => {
  it('computes validity, totals and conversion problems', () => {
    const q = demo().quotations[0];
    expect(quotationValidUntil(q)).toBe('2026-11-01');
    expect(quotationTotals(q).total).toBe(calcTotal(q.lines));
    expect(quotationConvertProblem(q, '2026-10-24')).toBeNull();
    expect(quotationConvertProblem({ ...q, convertedSalesId: 'x' }, '2026-10-24')).toMatch(/ออกเอกสารขายไปแล้ว/);
    expect(QUOTATION_STATUS_LABEL.converted).toBe('ออกเอกสารขายแล้ว');
  });
});

function calcTotal(lines: { qty: number; unitPrice: number; discount: number }[]) {
  const net = lines.reduce((a, l) => a + l.qty * l.unitPrice - l.discount, 0);
  return Math.round(net * 107) / 100;
}
