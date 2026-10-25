import type { ApiClient, HttpMethod } from 'src/utils/api-client';
import type {
  Company,
  Contact,
  ISODate,
  ETaxStatus,
  JournalLine,
  BankAccount,
  AccountingData,
  QuotationStatus,
  PurchaseCreditNote,
} from 'src/domain';

import {
  closeYear,
  lockPeriod,
  saveContact,
  unmatchBank,
  payPurchase,
  autoMatchBank,
  transferFunds,
  updateCompany,
  saveQuotation,
  setETaxStatus,
  importContacts,
  receivePayment,
  addBankAccount,
  matchBankItems,
  recordPurchase,
  issueDebitNote,
  issueTaxInvoice,
  issueCreditNote,
  addManualJournal,
  updateBankAccount,
  BusinessRuleError,
  issueFromQuotation,
  setQuotationStatus,
  setOpeningBalances,
  refundCustomerCredit,
  addBankStatementLines,
  receiveSupplierRefund,
  recordPettyCashExpense,
  deleteBankStatementLines,
  recordSupplierCreditNote,
} from './actions';

import type { Mutation } from './accounting-store';
import type {
  SalesInput,
  RefundInput,
  ReceiptInput,
  TransferInput,
  PurchaseInput,
  QuotationInput,
  DebitNoteInput,
  CreditNoteInput,
  PayPurchaseInput,
  BankAccountInput,
  StatementLineInput,
  OpeningBalanceInput,
  SupplierRefundInput,
  PettyCashExpenseInput,
  SupplierCreditNoteInput,
} from './actions';

// ----------------------------------------------------------------------
// คำสั่ง (command) ของหน้าจอ — หนึ่งคำสั่งมีสองทางทำงาน:
//   local  = pure action ใน `actions.ts` (โหมด demo localStorage)
//   remote = เรียก go-account-api แล้วโหลดสมุดใหม่ (โหมด api — เซิร์ฟเวอร์เป็น source of truth)
// หน้าจอสร้างคำสั่งด้วย `cmd.xxx(input)` แล้วส่งให้ `useAccounting().run(...)` — ไม่รู้ว่าอยู่โหมดไหน
// ผลของ remote มีรูปเดียวกับ local (เอกสารที่บันทึกแล้วจากสมุดชุดใหม่) หน้าจอจึงใช้ `r.doc.docNo` / `r.doc.id` ได้เหมือนเดิม
// ----------------------------------------------------------------------

/** สิ่งที่คำสั่ง remote ใช้ได้ — `send` ใส่ Idempotency-Key ของการกดบันทึกครั้งนี้ให้เอง */
export type RemoteContext = {
  /** สมุดก่อนส่งคำสั่ง (ใช้หาข้อมูลอ้างอิง เช่น ผู้ติดต่อที่มีอยู่) */
  before: AccountingData;
  /**
   * ส่งคำสั่งหนึ่งครั้ง — `part` แยก key ของคำขอย่อยในคำสั่งเดียวกัน (เช่น นำเข้าผู้ติดต่อทีละราย)
   * key = `<key ของการกดบันทึก>` หรือ `<key>:<part>` — คงที่เมื่อกดบันทึกคำสั่งเดิมซ้ำหลังเครือข่ายหลุด
   */
  send: <T>(method: HttpMethod, path: string, body?: unknown, part?: string) => Promise<T>;
  /** โหลดสมุดใหม่จากเซิร์ฟเวอร์ (หลังคำสั่งสำเร็จ) */
  reload: () => Promise<AccountingData>;
  client: ApiClient;
};

export type Command<R extends object> = {
  /** ชื่อคำสั่ง (log / fingerprint) */
  name: string;
  /** ตัวระบุ "คำสั่งเดียวกัน" — กดบันทึกซ้ำด้วยข้อมูลเดิมหลังล้มเหลว = Idempotency-Key เดิม */
  fingerprint: string;
  local: Mutation<R>;
  remote: (ctx: RemoteContext) => Promise<R>;
};

