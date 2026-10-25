import type { AccountingData } from 'src/domain';

import {
  ACC,
  isBalanced,
  cashBalanceOf,
  isCashAccount,
  bankMovements,
  nextContactCode,
  purchaseVatReport,
  quotationStatusOf,
  bankReconciliation,
  quotationToSalesDraft,
  validateAccountingData,
} from 'src/domain';

import { emptyData } from '../seed';
import { ln, demo, TODAY } from './fixtures';
import {
  uid,
  lockPeriod,
  saveContact,
  unmatchBank,
  payPurchase,
  autoMatchBank,
  saveQuotation,
  transferFunds,
  addBankAccount,
  receivePayment,
  recordPurchase,
  matchBankItems,
  issueTaxInvoice,
  BusinessRuleError,
  updateBankAccount,
  setQuotationStatus,
  issueFromQuotation,
  setOpeningBalances,
  addBankStatementLines,
  PETTY_CASH_PAYEE_CODE,
  recordPettyCashExpense,
  deleteBankStatementLines,
} from '../actions';

// ----------------------------------------------------------------------
// Sprint B batch 4 — B9 ธนาคารหลายบัญชี / โอนเงิน / เงินสดย่อย / กระทบยอด, ใบเสนอราคา, รหัสผู้ติดต่อถัดไป
// ----------------------------------------------------------------------

const expectValid = (state: AccountingData) => expect(validateAccountingData(state)).toEqual([]);

const rule = (fn: () => unknown, message: RegExp) => {
  expect(fn).toThrow(BusinessRuleError);
  expect(fn).toThrow(message);
};

/** ข้อมูลตัวอย่าง + บัญชีธนาคารที่สอง (SCB 1121) */
function withScb(state: AccountingData = demo()) {
  return addBankAccount(state, { kind: 'bank', bankName: 'ธนาคารไทยพาณิชย์', accountNo: '987-6-54321-0' });
}

describe('B9 bank accounts', () => {
  it('adds a bank account as a new 112x GL account that receipts can deposit into', () => {
    const { state, bank } = withScb();
    expect(bank).toEqual({ accountCode: '1121', kind: 'bank', bankName: 'ธนาคารไทยพาณิชย์', accountNo: '987-6-54321-0' });
    const account = state.accounts.find((a) => a.code === '1121');
    expect(account).toMatchObject({ type: 'asset', name: 'เงินฝากธนาคาร ธนาคารไทยพาณิชย์ 987-6-54321-0' });
    expect(isCashAccount(account)).toBe(true);
    const invoice = state.sales.find((s) => s.docNo === 'IV6910-0003');
    if (!invoice) throw new Error('fixture');
    const r = receivePayment(state, { invoiceId: invoice.id, date: TODAY, amount: 1000, whtAmount: 0, depositAccountCode: '1121' });
    expect(cashBalanceOf(r.state, '1121')).toBe(1000);
    expectValid(r.state);
  });

  it('allocates codes in order, rejects duplicates, missing names and a full range', () => {
    let { state } = withScb();
    rule(() => withScb(state), /ลงทะเบียนแล้ว/);
    rule(() => addBankAccount(state, { kind: 'bank', bankName: '', accountNo: '1' }), /ชื่อธนาคาร/);
    rule(() => addBankAccount(state, { kind: 'petty-cash', bankName: ' ', accountNo: '' }), /ผู้ถือเงินสดย่อย/);
    const petty = addBankAccount(state, { kind: 'petty-cash', bankName: 'ฝ่ายผลิต', accountNo: '' });
    expect(petty.bank.accountCode).toBe('1112');
    for (let i = 2; i <= 9; i += 1) ({ state } = addBankAccount(state, { kind: 'bank', bankName: `B${i}`, accountNo: `${i}` }));
    expect(state.bankAccounts.filter((b) => b.kind === 'bank').map((b) => b.accountCode).slice(-1)).toEqual(['1129']);
    rule(() => addBankAccount(state, { kind: 'bank', bankName: 'B10', accountNo: '10' }), /ไม่เกิน 9 บัญชี/);
    expectValid(state);
  });

  it('updates bank details without touching the ledger', () => {
    const data = demo();
    const next = updateBankAccount(data, ACC.bank, { bankName: 'กรุงเทพ', accountNo: '111', branch: '', reconcileFrom: '2026-10-01' });
    expect(next.bankAccounts.find((b) => b.accountCode === ACC.bank)).toEqual({
      accountCode: ACC.bank,
      kind: 'bank',
      bankName: 'กรุงเทพ',
      accountNo: '111',
      reconcileFrom: '2026-10-01',
    });
    expect(next.journal).toBe(data.journal);
    expect(updateBankAccount(next, ACC.bank, { reconcileFrom: '', branch: 'สีลม' }).bankAccounts[1]).toMatchObject({ branch: 'สีลม' });
    expect(updateBankAccount(next, ACC.bank, { reconcileFrom: '' }).bankAccounts[1].reconcileFrom).toBeUndefined();
    rule(() => updateBankAccount(next, ACC.bank, { reconcileFrom: '2569-10-01' }), /วันที่เริ่มกระทบยอด/);
    rule(() => updateBankAccount(next, ACC.cash, { bankName: 'x' }), /ไม่พบบัญชี/);
  });
});

