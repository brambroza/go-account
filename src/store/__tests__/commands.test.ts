import type { AccountingData } from 'src/domain';
import type { ApiClient, HttpMethod } from 'src/utils/api-client';

import { ACC } from 'src/domain';

import { cmd, pickSaved } from '../commands';
import { ln, pln, demo, TODAY } from './fixtures';
import { issueTaxInvoice, BusinessRuleError } from '../actions';

import type { Command, RemoteContext } from '../commands';

// ----------------------------------------------------------------------
// C6: คำสั่งแต่ละตัว — remote เรียก endpoint ที่ถูกต้อง (method/path/body) แล้วคืนผลรูปเดียวกับ local จากสมุดที่โหลดใหม่
// ----------------------------------------------------------------------

const NEW_ID = '7f3c2a1e-0000-4000-8000-000000000001';

type Call = { method: HttpMethod; path: string; body?: unknown; part?: string };

/** สมุดหลังคำสั่ง: ทุก array มีแถว id = NEW_ID (pickSaved หาเจอ) */
function nextBook(before: AccountingData): AccountingData {
  const row = <T extends object>(rows: T[]): T[] => [...rows, { ...(rows[0] ?? {}), id: NEW_ID } as T];
  return {
    ...before,
    sales: row(before.sales),
    receipts: row(before.receipts),
    refunds: row(before.refunds),
    purchases: row(before.purchases),
    payments: row(before.payments),
    purchaseCredits: row(before.purchaseCredits),
    supplierRefunds: row(before.supplierRefunds),
    journal: row(before.journal),
    contacts: row(before.contacts),
    transfers: row(before.transfers),
    bankMatches: [...before.bankMatches, { id: NEW_ID, accountCode: ACC.bank, statementLineIds: [], journalIds: [], auto: false, matchedAt: '' }],
    quotations: row(before.quotations),
    yearCloses: [...before.yearCloses, { id: NEW_ID, fiscalYearEnd: '2025-12-31', netProfit: 0 }],
    openingBalance: before.openingBalance ?? { date: '2025-12-31', journalId: NEW_ID, lines: [], vatCredit: 0, whtReceivable: 0 },
  };
}

function fakeCtx(response: Record<string, unknown> = { id: NEW_ID }) {
  const before = demo();
  const calls: Call[] = [];
  let reloads = 0;
  const ctx: RemoteContext = {
    before,
    client: {} as ApiClient,
    send: async <T,>(method: HttpMethod, path: string, body?: unknown, part?: string) => {
      calls.push({ method, path, body, part });
      return response as T;
    },
    reload: async () => {
      reloads += 1;
      return nextBook(before);
    },
  };
  return { ctx, calls, before, reloads: () => reloads };
}

const salesInput = { date: TODAY, dueDate: TODAY, contactId: 'c1', vatMode: 'exclusive' as const, lines: [ln(2, 100)] };