type Created = { id: string };

/** ผลของ action โดยไม่มี state — remote ต้องคืนรูปเดียวกัน */
type Res<F extends (...args: never[]) => { state: AccountingData }> = Omit<ReturnType<F>, 'state'>;

const define = <R extends object>(
  name: string,
  args: unknown,
  local: NoInfer<Mutation<R>>,
  remote: Command<R>['remote']
): Command<R> => ({
  name,
  fingerprint: `${name}:${JSON.stringify(args ?? null)}`,
  local,
  remote,
});

/** หาแถวที่เพิ่งบันทึกในสมุดใหม่ — ไม่พบ = สมุดที่โหลดไม่ตรงกับผลคำสั่ง (ไม่ควรเกิด) */
export function pickSaved<T extends { id: string }>(rows: T[], id: string, label: string): T {
  const row = rows.find((r) => r.id === id);
  if (!row)
    throw new BusinessRuleError(
      `บันทึก${label}แล้ว แต่โหลดข้อมูลล่าสุดไม่พบ — รีเฟรชหน้าเพื่อดูรายการ`
    );
  return row;
}

const enc = encodeURIComponent;

/** บรรทัดเอกสารขาย/ใบเสนอราคาในรูป request (ไม่ส่ง id ของบรรทัดฝั่งหน้าเว็บ) */
const docLines = (lines: SalesInput['lines']) =>
  lines.map((l) => ({
    description: l.description,
    qty: l.qty,
    unitPrice: l.unitPrice,
    discount: l.discount,
    accountCode: l.accountCode,
  }));

const invoiceBody = (input: SalesInput) => ({
  date: input.date,
  dueDate: input.dueDate,
  contactId: input.contactId,
  vatMode: input.vatMode,
  saleType: input.saleType,
  note: input.note,
  lines: docLines(input.lines),
});

const adjustmentBody = (input: CreditNoteInput) => ({
  date: input.date,
  reason: input.reason,
  reasonCode: input.reasonCode,
  lines: docLines(input.lines),
});

const contactBody = (c: Omit<Contact, 'id'>) => ({
  code: c.code,
  kind: c.kind,
  legalForm: c.legalForm,
  title: c.title,
  name: c.name,
  lastName: c.lastName,
  taxId: c.taxId,
  branchNo: c.branchNo,
  address: c.address,
  email: c.email,
  phone: c.phone,
  creditDays: c.creditDays,
});

// ----------------------------------------------------------------------