describe('B9 transfers between own accounts', () => {
  it('posts a balanced TR transfer Dr destination / Cr source', () => {
    const { state } = withScb();
    const r = transferFunds(state, { date: TODAY, fromAccountCode: ACC.bank, toAccountCode: '1121', amount: 50000, note: 'แยกบัญชีเงินเดือน' });
    expect(r.transfer.docNo).toBe('TR6910-0001');
    const entry = r.state.journal.find((e) => e.id === r.transfer.journalId);
    expect(entry && isBalanced(entry.lines)).toBe(true);
    expect(entry?.source).toBe('transfer');
    expect(entry?.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['1121', 50000, 0],
      [ACC.bank, 0, 50000],
    ]);
    expect(cashBalanceOf(r.state, '1121')).toBe(50000);
    expect(cashBalanceOf(r.state, ACC.bank)).toBe(cashBalanceOf(state, ACC.bank) - 50000);
    expectValid(r.state);
  });

  it('rejects same account, zero, non-cash accounts, locked periods and back-dated numbers', () => {
    const data = demo();
    const base = { date: TODAY, fromAccountCode: ACC.bank, toAccountCode: ACC.cash, amount: 100 };
    rule(() => transferFunds(data, { ...base, toAccountCode: ACC.bank }), /ต้องต่างกัน/);
    rule(() => transferFunds(data, { ...base, amount: 0 }), /มากกว่า 0/);
    rule(() => transferFunds(data, { ...base, toAccountCode: ACC.receivable }), /ใช้รับ\/จ่ายเงินไม่ได้/);
    rule(() => transferFunds(lockPeriod(data, '2026-09-30', TODAY), { ...base, date: '2026-09-15' }), /ปิดงวด/);
    const first = transferFunds(data, base).state;
    rule(() => transferFunds(first, { ...base, date: '2026-10-20' }), /เรียงตามวันที่/);
  });

  it('flags a transfer whose journal entry was altered', () => {
    const r = transferFunds(demo(), { date: TODAY, fromAccountCode: ACC.bank, toAccountCode: ACC.cash, amount: 100 });
    const tampered = { ...r.state, transfers: r.state.transfers.map((t) => ({ ...t, amount: 200 })) };
    expect(validateAccountingData(tampered).join()).toMatch(/ยอดในเอกสารไม่ตรงกับรายการบัญชี/);
    const same = { ...r.state, transfers: r.state.transfers.map((t) => ({ ...t, toAccountCode: ACC.bank })) };
    expect(validateAccountingData(same).join()).toMatch(/บัญชีเดียวกัน/);
  });
});

