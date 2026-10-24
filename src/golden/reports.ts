import type {
  Period,
  WhtForm,
  WhtPayee,
  VatReportRow,
  JournalEntry,
  PartySnapshot,
  AccountingData,
  TrialBalanceRow,
  CompanySnapshot,
} from 'src/domain';

import {
  arAging,
  bucketOf,
  diffDays,
  eTaxDocs,
  toSatang,
  whtTotals,
  endOfMonth,
  monthKeyOf,
  normalSide,
  periodLabel,
  balanceSheet,
  buildETaxXml,
  trialBalance,
  vatReportCsv,
  outstandingOf,
  periodFromKey,
  pp30ForPeriod,
  profitAndLoss,
  dashboardStats,
  buildRdWhtFile,
  salesVatReport,
  customerCreditOf,
  whtCertificateOf,
  purchaseVatMonth,
  yearCloseProblem,
  purchaseVatReport,
  vatActivityMonths,
  yearCloseBalances,
  bankReconciliation,
  purchasePaidAmount,
  whtPayeesForPeriod,
  trialBalanceTotals,
  purchaseOutstanding,
  supplierRefundDueOf,
  buildReceiptETaxXml,
  purchaseAdjustedTotal,
  validateAccountingData,
  suggestedFiscalYearEnd,
} from 'src/domain';

import { replayScenario, scenarioCompany } from './scenarios';

import type { Scenario, ScenarioCheckpoint } from './scenarios';

// ----------------------------------------------------------------------
// Report golden (C5): รายงาน/ไฟล์ที่ฝั่งเซิร์ฟเวอร์ต้องสร้างได้ตรงกับหน้าเว็บทุกตัวอักษร/ทุกสตางค์
// สำหรับแต่ละ scenario (ไฟล์ scenarios-*.json): replay แล้วสร้างรายงานจาก state หลังขั้นกลาง + ขั้นสุดท้าย
//   งบทดลอง/กำไรขาดทุน/งบฐานะการเงิน (ทุกเดือนที่มีรายการ + ทั้งปี), บัญชีแยกประเภทรายบัญชี, รายงานภาษีขาย/ซื้อ + CSV,
//   ภ.พ.30 รวมยอดยกมา/ยกไป, ผู้ถูกหัก ณ ที่จ่าย + ไฟล์ ภ.ง.ด.3/53 (.txt + ชื่อไฟล์), 50 ทวิ, XML e-Tax (ยังไม่ลงนาม),
//   อายุลูกหนี้/ยอดค้างจ่ายเจ้าหนี้, ตัวเลขหน้าแรก, กระทบยอดธนาคาร, ปิดบัญชีสิ้นปี (ข้อเสนอ) และ validateAccountingData
// + integrity golden: แก้ state ตรง ๆ (จำลองข้อมูลถูกแก้นอกระบบ) แล้วเก็บรายการปัญหา
// id ของ TS สุ่ม — ผลอ้างเอกสารด้วยเลขที่, ผู้ติดต่อด้วยรหัส, statement ด้วยลำดับที่นำเข้า (ref); เงินเป็นสตางค์
// ----------------------------------------------------------------------

/** เวลาสร้างไฟล์ XML e-Tax ที่ใช้ใน golden (หน้าเว็บใช้เวลาปัจจุบัน) */
export const ETAX_CREATED_AT = '2026-10-25T09:00:00';

/** วันที่ที่ใช้เมื่อสมุดยังไม่มีรายการเลย */
const EMPTY_AS_OF = '2026-10-31';

const sat = (baht: number | undefined): number | null => (baht === undefined ? null : toSatang(baht));

/** เรียงแบบ ordinal (ฝั่ง C# เทียบด้วย StringComparer.Ordinal) */
const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type Refs = {
  contact: (id: string) => string;
  doc: (id: string | undefined) => string | null;
  journal: (id: string | undefined) => string | null;
  statement: (id: string) => number;
};