export const cmd = {
  // ---------------- ขาย ----------------
  issueTaxInvoice: (input: SalesInput) =>
    define<Res<typeof issueTaxInvoice>>(
      'issueTaxInvoice',
      input,
      (s) => issueTaxInvoice(s, input),
      async (ctx) => {
        const r = await ctx.send<Created>('POST', '/sales/invoices', invoiceBody(input));
        const next = await ctx.reload();
        return { doc: pickSaved(next.sales, r.id, 'เอกสารขาย') };
      }
    ),

  issueFromQuotation: (quotationId: string, input: SalesInput) =>
    define<Res<typeof issueFromQuotation>>(
      'issueFromQuotation',
      { quotationId, input },
      (s) => issueFromQuotation(s, quotationId, input),
      async (ctx) => {
        const r = await ctx.send<{ sales: Created }>(
          'POST',
          `/quotations/${enc(quotationId)}/convert`,
          invoiceBody(input)
        );
        const next = await ctx.reload();
        return {
          doc: pickSaved(next.sales, r.sales.id, 'เอกสารขาย'),
          quotation: pickSaved(next.quotations, quotationId, 'ใบเสนอราคา'),
        };
      }
    ),

  issueCreditNote: (input: CreditNoteInput) =>
    define<Res<typeof issueCreditNote>>(
      'issueCreditNote',
      input,
      (s) => issueCreditNote(s, input),
      async (ctx) => {
        const r = await ctx.send<Created>(
          'POST',
          `/sales/${enc(input.invoiceId)}/credit-notes`,
          adjustmentBody(input)
        );
        const next = await ctx.reload();
        return { doc: pickSaved(next.sales, r.id, 'ใบลดหนี้') };
      }
    ),

  issueDebitNote: (input: DebitNoteInput) =>
    define<Res<typeof issueDebitNote>>(
      'issueDebitNote',
      input,
      (s) => issueDebitNote(s, input),
      async (ctx) => {
        const r = await ctx.send<Created>(
          'POST',
          `/sales/${enc(input.invoiceId)}/debit-notes`,
          adjustmentBody(input)
        );
        const next = await ctx.reload();
        return { doc: pickSaved(next.sales, r.id, 'ใบเพิ่มหนี้') };
      }
    ),

  receivePayment: (input: ReceiptInput) =>
    define<Res<typeof receivePayment>>(
      'receivePayment',
      input,
      (s) => receivePayment(s, input),
      async (ctx) => {
        const r = await ctx.send<Created>('POST', `/sales/${enc(input.invoiceId)}/receipts`, {
          date: input.date,
          amount: input.amount,
          whtAmount: input.whtAmount,
          depositAccountCode: input.depositAccountCode,
        });
        const next = await ctx.reload();
        return { receipt: pickSaved(next.receipts, r.id, 'ใบเสร็จ') };
      }
    ),

  refundCustomerCredit: (input: RefundInput) =>
    define<Res<typeof refundCustomerCredit>>(
      'refundCustomerCredit',
      input,
      (s) => refundCustomerCredit(s, input),
      async (ctx) => {
        const r = await ctx.send<Created>('POST', '/sales/refunds', input);
        const next = await ctx.reload();
        return { refund: pickSaved(next.refunds, r.id, 'การคืนเงิน') };
      }
    ),

  setETaxStatus: (ids: string[], etax: ETaxStatus, meta: { reference?: string } = {}) =>
    define<object>(
      'setETaxStatus',
      { ids, etax, meta },
      (s) => ({ state: setETaxStatus(s, ids, etax, meta) }),
      async (ctx) => {
        await ctx.send('POST', '/sales/etax-status', {
          ids,
          etax,
          reference: meta.reference || undefined,
        });
        await ctx.reload();
        return {};
      }
    ),

  // ---------------- ซื้อ ----------------
  recordPurchase: (input: PurchaseInput) =>
    define<Res<typeof recordPurchase>>(
      'recordPurchase',
      input,
      (s) => recordPurchase(s, input),
      async (ctx) => {
        const r = await ctx.send<Created & { payment?: Created | null }>('POST', '/purchases', {
          ...input,
          lines: input.lines.map(({ id: _id, ...l }) => l),
        });
        const next = await ctx.reload();
        return {
          doc: pickSaved(next.purchases, r.id, 'เอกสารซื้อ'),
          payment: r.payment ? pickSaved(next.payments, r.payment.id, 'ใบสำคัญจ่าย') : undefined,
        };
      }
    ),

  payPurchase: (input: PayPurchaseInput) =>
    define<Res<typeof payPurchase>>(
      'payPurchase',
      input,
      (s) => payPurchase(s, input),
      async (ctx) => {
        const r = await ctx.send<Created>('POST', '/payments', input);
        const next = await ctx.reload();
        return {
          doc: pickSaved(next.purchases, input.purchaseId, 'เอกสารซื้อ'),
          payment: pickSaved(next.payments, r.id, 'ใบสำคัญจ่าย'),
        };
      }
    ),

  recordSupplierCreditNote: (input: SupplierCreditNoteInput) =>
    define<Res<typeof recordSupplierCreditNote>>(
      'recordSupplierCreditNote',
      input,
      (s) => recordSupplierCreditNote(s, input),
      async (ctx) => {
        const r = await ctx.send<Created & { warnings?: string[] }>('POST', '/purchase-credits', {
          ...input,
          lines: input.lines.map(({ id: _id, ...l }) => l),
        });
        const next = await ctx.reload();
        const doc: PurchaseCreditNote = pickSaved(next.purchaseCredits, r.id, 'ใบลดหนี้จากผู้ขาย');
        return { doc, warnings: r.warnings ?? [] };
      }
    ),

  receiveSupplierRefund: (input: SupplierRefundInput) =>
    define<Res<typeof receiveSupplierRefund>>(
      'receiveSupplierRefund',
      input,
      (s) => receiveSupplierRefund(s, input),
      async (ctx) => {
        const r = await ctx.send<Created>('POST', '/supplier-refunds', input);
        const next = await ctx.reload();
        return { refund: pickSaved(next.supplierRefunds, r.id, 'การรับเงินคืน') };
      }
    ),

  recordPettyCashExpense: (input: PettyCashExpenseInput) =>
    define<Res<typeof recordPettyCashExpense>>(
      'recordPettyCashExpense',
      input,
      (s) => recordPettyCashExpense(s, input),
      async (ctx) => {
        const r = await ctx.send<Created & { payment?: Created | null }>(
          'POST',
          '/petty-cash/expenses',
          {
            ...input,
            lines: input.lines.map(({ id: _id, ...l }) => l),
          }
        );
        const next = await ctx.reload();
        return {
          doc: pickSaved(next.purchases, r.id, 'เอกสารซื้อ'),
          payment: r.payment ? pickSaved(next.payments, r.payment.id, 'ใบสำคัญจ่าย') : undefined,
        };
      }
    ),

  // ---------------- สมุดบัญชี / ปิดงวด ----------------
  addManualJournal: (input: { date: string; description: string; lines: JournalLine[] }) =>
    define<Res<typeof addManualJournal>>(
      'addManualJournal',
      input,
      (s) => addManualJournal(s, input),
      async (ctx) => {
        const r = await ctx.send<Created>('POST', '/journal', input);
        const next = await ctx.reload();
        return { entry: pickSaved(next.journal, r.id, 'รายการปรับปรุง') };
      }
    ),

  lockPeriod: (through: ISODate) =>
    define<object>(
      'lockPeriod',
      through,
      (s) => ({ state: lockPeriod(s, through) }),
      async (ctx) => {
        await ctx.send('POST', '/company/lock-period', { through });
        await ctx.reload();
        return {};
      }
    ),

  closeYear: (fiscalYearEnd: ISODate) =>
    define<Res<typeof closeYear>>(
      'closeYear',
      fiscalYearEnd,
      (s) => closeYear(s, fiscalYearEnd),
      async (ctx) => {
        const r = await ctx.send<{ already: boolean }>('POST', '/company/year-close', {
          fiscalYearEnd,
        });
        const next = await ctx.reload();
        const close = next.yearCloses.find((c) => c.fiscalYearEnd === fiscalYearEnd);
        if (!close)
          throw new BusinessRuleError('ปิดบัญชีแล้ว แต่โหลดข้อมูลล่าสุดไม่พบ — รีเฟรชหน้า');
        return { close, already: r.already };
      }
    ),

  setOpeningBalances: (input: OpeningBalanceInput) =>
    define<Res<typeof setOpeningBalances>>(
      'setOpeningBalances',
      input,
      (s) => setOpeningBalances(s, input),
      async (ctx) => {
        await ctx.send('POST', '/opening-balances', input);
        const next = await ctx.reload();
        if (!next.openingBalance)
          throw new BusinessRuleError('บันทึกยอดยกมาแล้ว แต่โหลดข้อมูลล่าสุดไม่พบ — รีเฟรชหน้า');
        return { opening: next.openingBalance };
      }
    ),

  updateCompany: (company: Company) =>
    define<object>(
      'updateCompany',
      company,
      (s) => ({ state: updateCompany(s, company) }),
      async (ctx) => {
        await ctx.send('PUT', '/company', {
          name: company.name,
          taxId: company.taxId,
          branchNo: company.branchNo,
          vatRegistered: company.vatRegistered,
          sbtRegistered: company.sbtRegistered ?? false,
          address: company.address,
          phone: company.phone,
          email: company.email,
          rdUserId: company.rdUserId,
        });
        await ctx.reload();
        return {};
      }
    ),

  // ---------------- ผู้ติดต่อ ----------------
  saveContact: (contact: Omit<Contact, 'id'> & { id?: string }) =>
    define<Res<typeof saveContact>>(
      'saveContact',
      contact,
      (s) => saveContact(s, contact),
      async (ctx) => {
        const r = contact.id
          ? await ctx.send<Created>('PUT', `/contacts/${enc(contact.id)}`, contactBody(contact))
          : await ctx.send<Created>('POST', '/contacts', contactBody(contact));
        const next = await ctx.reload();
        return { contact: pickSaved(next.contacts, r.id ?? contact.id, 'ผู้ติดต่อ') };
      }
    ),

  /** นำเข้าทีละราย (ข้ามรหัสที่มีแล้ว) — ล้มกลางทาง: รายที่บันทึกแล้วคงอยู่ แจ้งจำนวนที่บันทึกได้ */
  importContacts: (contacts: Omit<Contact, 'id'>[]) =>
    define<Res<typeof importContacts>>(
      'importContacts',
      contacts,
      (s) => importContacts(s, contacts),
      async (ctx) => {
        const existing = new Set(ctx.before.contacts.map((c) => c.code));
        const fresh = contacts.filter((c) => !existing.has(c.code));
        let added = 0;
        try {
          // ทีละรายตามลำดับ — key ย่อยต่อราย (กดนำเข้าซ้ำหลังล้มเหลวไม่สร้างซ้ำ)
          // eslint-disable-next-line no-restricted-syntax
          for (const c of fresh) {
            // eslint-disable-next-line no-await-in-loop
            await ctx.send('POST', '/contacts', contactBody(c), c.code);
            added += 1;
          }
        } catch (error) {
          await ctx.reload();
          const why = error instanceof Error ? error.message : '';
          throw new BusinessRuleError(
            `นำเข้าได้ ${added} จาก ${fresh.length} รายการ — ${fresh[added]?.code ?? ''}: ${why}`
          );
        }
        await ctx.reload();
        return { added, skipped: contacts.length - fresh.length };
      }
    ),

  // ---------------- ธนาคาร ----------------
  addBankAccount: (input: BankAccountInput) =>
    define<Res<typeof addBankAccount>>(
      'addBankAccount',
      input,
      (s) => addBankAccount(s, input),
      async (ctx) => {
        const r = await ctx.send<{ accountCode: string }>('POST', '/bank-accounts', input);
        const next = await ctx.reload();
        const bank: BankAccount | undefined = next.bankAccounts.find(
          (b) => b.accountCode === r.accountCode
        );
        if (!bank)
          throw new BusinessRuleError('เพิ่มบัญชีแล้ว แต่โหลดข้อมูลล่าสุดไม่พบ — รีเฟรชหน้า');
        return { bank };
      }
    ),

  updateBankAccount: (
    accountCode: string,
    patch: Partial<Pick<BankAccount, 'bankName' | 'accountNo' | 'branch' | 'reconcileFrom'>>
  ) =>
    define<object>(
      'updateBankAccount',
      { accountCode, patch },
      (s) => ({ state: updateBankAccount(s, accountCode, patch) }),
      async (ctx) => {
        await ctx.send('PATCH', `/bank-accounts/${enc(accountCode)}`, patch);
        await ctx.reload();
        return {};
      }
    ),

  transferFunds: (input: TransferInput) =>
    define<Res<typeof transferFunds>>(
      'transferFunds',
      input,
      (s) => transferFunds(s, input),
      async (ctx) => {
        const r = await ctx.send<Created>('POST', '/transfers', input);
        const next = await ctx.reload();
        return { transfer: pickSaved(next.transfers, r.id, 'การโอนเงิน') };
      }
    ),

  addBankStatementLines: (input: {
    accountCode: string;
    lines: StatementLineInput[];
    imported?: boolean;
  }) =>
    define<Res<typeof addBankStatementLines>>(
      'addBankStatementLines',
      input,
      (s) => addBankStatementLines(s, input),
      async (ctx) => {
        const r = await ctx.send<{ added: unknown[]; skipped: number }>(
          'POST',
          `/bank-accounts/${enc(input.accountCode)}/statements`,
          {
            lines: input.lines,
            imported: input.imported ?? false,
          }
        );
        await ctx.reload();
        return { added: r.added.length, skipped: r.skipped };
      }
    ),

  deleteBankStatementLines: (ids: string[]) =>
    define<object>(
      'deleteBankStatementLines',
      ids,
      (s) => ({ state: deleteBankStatementLines(s, ids) }),
      async (ctx) => {
        await ctx.send('DELETE', '/bank-statements', { ids });
        await ctx.reload();
        return {};
      }
    ),

  matchBankItems: (input: {
    accountCode: string;
    statementLineIds: string[];
    journalIds: string[];
  }) =>
    define<Res<typeof matchBankItems>>(
      'matchBankItems',
      input,
      (s) => matchBankItems(s, input),
      async (ctx) => {
        const r = await ctx.send<Created>(
          'POST',
          `/bank-accounts/${enc(input.accountCode)}/matches`,
          {
            statementLineIds: input.statementLineIds,
            journalIds: input.journalIds,
          }
        );
        const next = await ctx.reload();
        return { match: pickSaved(next.bankMatches, r.id, 'การจับคู่') };
      }
    ),

  autoMatchBank: (accountCode: string, windowDays = 3) =>
    define<Res<typeof autoMatchBank>>(
      'autoMatchBank',
      { accountCode, windowDays },
      (s) => autoMatchBank(s, accountCode, windowDays),
      async (ctx) => {
        const r = await ctx.send<{ matched: number }>(
          'POST',
          `/bank-accounts/${enc(accountCode)}/auto-match`,
          { windowDays }
        );
        await ctx.reload();
        return { matched: r.matched };
      }
    ),

  unmatchBank: (matchId: string) =>
    define<object>(
      'unmatchBank',
      matchId,
      (s) => ({ state: unmatchBank(s, matchId) }),
      async (ctx) => {
        await ctx.send('DELETE', `/bank-matches/${enc(matchId)}`);
        await ctx.reload();
        return {};
      }
    ),

  // ---------------- ใบเสนอราคา ----------------
  saveQuotation: (input: QuotationInput) =>
    define<Res<typeof saveQuotation>>(
      'saveQuotation',
      input,
      (s) => saveQuotation(s, input),
      async (ctx) => {
        const body = {
          date: input.date,
          validDays: input.validDays,
          contactId: input.contactId,
          vatMode: input.vatMode,
          saleType: input.saleType,
          note: input.note,
          lines: docLines(input.lines),
        };
        const r = input.id
          ? await ctx.send<Created>('PUT', `/quotations/${enc(input.id)}`, body)
          : await ctx.send<Created>('POST', '/quotations', body);
        const next = await ctx.reload();
        return { quotation: pickSaved(next.quotations, r.id ?? input.id, 'ใบเสนอราคา') };
      }
    ),

  setQuotationStatus: (id: string, status: QuotationStatus) =>
    define<object>(
      'setQuotationStatus',
      { id, status },
      (s) => ({ state: setQuotationStatus(s, id, status) }),
      async (ctx) => {
        await ctx.send('POST', `/quotations/${enc(id)}/status`, { status });
        await ctx.reload();
        return {};
      }
    ),
};

export type Commands = typeof cmd;