describe('B9 petty cash', () => {
  /** เบิกชดเชยเงินสดย่อย 5,000 จากธนาคาร */
  const toppedUp = () => transferFunds(demo(), { date: TODAY, fromAccountCode: ACC.bank, toAccountCode: ACC.pettyCash, amount: 5000 });

  it('tops up from the bank, then records an expense voucher with an input VAT claim', () => {
    const top = toppedUp();
    expect(top.state.journal.slice(-1)[0].description).toMatch(/เบิกชดเชยเงินสดย่อย/);
    const r = recordPettyCashExpense(top.state, {
      pettyAccountCode: ACC.pettyCash,
      date: TODAY,
      contactId: 'v-resin',
      vatMode: 'exclusive',
      claimVat: true,
      supplierInvoiceNo: 'TP-CASH-01',
      supplierInvoiceDate: TODAY,
      vatClaimPeriod: '2026-10',
      lines: [{ description: 'น้ำมันหล่อลื่นเครื่องฉีด', accountCode: ACC.supplies, amount: 500 }],
    });
    expect(r.payment?.accountCode).toBe(ACC.pettyCash);
    expect(r.payment?.amount).toBe(535);
    expect(r.payment?.whtAmount).toBe(0);
    expect(r.doc.paid).toBe(true);
    expect(cashBalanceOf(r.state, ACC.pettyCash)).toBe(4465);
    expect(purchaseVatReport(r.state.purchases, r.state.contacts, { year: 2026, month: 10 }).some((x) => x.vat === 35)).toBe(true);
    expectValid(r.state);
  });

  it('uses one general payee contact for expenses without a supplier', () => {
    const top = toppedUp();
    const input = {
      pettyAccountCode: ACC.pettyCash,
      date: TODAY,
      vatMode: 'none' as const,
      claimVat: false,
      lines: [{ description: 'ค่าแท็กซี่', accountCode: ACC.misc, amount: 120 }],
    };
    const first = recordPettyCashExpense(top.state, input);
    const second = recordPettyCashExpense(first.state, input);
    const payees = second.state.contacts.filter((c) => c.code === PETTY_CASH_PAYEE_CODE);
    expect(payees).toHaveLength(1);
    expect(second.doc.contactId).toBe(payees[0].id);
    expect(cashBalanceOf(second.state, ACC.pettyCash)).toBe(4760);
    expectValid(second.state);
  });

  it('refuses claims without a valid supplier, overdrafts and non-petty accounts', () => {
    const top = toppedUp();
    const base = {
      pettyAccountCode: ACC.pettyCash,
      date: TODAY,
      vatMode: 'exclusive' as const,
      claimVat: true,
      supplierInvoiceNo: 'X1',
      supplierInvoiceDate: TODAY,
      vatClaimPeriod: '2026-10',
      lines: [{ description: 'วัสดุ', accountCode: ACC.supplies, amount: 100 }],
    };
    rule(() => recordPettyCashExpense(top.state, base), /เลือกผู้ขาย/);
    const noTax = saveContact(top.state, { code: 'V0100', kind: 'vendor', legalForm: 'juristic', title: 'ร้าน', name: 'ไม่มีเลข', address: {}, creditDays: 0 });
    rule(() => recordPettyCashExpense(noTax.state, { ...base, contactId: noTax.contact.id }), /ม\.82\/5/);
    rule(() => recordPettyCashExpense(top.state, { ...base, claimVat: false, vatMode: 'none', lines: [{ ...base.lines[0], amount: 6000 }] }), /คงเหลือไม่พอ/);
    rule(() => recordPettyCashExpense(top.state, { ...base, pettyAccountCode: ACC.bank }), /ไม่ใช่เงินสดย่อย/);
    rule(() => recordPettyCashExpense(top.state, { ...base, lines: [] }), /อย่างน้อย 1 รายการ/);
    rule(() => recordPettyCashExpense(top.state, { ...base, lines: [{ ...base.lines[0], amount: 0 }] }), /มากกว่า 0/);
    // จ่ายเจ้าหนี้/โอนออกจากเงินสดย่อยเกินยอดก็ไม่ได้ (ยอดต้องไม่ติดลบในวันใดหลังจากนั้น)
    const open = top.state.purchases.find((p) => !p.paid);
    if (!open) throw new Error('fixture');
    rule(() => payPurchase(top.state, { purchaseId: open.id, date: TODAY, accountCode: ACC.pettyCash }), /คงเหลือไม่พอ/);
    rule(() => transferFunds(top.state, { date: TODAY, fromAccountCode: ACC.pettyCash, toAccountCode: ACC.bank, amount: 5000.01 }), /คงเหลือไม่พอ/);
    rule(() => transferFunds(top.state, { date: '2026-10-20', fromAccountCode: ACC.pettyCash, toAccountCode: ACC.bank, amount: 1 }), /คงเหลือไม่พอ|เรียงตามวันที่/);
  });
});

// ----------------------------------------------------------------------