function refsOf(state: AccountingData, statementRefs: ReadonlyMap<string, number>): Refs {
  const contacts = new Map(state.contacts.map((c) => [c.id, c.code]));
  const docs = new Map(
    [...state.sales, ...state.receipts, ...state.purchases, ...state.payments, ...state.purchaseCredits].map((d) => [d.id, d.docNo])
  );
  const journal = new Map(state.journal.map((e) => [e.id, e.docNo]));
  return {
    contact: (id) => contacts.get(id) ?? '?',
    doc: (id) => (id ? docs.get(id) ?? '?' : null),
    journal: (id) => (id ? journal.get(id) ?? '?' : null),
    statement: (id) => statementRefs.get(id) ?? 0,
  };
}

// ---------------- เดือน / วันที่ของรายงาน ----------------

/** เดือนที่มีรายการ: วันที่รายการบัญชี + เดือนภาษี (ภาษีขาย/ซื้อ/ใบลดหนี้ผู้ขาย) + เดือนที่จ่าย เรียงจากเก่าไปใหม่ */
export function reportMonths(state: AccountingData): string[] {
  const months = new Set<string>();
  state.journal.forEach((e) => months.add(monthKeyOf(e.date)));
  vatActivityMonths(state).forEach((m) => months.add(m));
  state.purchases.filter((p) => p.claimVat).forEach((p) => months.add(purchaseVatMonth(p)));
  state.payments.forEach((p) => months.add(monthKeyOf(p.date)));
  return Array.from(months).sort();
}

/** วันที่ของรายงาน "ณ วันที่" = สิ้นเดือนล่าสุดที่มีรายการ */
export function reportAsOf(state: AccountingData): string {
  const months = reportMonths(state);
  return months.length ? endOfMonth(months[months.length - 1]) : EMPTY_AS_OF;
}

// ---------------- งบ ----------------

function tbOut(rows: TrialBalanceRow[]) {
  const totals = trialBalanceTotals(rows);
  return {
    rows: rows.map((r) => ({
      code: r.account.code,
      name: r.account.name,
      type: r.account.type,
      debit: toSatang(r.debit),
      credit: toSatang(r.credit),
      balance: toSatang(r.balance),
    })),
    totals: { debit: toSatang(totals.debit), credit: toSatang(totals.credit), balanced: totals.balanced },
  };
}

function plOut(state: AccountingData, from: string, to: string) {
  const pl = profitAndLoss(state.accounts, state.journal, from, to);
  const row = (r: TrialBalanceRow) => ({ code: r.account.code, name: r.account.name, balance: toSatang(r.balance) });
  return {
    from,
    to,
    revenue: pl.revenue.map(row),
    expense: pl.expense.map(row),
    totalRevenue: toSatang(pl.totalRevenue),
    totalExpense: toSatang(pl.totalExpense),
    netProfit: toSatang(pl.netProfit),
  };
}

function bsOut(state: AccountingData, asOf: string) {
  const bs = balanceSheet(state.accounts, state.journal, asOf);
  const row = (r: { account: { code: string; name: string }; balance: number }) => ({
    code: r.account.code,
    name: r.account.name,
    balance: toSatang(r.balance),
  });
  return {
    asOf,
    assets: bs.assets.map(row),
    liabilities: bs.liabilities.map(row),
    equity: bs.equity.map(row),
    totalAssets: toSatang(bs.totalAssets),
    totalLiabilities: toSatang(bs.totalLiabilities),
    totalEquityAccounts: toSatang(bs.totalEquityAccounts),
    unclosedProfit: toSatang(bs.unclosedProfit),
    totalEquity: toSatang(bs.totalEquity),
    totalLiabilitiesAndEquity: toSatang(bs.totalLiabilitiesAndEquity),
    balanced: bs.balanced,
  };
}

/**
 * บัญชีแยกประเภทรายบัญชี (นิยามอ้างอิงของ golden — หน้าเว็บยังไม่มีหน้านี้):
 * รายการเรียงตามวันที่แล้วเลขที่ (ordinal), บรรทัดตามลำดับในรายการ; ยอดคงเหลือด้านปกติของบัญชี (เดบิต: สินทรัพย์/ค่าใช้จ่าย)
 * ยกมา = ยอดของรายการก่อน `from`; คำอธิบาย = คำอธิบายบรรทัด (ไม่มี = คำอธิบายรายการ)
 */