const cases: [string, Command<object>, HttpMethod, string, Record<string, unknown>?][] = [
  ['issueTaxInvoice', cmd.issueTaxInvoice(salesInput), 'POST', '/sales/invoices'],
  ['issueFromQuotation', cmd.issueFromQuotation(NEW_ID, salesInput), 'POST', `/quotations/${NEW_ID}/convert`, { sales: { id: NEW_ID } }],
  ['issueCreditNote', cmd.issueCreditNote({ invoiceId: 'inv 1', date: TODAY, reason: 'r', lines: [ln(1, 1)] }), 'POST', '/sales/inv%201/credit-notes'],
  ['issueDebitNote', cmd.issueDebitNote({ invoiceId: 'inv1', date: TODAY, reason: 'r', lines: [ln(1, 1)] }), 'POST', '/sales/inv1/debit-notes'],
  [
    'receivePayment',
    cmd.receivePayment({ invoiceId: 'inv1', date: TODAY, amount: 107, whtAmount: 3, depositAccountCode: ACC.bank }),
    'POST',
    '/sales/inv1/receipts',
  ],
  ['refundCustomerCredit', cmd.refundCustomerCredit({ contactId: 'c1', date: TODAY, amount: 1, accountCode: ACC.bank }), 'POST', '/sales/refunds'],
  ['setETaxStatus', cmd.setETaxStatus(['a'], 'uploaded', { reference: 'R1' }), 'POST', '/sales/etax-status'],
  [
    'recordPurchase',
    cmd.recordPurchase({ supplierInvoiceNo: 'S1', date: TODAY, contactId: 'v1', vatMode: 'none', claimVat: false, whtCondition: '1', lines: [pln(1, 100)] }),
    'POST',
    '/purchases',
    { id: NEW_ID, payment: { id: NEW_ID } },
  ],
  ['payPurchase', cmd.payPurchase({ purchaseId: NEW_ID, date: TODAY, accountCode: ACC.bank }), 'POST', '/payments'],
  [
    'recordSupplierCreditNote',
    cmd.recordSupplierCreditNote({
      purchaseId: 'p1',
      supplierCreditNoteNo: 'C1',
      supplierCreditNoteDate: TODAY,
      date: TODAY,
      reason: 'r',
      lines: [{ ...ln(1, 1), purchaseLineId: 'l1' }],
    }),
    'POST',
    '/purchase-credits',
    { id: NEW_ID, warnings: ['w'] },
  ],
  ['receiveSupplierRefund', cmd.receiveSupplierRefund({ contactId: 'v1', date: TODAY, amount: 1, accountCode: ACC.bank }), 'POST', '/supplier-refunds'],
  [
    'recordPettyCashExpense',
    cmd.recordPettyCashExpense({
      pettyAccountCode: '1111',
      date: TODAY,
      lines: [{ id: 'x', description: 'd', accountCode: ACC.misc, amount: 10 }],
      vatMode: 'none',
      claimVat: false,
    }),
    'POST',
    '/petty-cash/expenses',
    { id: NEW_ID, payment: null },
  ],
  ['addManualJournal', cmd.addManualJournal({ date: TODAY, description: 'd', lines: [] }), 'POST', '/journal'],
  ['lockPeriod', cmd.lockPeriod('2026-09-30'), 'POST', '/company/lock-period'],
  ['closeYear', cmd.closeYear('2025-12-31'), 'POST', '/company/year-close', { already: false }],
  [
    'setOpeningBalances',
    cmd.setOpeningBalances({ date: '2025-12-31', lines: [], vatCredit: 0, whtReceivable: 0, receivableControl: 0, payableControl: 0, receivables: [], payables: [] }),
    'POST',
    '/opening-balances',
  ],
  ['updateCompany', cmd.updateCompany(demo().company), 'PUT', '/company'],
  ['saveContact (new)', cmd.saveContact({ ...demo().contacts[0], id: undefined }), 'POST', '/contacts'],
  ['saveContact (edit)', cmd.saveContact({ ...demo().contacts[0], id: NEW_ID }), 'PUT', `/contacts/${NEW_ID}`],
  ['addBankAccount', cmd.addBankAccount({ kind: 'bank', bankName: 'B', accountNo: '1' }), 'POST', '/bank-accounts', { accountCode: ACC.bank }],
  ['updateBankAccount', cmd.updateBankAccount('1121', { reconcileFrom: TODAY }), 'PATCH', '/bank-accounts/1121'],
  ['transferFunds', cmd.transferFunds({ date: TODAY, fromAccountCode: ACC.bank, toAccountCode: ACC.cash, amount: 1 }), 'POST', '/transfers'],
  [
    'addBankStatementLines',
    cmd.addBankStatementLines({ accountCode: '1120', lines: [{ date: TODAY, description: 'd', amount: 1 }], imported: true }),
    'POST',
    '/bank-accounts/1120/statements',
    { added: [{}, {}], skipped: 1 },
  ],
  ['deleteBankStatementLines', cmd.deleteBankStatementLines(['s1']), 'DELETE', '/bank-statements'],
  ['matchBankItems', cmd.matchBankItems({ accountCode: '1120', statementLineIds: ['s'], journalIds: ['j'] }), 'POST', '/bank-accounts/1120/matches'],
  ['autoMatchBank', cmd.autoMatchBank('1120', 5), 'POST', '/bank-accounts/1120/auto-match', { matched: 2 }],
  ['unmatchBank', cmd.unmatchBank('m1'), 'DELETE', '/bank-matches/m1'],
  ['saveQuotation (new)', cmd.saveQuotation({ date: TODAY, validDays: 30, contactId: 'c1', lines: [ln(1, 1)], vatMode: 'exclusive' }), 'POST', '/quotations'],
  [
    'saveQuotation (edit)',
    cmd.saveQuotation({ id: NEW_ID, date: TODAY, validDays: 30, contactId: 'c1', lines: [ln(1, 1)], vatMode: 'exclusive' }),
    'PUT',
    `/quotations/${NEW_ID}`,
  ],
  ['setQuotationStatus', cmd.setQuotationStatus('q1', 'sent'), 'POST', '/quotations/q1/status'],
];