describe('B9 bank reconciliation', () => {
  const data = () => demo();
  const STATEMENT = [
    // รับชำระ RE6910-0001 (102,440 วันที่ 20) ธนาคารเข้า 21
    { date: '2026-10-21', description: 'โอนเข้า ไทยรุ่ง', amount: 102440 },
    // จ่าย PV6910-0002 (14,550 วันที่ 16) ธนาคารตัด 16
    { date: '2026-10-16', description: 'โอนออก สมชาย', amount: -14550 },
    // จ่าย PV6910-0001 (28,500 วันที่ 5) แต่ธนาคารตัด 12 → นอกช่วง 3 วัน
    { date: '2026-10-12', description: 'เช็คค่าเช่า', amount: -28500 },
    // ค่าธรรมเนียมที่ยังไม่ได้ลงบัญชี
    { date: '2026-10-22', description: 'ค่าธรรมเนียมโอน', amount: -25, balance: 1000000 },
  ];

  it('imports statement lines and skips exact duplicates on re-import', () => {
    const first = addBankStatementLines(data(), { accountCode: ACC.bank, lines: STATEMENT, imported: true });
    expect([first.added, first.skipped]).toEqual([4, 0]);
    expect(new Set(first.state.bankStatements.map((l) => l.batchId)).size).toBe(1);
    const again = addBankStatementLines(first.state, { accountCode: ACC.bank, lines: [...STATEMENT, { date: '2026-10-23', description: 'ดอกเบี้ย', amount: 12.5 }] });
    expect([again.added, again.skipped]).toEqual([1, 4]);
    rule(() => addBankStatementLines(data(), { accountCode: ACC.pettyCash, lines: STATEMENT }), /ไม่ใช่บัญชีธนาคาร/);
    rule(() => addBankStatementLines(data(), { accountCode: ACC.bank, lines: [] }), /ไม่มีรายการ/);
    rule(() => addBankStatementLines(data(), { accountCode: ACC.bank, lines: [{ ...STATEMENT[0], date: '21/10/2569' }] }), /วันที่/);
    rule(() => addBankStatementLines(data(), { accountCode: ACC.bank, lines: [{ ...STATEMENT[0], amount: 0 }] }), /ไม่เป็นศูนย์/);
    rule(() => addBankStatementLines(data(), { accountCode: ACC.bank, lines: [{ ...STATEMENT[0], balance: Number.NaN }] }), /ยอดคงเหลือ/);
    expectValid(again.state);
  });

  it('auto-matches equal amounts within the date window, leaves the rest for manual matching', () => {
    const imported = addBankStatementLines(data(), { accountCode: ACC.bank, lines: STATEMENT }).state;
    const auto = autoMatchBank(imported, ACC.bank);
    expect(auto.matched).toBe(2);
    const docs = auto.state.bankMatches.map((m) => auto.state.journal.find((e) => e.id === m.journalIds[0])?.sourceDocNo).sort();
    expect(docs).toEqual(['PV6910-0002', 'RE6910-0001']);
    expect(auto.state.bankMatches.every((m) => m.auto)).toBe(true);
    // เรียกซ้ำไม่จับคู่ซ้ำ
    expect(autoMatchBank(auto.state, ACC.bank).matched).toBe(0);
    expectValid(auto.state);

    // จับคู่เช็คค่าเช่าด้วยมือ (วันที่ห่างเกิน 3 วัน)
    const cheque = auto.state.bankStatements.find((l) => l.description === 'เช็คค่าเช่า');
    const pv = bankMovements(auto.state, ACC.bank).find((m) => m.sourceDocNo === 'PV6910-0001');
    if (!cheque || !pv) throw new Error('fixture');
    const manual = matchBankItems(auto.state, { accountCode: ACC.bank, statementLineIds: [cheque.id], journalIds: [pv.journalId] });
    expect(manual.match.auto).toBe(false);
    expectValid(manual.state);
    rule(() => matchBankItems(manual.state, { accountCode: ACC.bank, statementLineIds: [cheque.id], journalIds: [pv.journalId] }), /จับคู่ไปแล้ว/);
    rule(() => deleteBankStatementLines(manual.state, [cheque.id]), /ยกเลิกการจับคู่ก่อน/);
    const undone = unmatchBank(manual.state, manual.match.id);
    expect(undone.bankMatches).toHaveLength(2);
    expect(deleteBankStatementLines(undone, [cheque.id]).bankStatements).toHaveLength(3);
    rule(() => unmatchBank(undone, 'nope'), /ไม่พบการจับคู่/);
    rule(() => autoMatchBank(undone, ACC.cash), /ไม่ใช่บัญชีธนาคาร/);
  });

  it('matches one statement line against several book movements when the sums agree', () => {
    const base = data();
    const movements = bankMovements(base, ACC.bank).filter((m) => ['PV6910-0002', 'PV6910-0003'].includes(m.sourceDocNo ?? ''));
    const lumped = addBankStatementLines(base, { accountCode: ACC.bank, lines: [{ date: '2026-10-18', description: 'ตัดจ่ายรวม', amount: -37870 }] });
    const line = lumped.state.bankStatements[0];
    const ok = matchBankItems(lumped.state, { accountCode: ACC.bank, statementLineIds: [line.id], journalIds: movements.map((m) => m.journalId) });
    expectValid(ok.state);
    rule(
      () => matchBankItems(lumped.state, { accountCode: ACC.bank, statementLineIds: [line.id], journalIds: [movements[0].journalId] }),
      /ยอดไม่เท่ากัน/
    );
    rule(() => matchBankItems(lumped.state, { accountCode: ACC.bank, statementLineIds: [], journalIds: [movements[0].journalId] }), /อย่างน้อยฝั่งละ 1/);
    rule(() => matchBankItems(lumped.state, { accountCode: ACC.bank, statementLineIds: [line.id, line.id], journalIds: [movements[0].journalId] }), /ซ้ำ/);
    rule(() => matchBankItems(lumped.state, { accountCode: ACC.bank, statementLineIds: ['x'], journalIds: [movements[0].journalId] }), /ไม่พบรายการ statement/);
    const sales = lumped.state.journal.find((e) => e.source === 'sales');
    rule(() => matchBankItems(lumped.state, { accountCode: ACC.bank, statementLineIds: [line.id], journalIds: [sales?.id ?? ''] }), /ไม่พบรายการเคลื่อนไหว/);
  });

  it('reports book vs bank balance with outstanding items and statement-only items', () => {
    let { state } = addBankStatementLines(data(), { accountCode: ACC.bank, lines: STATEMENT });
    ({ state } = autoMatchBank(state, ACC.bank));
    state = updateBankAccount(state, ACC.bank, { reconcileFrom: '2026-10-01' });
    const rec = bankReconciliation(state, ACC.bank, TODAY);
    expect(rec.bookBalance).toBe(cashBalanceOf(state, ACC.bank, TODAY));
    // ค้างในสมุด: PV6910-0001 (เช็คยังไม่จับคู่), PV6910-0003 — รายการก่อน 1 ต.ค. ถือว่ากระทบยอดแล้ว
    expect(rec.outstanding.map((m) => m.sourceDocNo)).toEqual(['PV6910-0001', 'PV6910-0003']);
    expect(rec.unbooked.map((l) => l.description)).toEqual(['เช็คค่าเช่า', 'ค่าธรรมเนียมโอน']);
    expect(rec.expectedStatementBalance).toBe(rec.bookBalance + 28500 + 23320 - 28500 - 25);
    expect(rec.statementBalance).toBe(1000000);
    expect(rec.difference).toBe(1000000 - rec.expectedStatementBalance);
    // ใส่ยอด statement เองได้ ผลต่าง = 0 เมื่อตรง
    expect(bankReconciliation(state, ACC.bank, TODAY, rec.expectedStatementBalance).difference).toBe(0);
    // ณ 20 ต.ค.: RE6910-0001 ยังไม่ผ่านธนาคาร (statement เข้า 21) จึงยังเป็นรายการค้าง
    const before = bankReconciliation(state, ACC.bank, '2026-10-20');
    expect(before.outstanding.map((m) => m.sourceDocNo)).toContain('RE6910-0001');
    expect(before.statementBalance).toBeUndefined();
    expect(before.difference).toBeUndefined();
  });

  it('flags tampered matches and statement lines on unregistered accounts', () => {
    let { state } = addBankStatementLines(data(), { accountCode: ACC.bank, lines: STATEMENT });
    ({ state } = autoMatchBank(state, ACC.bank));
    const wrongSum = { ...state, bankStatements: state.bankStatements.map((l) => (l.amount === 102440 ? { ...l, amount: 102441 } : l)) };
    expect(validateAccountingData(wrongSum).join()).toMatch(/ยอดไม่เท่ากัน/);
    const dupMatch = { ...state, bankMatches: [...state.bankMatches, { ...state.bankMatches[0], id: uid() }] };
    expect(validateAccountingData(dupMatch).join()).toMatch(/จับคู่ไปแล้ว/);
    const stray = { ...state, bankStatements: [...state.bankStatements, { ...state.bankStatements[0], id: uid(), accountCode: ACC.cash }] };
    expect(validateAccountingData(stray).join()).toMatch(/ไม่ใช่บัญชีธนาคารที่ลงทะเบียน/);
    const badRegistry = { ...state, bankAccounts: [...state.bankAccounts, { accountCode: ACC.receivable, kind: 'bank' as const, bankName: 'x', accountNo: '' }] };
    expect(validateAccountingData(badRegistry).join()).toMatch(/ไม่ใช่บัญชีเงินสด\/ธนาคาร/);
    const dupRegistry = { ...state, bankAccounts: [...state.bankAccounts, state.bankAccounts[1]] };
    expect(validateAccountingData(dupRegistry).join()).toMatch(/ลงทะเบียนซ้ำ/);
    const wrongKind = { ...state, bankAccounts: state.bankAccounts.map((b) => ({ ...b, kind: 'petty-cash' as const })) };
    expect(validateAccountingData(wrongKind).join()).toMatch(/รหัสไม่ตรงกับประเภท/);
  });
});