export function accountLedger(state: AccountingData, code: string, from?: string, to?: string) {
  const account = state.accounts.find((a) => a.code === code);
  const sign = account && normalSide(account.type) === 'credit' ? -1 : 1;
  const entries = state.journal
    .filter((e) => !to || e.date <= to)
    .slice()
    .sort((a, b) => ordinal(a.date, b.date) || ordinal(a.docNo, b.docNo));
  const movement = (e: JournalEntry) =>
    e.lines.filter((l) => l.accountCode === code).reduce((acc, l) => acc + toSatang(l.debit) - toSatang(l.credit), 0);
  const opening = sign * entries.filter((e) => from && e.date < from).reduce((acc, e) => acc + movement(e), 0) + 0;
  let balance = opening;
  let debit = 0;
  let credit = 0;
  const lines: {
    date: string;
    docNo: string;
    source: string;
    sourceDocNo: string | null;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }[] = [];
  entries
    .filter((e) => !from || e.date >= from)
    .forEach((e) =>
      e.lines
        .filter((l) => l.accountCode === code)
        .forEach((l) => {
          const d = toSatang(l.debit);
          const c = toSatang(l.credit);
          debit += d;
          credit += c;
          balance += sign * (d - c);
          lines.push({
            date: e.date,
            docNo: e.docNo,
            source: e.source,
            sourceDocNo: e.sourceDocNo ?? null,
            description: l.description || e.description,
            debit: d,
            credit: c,
            balance,
          });
        })
    );
  return { code, name: account?.name ?? null, type: account?.type ?? null, from: from ?? null, to: to ?? null, opening, debit, credit, closing: balance, lines };
}

/** บัญชีที่มีรายการ เรียงตามรหัส (ordinal) */
function accountsWithLines(state: AccountingData): string[] {
  return Array.from(new Set(state.journal.flatMap((e) => e.lines.map((l) => l.accountCode)))).sort(ordinal);
}

// ---------------- ภาษีมูลค่าเพิ่ม ----------------

function vatRowOut(r: VatReportRow) {
  return {
    date: r.date,
    docNo: r.docNo,
    refDocNo: r.refDocNo ?? null,
    recordedDate: r.recordedDate ?? null,
    contactName: r.contactName,
    taxId: r.taxId,
    branchNo: r.branchNo,
    net: toSatang(r.net),
    vat: toSatang(r.vat),
    kind: r.kind,
  };
}

/** ชื่อรายงานใน CSV (เหมือนหน้าเว็บ `VatReportTab`) */
export function vatReportTitle(kind: 'sales' | 'purchase', period: Period): string {
  return `${kind === 'sales' ? 'รายงานภาษีขาย' : 'รายงานภาษีซื้อ'} เดือน${periodLabel(period)}`;
}

/** ชื่อไฟล์ CSV (เหมือนหน้าเว็บ) */
export function vatReportFileName(kind: 'sales' | 'purchase', period: Period): string {
  return `${kind === 'sales' ? 'sales' : 'purchase'}-vat-${period.year}-${String(period.month).padStart(2, '0')}.csv`;
}

function vatOut(state: AccountingData, month: string) {
  const period = periodFromKey(month);
  const sales = salesVatReport(state.sales, state.contacts, period, state.receipts);
  const purchases = purchaseVatReport(state.purchases, state.contacts, period, state.purchaseCredits);
  const pp30 = pp30ForPeriod(state, period);
  return {
    month,
    sales: sales.map(vatRowOut),
    purchases: purchases.map(vatRowOut),
    salesCsv: { fileName: vatReportFileName('sales', period), content: vatReportCsv(sales, vatReportTitle('sales', period)) },
    purchaseCsv: { fileName: vatReportFileName('purchase', period), content: vatReportCsv(purchases, vatReportTitle('purchase', period)) },
    pp30: {
      salesNet: toSatang(pp30.salesNet),
      outputVat: toSatang(pp30.outputVat),
      purchaseNet: toSatang(pp30.purchaseNet),
      inputVat: toSatang(pp30.inputVat),
      netVat: toSatang(pp30.netVat),
      broughtForward: toSatang(pp30.broughtForward),
      payable: toSatang(pp30.payable),
      carriedForward: toSatang(pp30.carriedForward),
      closed: !!pp30.closed,
    },
  };
}