describe('commands — remote (api mode)', () => {
  const rows = cases.map(([name, command, method, path, response]) => ({ name, command, method, path, response: response ?? { id: NEW_ID } }));
  it.each(rows)('$name → $method $path and reloads the book', async ({ command, method, path, response }) => {
    const f = fakeCtx(response);
    await command.remote(f.ctx);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].method).toBe(method);
    expect(f.calls[0].path).toBe(path);
    expect(f.reloads()).toBe(1);
  });

  it('returns saved rows from the reloaded book (uuid from the server, not a local id)', async () => {
    const f = fakeCtx();
    const r = await cmd.issueTaxInvoice(salesInput).remote(f.ctx);
    expect(r.doc.id).toBe(NEW_ID);
    const p = await cmd.recordPurchase({ supplierInvoiceNo: 'S1', date: TODAY, contactId: 'v1', vatMode: 'none', claimVat: false, whtCondition: '1', lines: [pln(1, 1)] }).remote(
      fakeCtx({ id: NEW_ID, payment: { id: NEW_ID } }).ctx
    );
    expect(p.payment?.id).toBe(NEW_ID);
    const c = await cmd.recordSupplierCreditNote({ purchaseId: 'p', supplierCreditNoteNo: '', supplierCreditNoteDate: TODAY, date: TODAY, reason: 'r', lines: [] }).remote(
      fakeCtx({ id: NEW_ID }).ctx
    );
    expect(c.warnings).toEqual([]);
  });

  it('sends request bodies in API shape (no local line ids; money stays baht)', async () => {
    const f = fakeCtx();
    const line = ln(2, 100);
    await cmd.issueTaxInvoice({ ...salesInput, lines: [line], saleType: 'service', note: 'n' }).remote(f.ctx);
    expect(f.calls[0].body).toEqual({
      date: TODAY,
      dueDate: TODAY,
      contactId: 'c1',
      vatMode: 'exclusive',
      saleType: 'service',
      note: 'n',
      lines: [{ description: line.description, qty: 2, unitPrice: 100, discount: 0, accountCode: ACC.sales }],
    });
    const g = fakeCtx({ id: NEW_ID, payment: null });
    await cmd.recordPurchase({ supplierInvoiceNo: 'S1', date: TODAY, contactId: 'v1', vatMode: 'none', claimVat: false, whtCondition: '1', lines: [pln(1, 100)] }).remote(g.ctx);
    const body = g.calls[0].body as { lines: Record<string, unknown>[] };
    expect(body.lines[0]).not.toHaveProperty('id');
    expect(body.lines[0].unitPrice).toBe(100);
  });

  it('closeYear passes `already` and finds the close by fiscal year end', async () => {
    const r = await cmd.closeYear('2025-12-31').remote(fakeCtx({ already: true }).ctx);
    expect(r).toMatchObject({ already: true, close: { fiscalYearEnd: '2025-12-31' } });
    await expect(cmd.closeYear('2024-12-31').remote(fakeCtx({ already: false }).ctx)).rejects.toThrow(BusinessRuleError);
  });

  it('addBankAccount fails clearly when the reloaded book lacks the account', async () => {
    await expect(cmd.addBankAccount({ kind: 'bank', bankName: 'B', accountNo: '1' }).remote(fakeCtx({ accountCode: '9999' }).ctx)).rejects.toThrow(
      'โหลดข้อมูลล่าสุดไม่พบ'
    );
  });

  it('importContacts posts only new codes, one sub-key per contact; partial failure reports progress', async () => {
    const f = fakeCtx();
    const existing = f.before.contacts[0];
    const fresh = [
      { ...existing, code: 'NEW1' },
      { ...existing, code: 'NEW2' },
    ];
    const r = await cmd.importContacts([{ ...existing }, ...fresh]).remote(f.ctx);
    expect(r).toEqual({ added: 2, skipped: 1 });
    expect(f.calls.map((c) => c.part)).toEqual(['NEW1', 'NEW2']);

    let n = 0;
    const failing = fakeCtx();
    failing.ctx.send = async () => {
      n += 1;
      if (n === 2) throw new Error('รหัสซ้ำ');
      return { id: NEW_ID } as never;
    };
    await expect(cmd.importContacts(fresh).remote(failing.ctx)).rejects.toThrow('นำเข้าได้ 1 จาก 2 รายการ — NEW2: รหัสซ้ำ');
  });

  it('pickSaved throws a Thai error when the saved row is missing', () => {
    expect(() => pickSaved([], 'x', 'เอกสารขาย')).toThrow('บันทึกเอกสารขายแล้ว แต่โหลดข้อมูลล่าสุดไม่พบ');
  });

  it('setOpeningBalances fails when the book has no opening balance after reload', async () => {
    const f = fakeCtx();
    f.ctx.reload = async () => ({ ...demo(), openingBalance: undefined });
    await expect(
      cmd
        .setOpeningBalances({ date: '2025-12-31', lines: [], vatCredit: 0, whtReceivable: 0, receivableControl: 0, payableControl: 0, receivables: [], payables: [] })
        .remote(f.ctx)
    ).rejects.toThrow(BusinessRuleError);
  });
});

describe('commands — local (demo mode)', () => {
  it('local path is the pure action', () => {
    const data = demo();
    const customer = data.contacts.find((c) => c.kind !== 'vendor');
    if (!customer) throw new Error('fixture');
    const input = { ...salesInput, contactId: customer.id };
    const viaCmd = cmd.issueTaxInvoice(input).local(data);
    const direct = issueTaxInvoice(data, input);
    expect(viaCmd.doc.docNo).toBe(direct.doc.docNo);
    expect(cmd.lockPeriod('2026-09-30').local(data).state.company.lockedThrough).toBe('2026-09-30');
  });

  it('fingerprint is stable for the same input and differs for different input', () => {
    expect(cmd.lockPeriod('2026-09-30').fingerprint).toBe(cmd.lockPeriod('2026-09-30').fingerprint);
    expect(cmd.lockPeriod('2026-09-30').fingerprint).not.toBe(cmd.lockPeriod('2026-08-31').fingerprint);
  });
});