// ----------------------------------------------------------------------

describe('quotations', () => {
  const input = (state: AccountingData) => ({
    date: TODAY,
    validDays: 30,
    contactId: 'c-abc',
    vatMode: 'exclusive' as const,
    lines: [ln(10, 1500), ln(1, 2000, ACC.service)],
    note: 'ส่งมอบภายใน 7 วัน',
  });

  it('creates a QT without posting and stays editable until converted', () => {
    const data = demo();
    const r = saveQuotation(data, input(data));
    expect(r.quotation.docNo).toBe('QT6910-0003');
    expect(r.quotation.status).toBe('draft');
    expect(r.state.journal).toBe(data.journal);
    expectValid(r.state);

    const edited = saveQuotation(r.state, { ...input(data), id: r.quotation.id, date: '2026-10-30', lines: [ln(5, 1500)], note: '' });
    expect(edited.quotation.docNo).toBe('QT6910-0003');
    expect(edited.quotation.lines).toHaveLength(1);
    expect(edited.quotation.note).toBeUndefined();
    expect(edited.state.sequences.QT6910).toBe(3);
    expectValid(edited.state);
    rule(() => saveQuotation(r.state, { ...input(data), id: r.quotation.id, date: '2026-11-02' }), /ภายในเดือนเดียวกัน/);
    rule(() => saveQuotation(r.state, { ...input(data), id: 'nope' }), /ไม่พบใบเสนอราคา/);
    rule(() => saveQuotation(r.state, { ...input(data), contactId: 'v-resin' }), /ผู้ขายเท่านั้น/);
    rule(() => saveQuotation(r.state, { ...input(data), validDays: 1.5 }), /0–365 วัน/);
    rule(() => saveQuotation(r.state, { ...input(data), lines: [ln(1, 100, ACC.cogs)] }), /ไม่ใช่บัญชีรายได้/);
  });

  it('tracks status and shows expiry after the validity period', () => {
    const data = demo();
    const r = saveQuotation(data, { ...input(data), validDays: 7 });
    const sent = setQuotationStatus(r.state, r.quotation.id, 'sent');
    const q = sent.quotations.find((x) => x.id === r.quotation.id);
    if (!q) throw new Error('fixture');
    expect(quotationStatusOf(q, TODAY)).toBe('sent');
    expect(quotationStatusOf(q, '2026-10-31')).toBe('sent');
    expect(quotationStatusOf(q, '2026-11-01')).toBe('expired');
    rule(() => setQuotationStatus(sent, 'nope', 'sent'), /ไม่พบ/);
    rule(() => setQuotationStatus(sent, q.id, 'won' as 'sent'), /สถานะไม่ถูกต้อง/);
  });

  it('converts to a tax invoice copying the lines, then locks the quotation', () => {
    const data = demo();
    const r = saveQuotation(data, input(data));
    const draft = quotationToSalesDraft(r.quotation, uid);
    expect(draft.lines.map(({ id: _id, ...l }) => l)).toEqual(r.quotation.lines.map(({ id: _id, ...l }) => l));
    expect(draft.lines.every((l, i) => l.id !== r.quotation.lines[i].id)).toBe(true);
    const sales = { ...draft, date: TODAY, dueDate: '2026-11-23' };
    const issued = issueFromQuotation(r.state, r.quotation.id, sales);
    expect(issued.doc.docNo).toBe('IV6910-0005');
    expect(issued.doc.lines.map((l) => [l.qty, l.unitPrice, l.accountCode])).toEqual(r.quotation.lines.map((l) => [l.qty, l.unitPrice, l.accountCode]));
    expect(issued.quotation).toMatchObject({ status: 'accepted', convertedSalesId: issued.doc.id });
    expect(quotationStatusOf(issued.quotation, TODAY)).toBe('converted');
    expectValid(issued.state);

    rule(() => issueFromQuotation(issued.state, r.quotation.id, sales), /ออกเอกสารขายไปแล้ว/);
    rule(() => saveQuotation(issued.state, { ...input(data), id: r.quotation.id }), /แก้ไขไม่ได้/);
    rule(() => setQuotationStatus(issued.state, r.quotation.id, 'draft'), /เปลี่ยนสถานะไม่ได้/);
    rule(() => issueFromQuotation(r.state, r.quotation.id, { ...sales, contactId: 'c-nakhon' }), /ลูกค้าต้องตรงกับ/);
    rule(() => issueFromQuotation(r.state, r.quotation.id, { ...sales, date: '2026-10-01', dueDate: '2026-10-31' }), /ไม่ก่อนวันที่ใบเสนอราคา/);
    rule(() => issueFromQuotation(r.state, 'nope', sales), /ไม่พบใบเสนอราคา/);
    rule(() => issueFromQuotation(setQuotationStatus(r.state, r.quotation.id, 'rejected'), r.quotation.id, sales), /ไม่อนุมัติ/);
    rule(() => issueFromQuotation(r.state, r.quotation.id, { ...sales, date: '2026-12-01', dueDate: '2026-12-31' }), /หมดอายุ/);
  });

  it('converts a service quotation into a service invoice (ม.78/1)', () => {
    const demoData = demo();
    const expired = demoData.quotations.find((q) => q.saleType === 'service');
    if (!expired) throw new Error('fixture');
    // ใบตัวอย่างหมดอายุแล้ว (ยืนราคา 15 วัน) — ต่ออายุก่อนแปลง
    expect(quotationStatusOf(expired, TODAY)).toBe('expired');
    const { state: data, quotation: service } = saveQuotation(demoData, { ...expired, validDays: 60 });
    const draft = quotationToSalesDraft(service, uid);
    expect(draft.saleType).toBe('service');
    const issued = issueFromQuotation(data, service.id, { ...draft, date: TODAY, dueDate: '2026-11-23' });
    expect(issued.doc.docNo.startsWith('BL')).toBe(true);
    expect(issued.doc.saleType).toBe('service');
    expectValid(issued.state);
  });

  it('flags quotation links that do not match the sales document', () => {
    const data = demo();
    const r = saveQuotation(data, input(data));
    const issued = issueFromQuotation(r.state, r.quotation.id, { ...quotationToSalesDraft(r.quotation, uid), date: TODAY, dueDate: TODAY });
    const bogus = { ...issued.state, quotations: issued.state.quotations.map((q) => (q.convertedSalesId ? { ...q, convertedSalesId: 'x' } : q)) };
    expect(validateAccountingData(bogus).join()).toMatch(/ไม่พบเอกสารขายที่แปลง/);
    const wrongStatus = { ...issued.state, quotations: issued.state.quotations.map((q) => (q.convertedSalesId ? { ...q, status: 'sent' as const } : q)) };
    expect(validateAccountingData(wrongStatus).join()).toMatch(/สถานะไม่ใช่/);
    const twice = { ...issued.state, quotations: issued.state.quotations.map((q) => ({ ...q, convertedSalesId: issued.doc.id, status: 'accepted' as const, contactId: 'c-abc' })) };
    expect(validateAccountingData(twice).join()).toMatch(/ถูกแปลงจาก/);
    const other = issueTaxInvoice(issued.state, { date: TODAY, dueDate: TODAY, contactId: 'c-nakhon', vatMode: 'none', lines: [ln(1, 10)] });
    const wrongContact = { ...other.state, quotations: other.state.quotations.map((q) => (q.convertedSalesId ? { ...q, convertedSalesId: other.doc.id } : q)) };
    expect(validateAccountingData(wrongContact).join()).toMatch(/ลูกค้าไม่ตรงกับ/);
    const badDays = { ...data, quotations: data.quotations.map((q) => ({ ...q, validDays: -1 })) };
    expect(validateAccountingData(badDays).join()).toMatch(/จำนวนวันยืนราคา/);
  });
});