// ---------------- หัก ณ ที่จ่าย ----------------

function partyOut(p: PartySnapshot) {
  return {
    title: p.title,
    name: p.name,
    lastName: p.lastName ?? null,
    taxId: p.taxId,
    branchNo: p.branchNo,
    legalForm: p.legalForm,
    email: p.email ?? null,
    address: { ...p.address },
  };
}

function companyOut(c: CompanySnapshot) {
  return {
    name: c.name,
    taxId: c.taxId,
    branchNo: c.branchNo,
    email: c.email ?? null,
    phone: c.phone ?? null,
    vatRegistered: c.vatRegistered,
    address: { ...c.address },
  };
}

function payeeOut(refs: Refs, p: WhtPayee) {
  const c = p.contact;
  return {
    contact: {
      code: c.code,
      title: c.title,
      name: c.name,
      lastName: c.lastName ?? null,
      taxId: c.taxId ?? '',
      branchNo: c.branchNo ?? '',
      legalForm: c.legalForm,
      address: { ...c.address },
    },
    items: p.items.map((i) => ({
      docNo: i.docNo,
      purchaseDocNo: i.purchaseDocNo,
      certNo: i.certNo ?? null,
      paidDate: i.paidDate,
      rate: i.rate,
      amount: toSatang(i.amount),
      tax: toSatang(i.tax),
      incomeType: i.incomeType,
      condition: i.condition,
    })),
  };
}

function whtOut(state: AccountingData, refs: Refs, month: string) {
  const period = periodFromKey(month);
  const forms: WhtForm[] = ['PND3', 'PND53'];
  return {
    month,
    forms: forms.map((form) => {
      const payees = whtPayeesForPeriod(state, period, form);
      const totals = whtTotals(payees);
      const file = buildRdWhtFile({ form, company: state.company, period, payees });
      return {
        form,
        payees: payees.map((p) => payeeOut(refs, p)),
        totals: { payees: totals.payees, amount: toSatang(totals.amount), tax: toSatang(totals.tax) },
        file,
      };
    }),
  };
}

function certificatesOut(state: AccountingData) {
  return state.payments
    .filter((p) => p.whtCertNo)
    .slice()
    .sort((a, b) => ordinal(a.whtCertNo ?? '', b.whtCertNo ?? ''))
    .map((p) => {
      const cert = whtCertificateOf(state, p.id);
      if (!cert) return { paymentDocNo: p.docNo, certificate: null };
      return {
        paymentDocNo: p.docNo,
        certificate: {
          certNo: cert.certNo,
          bookNo: cert.bookNo,
          seqInBook: cert.seqInBook,
          date: cert.date,
          form: cert.form,
          sequence: cert.sequence ?? null,
          payer: companyOut(cert.payer),
          payee: partyOut(cert.payee),
          items: cert.items.map((i) => ({ incomeType: i.incomeType, rate: i.rate, paidDate: i.paidDate, base: toSatang(i.base), tax: toSatang(i.tax) })),
          totalBase: toSatang(cert.totalBase),
          totalTax: toSatang(cert.totalTax),
          totalTaxText: cert.totalTaxText,
          condition: cert.condition,
          paymentDocNo: cert.paymentDocNo,
          purchaseDocNo: cert.purchaseDocNo,
        },
      };
    });
}

// ---------------- e-Tax ----------------