// ----------------------------------------------------------------------

describe('B11 next contact code and saveContact', () => {
  it('uses the highest numeric code + 1 instead of the contact count', () => {
    const data = demo();
    expect(nextContactCode(data.contacts, 'C')).toBe('C0005');
    expect(nextContactCode(data.contacts, 'V')).toBe('V0005');
    const gap = data.contacts.filter((c) => c.code !== 'C0002');
    // จำนวน + 1 = C0008 ซ้ำกับไม่มีใคร แต่ค่าสูงสุดคือ C0004 → C0005 (ไม่ใช่ C0004 ซ้ำ)
    expect(nextContactCode(gap, 'C')).toBe('C0005');
    expect(nextContactCode([{ code: 'C00099' }, { code: 'PETTY' }, { code: 'c0100' }], 'C')).toBe('C00101');
    expect(nextContactCode([], 'C')).toBe('C0001');
  });

  it('returns the saved contact so the form can select it right away', () => {
    const data = demo();
    const r = saveContact(data, { code: 'C0005', kind: 'customer', legalForm: 'juristic', title: 'บริษัท', name: 'ใหม่ จำกัด', address: {}, creditDays: 15 });
    expect(r.state.contacts.find((c) => c.id === r.contact.id)?.name).toBe('ใหม่ จำกัด');
    const renamed = saveContact(r.state, { ...r.contact, name: 'ใหม่กว่า จำกัด' });
    expect(renamed.contact.id).toBe(r.contact.id);
    expect(renamed.state.contacts).toHaveLength(r.state.contacts.length);
  });
});