function etaxOut(state: AccountingData) {
  const contacts = new Map(state.contacts.map((c) => [c.id, c]));
  return eTaxDocs(state).map((row) => {
    const buyer = contacts.get(row.contactId);
    const out = { docNo: row.docNo, source: row.source, etax: row.etax, fileName: `${row.docNo}.xml` };
    try {
      if (row.source === 'receipt') {
        const receipt = state.receipts.find((r) => r.id === row.id);
        const invoice = receipt && state.sales.find((s) => s.id === receipt.invoiceId);
        if (!receipt || !invoice) throw new Error(`${row.docNo} ไม่พบใบแจ้งหนี้ที่อ้างถึง`);
        return { ...out, xml: buildReceiptETaxXml({ receipt, invoice, company: state.company, buyer, createdAt: ETAX_CREATED_AT }), error: null };
      }
      const doc = state.sales.find((s) => s.id === row.id);
      if (!doc) throw new Error(`${row.docNo} ไม่พบเอกสาร`);
      const referenced = doc.refDocId ? state.sales.find((s) => s.id === doc.refDocId) : undefined;
      const referencedReceipt = doc.refReceiptId ? state.receipts.find((r) => r.id === doc.refReceiptId) : undefined;
      return {
        ...out,
        xml: buildETaxXml({ doc, company: state.company, buyer, referenced, referencedReceipt, createdAt: ETAX_CREATED_AT }),
        error: null,
      };
    } catch (error) {
      return { ...out, xml: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

// ---------------- ลูกหนี้ / เจ้าหนี้ ----------------

function receivablesOut(state: AccountingData, refs: Refs, asOf: string) {
  const aging = arAging(state.sales, (d) => outstandingOf(state, d), asOf);
  const buckets: Record<string, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  aging.forEach((a) => {
    buckets[a.bucket] += toSatang(a.outstanding);
  });
  return {
    asOf,
    rows: aging.map((a) => ({
      docNo: a.doc.docNo,
      contact: refs.contact(a.doc.contactId),
      date: a.doc.date,
      dueDate: a.doc.dueDate,
      outstanding: toSatang(a.outstanding),
      daysOverdue: a.daysOverdue,
      bucket: a.bucket,
    })),
    buckets,
    total: aging.reduce((acc, a) => acc + toSatang(a.outstanding), 0),
    customerCredits: state.contacts
      .map((c) => ({ contact: c.code, amount: toSatang(customerCreditOf(state, c.id)) }))
      .filter((c) => c.amount !== 0)
      .sort((a, b) => ordinal(a.contact, b.contact)),
  };
}

/**
 * เจ้าหนี้คงค้าง (นิยามอ้างอิงของ golden): เอกสารซื้อที่ยอดค้างจ่าย > 0 เรียงตามวันที่แล้วเลขที่ (ordinal)
 * อายุ = จำนวนวันจากวันที่บันทึกถึง `asOf` (เอกสารซื้อไม่มีวันครบกำหนด) จัดกลุ่มแบบเดียวกับอายุลูกหนี้
 */
export function payablesOut(state: AccountingData, asOf: string) {
  const contacts = new Map(state.contacts.map((c) => [c.id, c.code]));
  const rows = state.purchases
    .map((p) => ({ p, outstanding: toSatang(purchaseOutstanding(state, p)) }))
    .filter((r) => r.outstanding > 0)
    .sort((a, b) => ordinal(a.p.date, b.p.date) || ordinal(a.p.docNo, b.p.docNo))
    .map(({ p, outstanding }) => {
      const days = diffDays(p.date, asOf);
      return {
        docNo: p.docNo,
        contact: contacts.get(p.contactId) ?? '?',
        date: p.date,
        supplierInvoiceNo: p.supplierInvoiceNo,
        total: toSatang(purchaseAdjustedTotal(state, p)),
        paid: toSatang(purchasePaidAmount(state, p)),
        outstanding,
        days,
        bucket: bucketOf(days),
      };
    });
  const buckets: Record<string, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  rows.forEach((r) => {
    buckets[r.bucket] += r.outstanding;
  });
  return {
    asOf,
    rows,
    buckets,
    total: rows.reduce((acc, r) => acc + r.outstanding, 0),
    supplierRefundDue: state.contacts
      .map((c) => ({ contact: c.code, amount: toSatang(supplierRefundDueOf(state, c.id)) }))
      .filter((c) => c.amount !== 0)
      .sort((a, b) => ordinal(a.contact, b.contact)),
  };
}

// ---------------- หน้าแรก / ธนาคาร / ปิดปี ----------------

function dashboardOut(state: AccountingData, refs: Refs, today: string) {
  const s = dashboardStats(state, today);
  return {
    today,
    cash: toSatang(s.cash),
    receivable: toSatang(s.receivable),
    overdue: s.overdue.map((o) => ({ docNo: o.doc.docNo, outstanding: toSatang(o.outstanding), daysOverdue: o.daysOverdue })),
    payable: toSatang(s.payable),
    unpaidPurchases: s.unpaidPurchases.map((p) => p.docNo),
    pp30: {
      outputVat: toSatang(s.pp30.outputVat),
      inputVat: toSatang(s.pp30.inputVat),
      broughtForward: toSatang(s.pp30.broughtForward),
      payable: toSatang(s.pp30.payable),
      carriedForward: toSatang(s.pp30.carriedForward),
      closed: !!s.pp30.closed,
    },
    whtPrev: toSatang(s.whtPrev),
    etaxWaiting: s.etaxWaiting.map((d) => d.docNo),
    badContacts: s.badContacts.map((c) => c.code),
    aging: s.aging.map((a) => a.doc.docNo),
    customerCredits: toSatang(s.customerCredits),
  };
}

function bankOut(state: AccountingData, refs: Refs, asOfs: string[]) {
  return state.bankAccounts
    .filter((b) => b.kind === 'bank')
    .slice()
    .sort((a, b) => ordinal(a.accountCode, b.accountCode))
    .flatMap((b) =>
      asOfs.map((asOf) => {
        const r = bankReconciliation(state, b.accountCode, asOf);
        return {
          accountCode: b.accountCode,
          asOf,
          bookBalance: toSatang(r.bookBalance),
          outstanding: r.outstanding.map((m) => ({ docNo: m.docNo, sourceDocNo: m.sourceDocNo ?? null, date: m.date, description: m.description, amount: toSatang(m.amount) })),
          unbooked: r.unbooked.map((l) => ({ ref: refs.statement(l.id), date: l.date, description: l.description, amount: toSatang(l.amount) })),
          expectedStatementBalance: toSatang(r.expectedStatementBalance),
          statementBalance: sat(r.statementBalance),
          difference: sat(r.difference),
          matchedCount: r.matchedCount,
        };
      })
    );
}

function yearEndOut(state: AccountingData) {
  const suggested = suggestedFiscalYearEnd(state) ?? null;
  if (!suggested) return { suggested, problem: null, balances: [], netProfit: 0 };
  const { balances, netProfit } = yearCloseBalances(state, suggested);
  return {
    suggested,
    problem: yearCloseProblem(state, suggested),
    balances: balances.map((b) => ({ accountCode: b.accountCode, type: b.type, debit: toSatang(b.debit) })),
    netProfit: toSatang(netProfit),
  };
}

// ---------------- รวม ----------------

/** รายงานทั้งหมดของ state หนึ่ง (ณ สิ้นเดือนล่าสุดที่มีรายการ) */
export function reportsOf(checkpoint: Pick<ScenarioCheckpoint, 'state' | 'statementRefs'>) {
  const { state } = checkpoint;
  const refs = refsOf(state, checkpoint.statementRefs);
  const months = reportMonths(state);
  const asOf = reportAsOf(state);
  const monthEnds = months.map(endOfMonth);
  const years = Array.from(new Set(months.map((m) => m.slice(0, 4))));
  const lastMonth = months.length ? months[months.length - 1] : monthKeyOf(asOf);
  const accounts = accountsWithLines(state);
  const paymentMonths = Array.from(new Set(state.payments.filter((p) => p.whtItems.length).map((p) => monthKeyOf(p.date)))).sort();
  return {
    asOf,
    months,
    trialBalances: [...monthEnds.filter((d) => d !== asOf), asOf].map((d) => ({ asOf: d, ...tbOut(trialBalance(state.accounts, state.journal, d)) })),
    profitAndLoss: [
      ...months.map((m) => plOut(state, `${m}-01`, endOfMonth(m))),
      ...years.map((y) => plOut(state, `${y}-01-01`, `${y}-12-31`)),
    ],
    balanceSheets: [...monthEnds.filter((d) => d !== asOf), asOf].map((d) => bsOut(state, d)),
    ledgers: [
      ...accounts.map((code) => accountLedger(state, code)),
      ...accounts.map((code) => accountLedger(state, code, `${lastMonth}-01`, asOf)),
    ],
    vat: months.map((m) => vatOut(state, m)),
    wht: paymentMonths.map((m) => whtOut(state, refs, m)),
    certificates: certificatesOut(state),
    etax: etaxOut(state),
    receivables: receivablesOut(state, refs, asOf),
    payables: payablesOut(state, asOf),
    dashboard: dashboardOut(state, refs, asOf),
    bank: bankOut(state, refs, [...monthEnds.filter((d) => d !== asOf), asOf]),
    yearEnd: yearEndOut(state),
    integrity: validateAccountingData(state),
  };
}

export type ReportScenarioFile = { file: string; scenarios: Scenario[] };

/** ขั้นที่สร้างรายงาน (เริ่ม 1): กลาง scenario และขั้นสุดท้าย */
export function reportCheckpoints(scenario: Scenario): number[] {
  const n = scenario.steps.length;
  return Array.from(new Set([Math.ceil(n / 2), n])).filter((i) => i >= 1);
}

/** vector ของรายงาน 1 scenario: input = { file, scenario, company, checkpoints, etaxCreatedAt }, output = รายงานต่อ checkpoint */
export function reportVector(file: string, scenario: Scenario) {
  const checkpoints = reportCheckpoints(scenario);
  const output: ({ afterStep: number } & ReturnType<typeof reportsOf>)[] = [];
  replayScenario(scenario, (cp) => {
    if (checkpoints.includes(cp.index)) output.push({ afterStep: cp.index, ...reportsOf(cp) });
  });
  return {
    name: `reports/${file}/${scenario.name}`,
    input: { file, scenario: scenario.name, company: scenarioCompany(scenario), checkpoints, etaxCreatedAt: ETAX_CREATED_AT },
    output,
  };
}

// ---------------- integrity: ข้อมูลที่ถูกแก้ ----------------

/**
 * การแก้ข้อมูลตรง ๆ (นอก action) — ฝั่ง C# ทำแบบเดียวกันด้วย SQL (superuser, ปิด trigger) แล้วตรวจด้วย /integrity
 * เงินเป็นบาท; เอกสารอ้างด้วยเลขที่
 */
export type Corruption =
  | { op: 'journalLines'; docNo: string; lines: { line: number; debit: number; credit: number }[] }
  | { op: 'journalDate'; docNo: string; date: string }
  | { op: 'salesPaidAmount'; docNo: string; paidAmount: number }
  | { op: 'purchasePaid'; docNo: string; paid: boolean }
  | { op: 'deleteReceipt'; docNo: string }
  | { op: 'sequence'; key: string; value: number }
  | { op: 'vatCloseOutput'; period: string; outputVat: number }
  | { op: 'receiptVat'; docNo: string; vat: number }
  | { op: 'statementAmount'; ref: number; amount: number };

export type CorruptionCase = { name: string; file: string; scenario: string; afterStep: number; corruptions: Corruption[] };

export function applyCorruption(state: AccountingData, refs: ReadonlyMap<string, number>, c: Corruption): AccountingData {
  switch (c.op) {
    case 'journalLines':
      return {
        ...state,
        journal: state.journal.map((e) =>
          e.docNo !== c.docNo
            ? e
            : {
                ...e,
                lines: e.lines.map((l, i) => {
                  const edit = c.lines.find((x) => x.line === i + 1);
                  return edit ? { ...l, debit: edit.debit, credit: edit.credit } : l;
                }),
              }
        ),
      };
    case 'journalDate':
      return { ...state, journal: state.journal.map((e) => (e.docNo === c.docNo ? { ...e, date: c.date } : e)) };
    case 'salesPaidAmount':
      return { ...state, sales: state.sales.map((s) => (s.docNo === c.docNo ? { ...s, paidAmount: c.paidAmount } : s)) };
    case 'purchasePaid':
      return { ...state, purchases: state.purchases.map((p) => (p.docNo === c.docNo ? { ...p, paid: c.paid } : p)) };
    case 'deleteReceipt':
      return { ...state, receipts: state.receipts.filter((r) => r.docNo !== c.docNo) };
    case 'sequence':
      return { ...state, sequences: { ...state.sequences, [c.key]: c.value } };
    case 'vatCloseOutput':
      return { ...state, vatCloses: state.vatCloses.map((v) => (v.period === c.period ? { ...v, outputVat: c.outputVat } : v)) };
    case 'receiptVat':
      return { ...state, receipts: state.receipts.map((r) => (r.docNo === c.docNo ? { ...r, vat: c.vat } : r)) };
    case 'statementAmount':
      return {
        ...state,
        bankStatements: state.bankStatements.map((l) => (refs.get(l.id) === c.ref ? { ...l, amount: c.amount } : l)),
      };
    default:
      throw new Error('unknown corruption');
  }
}

/**
 * กรณีข้อมูลถูกแก้ — เลือกเฉพาะการแก้ที่ข้อจำกัดของ DB (check/unique/FK/trigger สมดุล) ยังยอมให้เกิดได้เมื่อปิด trigger
 * (เช่น แก้ทั้งสองฝั่งของรายการให้ยังสมดุล) เพื่อให้ฝั่ง C# จำลองได้และผลเทียบกันได้ทุกข้อความ
 */
export const CORRUPTION_CASES: CorruptionCase[] = [
  {
    name: 'journal-amount-changed-balanced',
    file: 'scenarios-sales.json',
    scenario: 'goods-exclusive-full-payment-etax',
    afterStep: 14,
    corruptions: [
      {
        op: 'journalLines',
        docNo: 'JV6910-0001',
        lines: [
          { line: 1, debit: 13_000, credit: 0 },
          { line: 2, debit: 0, credit: 12_500 },
          { line: 4, debit: 0, credit: 50 },
        ],
      },
    ],
  },
  {
    name: 'paid-amount-and-receipt-removed',
    file: 'scenarios-sales.json',
    scenario: 'goods-inclusive-partial-receipts',
    afterStep: 13,
    corruptions: [
      { op: 'salesPaidAmount', docNo: 'IV6909-0001', paidAmount: 3_000 },
      { op: 'deleteReceipt', docNo: 'RE6910-0001' },
    ],
  },
  {
    name: 'sequence-counter-and-journal-date',
    file: 'scenarios-sales.json',
    scenario: 'date-order-and-validation',
    afterStep: 37,
    corruptions: [
      { op: 'sequence', key: 'IV6910', value: 5 },
      { op: 'journalDate', docNo: 'JV6910-0003', date: '2026-10-25' },
    ],
  },
  {
    name: 'purchase-paid-flag',
    file: 'scenarios-purchases.json',
    scenario: 'purchase-wht-lines-partial-payments',
    afterStep: 20,
    corruptions: [{ op: 'purchasePaid', docNo: 'PI6910-0001', paid: false }],
  },
  {
    name: 'vat-close-and-service-receipt-vat',
    file: 'scenarios-closing.json',
    scenario: 'monthly-vat-close-carry-forward',
    afterStep: 21,
    corruptions: [
      { op: 'vatCloseOutput', period: '2026-10', outputVat: 2_500 },
      { op: 'receiptVat', docNo: 'RT6910-0001', vat: 150 },
    ],
  },
  {
    name: 'bank-statement-amount',
    file: 'scenarios-banking.json',
    scenario: 'bank-statement-import-matching',
    afterStep: 36,
    corruptions: [{ op: 'statementAmount', ref: 1, amount: 49_999 }],
  },
];

/** vector ของ integrity: input = กรณี, output = รายการปัญหาหลังแก้ (state ก่อนแก้ต้องไม่มีปัญหา) */
export function corruptionVector(c: CorruptionCase, scenarios: Record<string, Scenario[]>) {
  const scenario = scenarios[c.file]?.find((s) => s.name === c.scenario);
  if (!scenario) throw new Error(`integrity golden: scenario ${c.file}/${c.scenario} not found`);
  if (c.afterStep < 1 || c.afterStep > scenario.steps.length) throw new Error(`integrity golden: ${c.name} afterStep out of range`);
  let problems: string[] | undefined;
  replayScenario(scenario, (cp) => {
    if (cp.index !== c.afterStep) return;
    const before = validateAccountingData(cp.state);
    if (before.length) throw new Error(`integrity golden: ${c.name} state already has problems: ${before.join(' / ')}`);
    const corrupted = c.corruptions.reduce((s, x) => applyCorruption(s, cp.statementRefs, x), cp.state);
    problems = validateAccountingData(corrupted);
  });
  if (!problems?.length) throw new Error(`integrity golden: ${c.name} produced no problems`);
  return { name: `integrity/${c.name}`, input: { ...c }, output: problems };
}