describe('recordPurchase still pays from any cash account', () => {
  it('pays from a second bank account', () => {
    const { state } = withScb(transferFunds(demo(), { date: TODAY, fromAccountCode: ACC.bank, toAccountCode: ACC.cash, amount: 1 }).state);
    const r = recordPurchase(state, {
      supplierInvoiceNo: '',
      date: TODAY,
      contactId: 'v-somsri',
      vatMode: 'none',
      claimVat: false,
      whtCondition: '1',
      lines: [{ ...ln(1, 100, ACC.misc), whtIncomeType: '', whtRate: 0 }],
      payNow: { date: TODAY, accountCode: '1121' },
    });
    expect(r.payment?.accountCode).toBe('1121');
    expectValid(r.state);
  });
});

describe('fuzz finding: input VAT claimed in a month filed by the old system', () => {
  it('rejects a claim period on/before the opening-balance month and flags such data', () => {
    const start = setOpeningBalances(
      { ...emptyData(), contacts: demo().contacts },
      {
        date: '2026-09-30',
        lines: [
          { accountCode: ACC.bank, debit: 1000, credit: 0 },
          { accountCode: ACC.capital, debit: 0, credit: 1000 },
        ],
        vatCredit: 0,
        whtReceivable: 0,
        receivableControl: 0,
        payableControl: 0,
        receivables: [],
        payables: [],
      }
    ).state;
    const base = {
      supplierInvoiceNo: 'R-OLD',
      supplierInvoiceDate: '2026-08-20',
      date: '2026-10-05',
      contactId: 'v-express',
      vatMode: 'exclusive' as const,
      claimVat: true,
      whtCondition: '1' as const,
      lines: [{ ...ln(1, 1000, ACC.freight), whtIncomeType: '', whtRate: 0 }],
    };
    rule(() => recordPurchase(start, { ...base, vatClaimPeriod: '2026-09' }), /ยื่นในระบบเดิมแล้ว/);
    const ok = recordPurchase(start, { ...base, vatClaimPeriod: '2026-10' });
    expectValid(ok.state);
    const tampered = { ...ok.state, purchases: ok.state.purchases.map((p) => (p.opening ? p : { ...p, vatClaimPeriod: '2026-08' })) };
    expect(validateAccountingData(tampered).join()).toMatch(/ซึ่งยื่นในระบบเดิมแล้ว/);
  });
});
