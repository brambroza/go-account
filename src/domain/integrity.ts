import { calcDocument } from './document-calc';
import { subBaht, sumBaht, toSatang, fromSatang } from './money';
import { normalizeTaxId, normalizeBranch5 } from './thai-tax-id';
import { salesVatReport, purchaseVatReport } from './vat-report';
import { taxedPartsOf, receiptVatOf, deferredVatOf } from './service-vat';
import { isBankKindCode, bankMatchProblem, minCashBalanceFrom } from './bank';
import { isTaxDocument, isServiceInvoice, isDeferredVatDoc } from './sales-doc';
import { sortedYearCloses, yearCloseBalances, openingItemTotals } from './year-end';
import { parseDocNo, DATE_ORDERED_PREFIXES, openingNumberConflict } from './numbering';
import { ACC, isCashAccount, isControlAccount, lineAccountProblem } from './chart-of-accounts';
import { vatCloseDraft, latestVatCredit, vatCloseFigures, vatActivityMonths } from './vat-close';
import { endOfMonth, monthKeyOf, docPeriodCode, shiftMonthKey, formatThaiDate, isValidISODate } from './thai-date';
import {
  outstandingOf,
  debitedTotalOf,
  creditedPartsOf,
  creditedTotalOf,
  invoiceCeilingOf,
  customerCreditOf,
} from './receivables';
import {
  paymentsOf,
  vatClaimProblem,
  purchaseVatMonth,
  purchaseWhtGroups,
  purchaseCreditsOf,
  supplierRefundDueOf,
  purchaseOutstanding,
  purchaseCreditedParts,
  purchaseAdjustedTotal,
  purchaseCreditAllocation,
  purchaseAdjustedWhtGroups,
} from './purchase';
import {
  isBalanced,
  postReceipt,
  postPurchase,
  postVatClose,
  postYearClose,
  postDebitNote,
  postCreditNote,
  postSalesInvoice,
  postBankTransfer,
  postSupplierRefund,
  postCustomerRefund,
  postOpeningBalance,
  postPurchasePayment,
  postPurchaseCreditNote,
} from './posting';

import type { LineSide } from './chart-of-accounts';
import type { ISODate, SalesDoc, JournalLine, JournalEntry, AccountingData } from './types';

// ----------------------------------------------------------------------
// ตรวจความถูกต้องของข้อมูลทั้งก้อน (invariant) — ใช้ก่อนกู้คืน backup และตอนโหลดจากเครื่อง
// คืนรายการปัญหาเป็นข้อความภาษาไทย ว่าง = ผ่าน (ไม่ throw ให้หน้าจอแสดงรายการให้ผู้ใช้ตัดสินใจ)
// ----------------------------------------------------------------------

const SALES_PREFIXES: Record<SalesDoc['kind'], readonly string[]> = {
  'tax-invoice': ['IV', 'BL'],
  'credit-note': ['CN', 'CM'],
  'debit-note': ['DN', 'DM'],
};

export type NumberedDoc = { docNo: string; date: ISODate; prefixes: readonly string[]; label: string };

/** เอกสารที่ใช้เลขที่ของระบบเรา (ยอดยกมาใช้เลขที่ของระบบเดิม จึงไม่นับ) */
function collectNumberedDocs(data: AccountingData): NumberedDoc[] {
  return [
    ...data.sales
      .filter((s) => !s.opening)
      .map((s) => ({
        docNo: s.docNo,
        date: s.date,
        prefixes: SALES_PREFIXES[s.kind],
        label: 'เอกสารขาย',
      })),
    ...data.receipts.map((r) => ({
      docNo: r.docNo,
      date: r.date,
      prefixes: r.isTaxInvoice ? ['RT'] : ['RE'],
      label: r.isTaxInvoice ? 'ใบเสร็จรับเงิน/ใบกำกับภาษี' : 'ใบเสร็จ',
    })),
    ...data.purchases.filter((p) => !p.opening).map((p) => ({ docNo: p.docNo, date: p.date, prefixes: ['PI'], label: 'เอกสารซื้อ' })),
    ...data.purchaseCredits.map((c) => ({ docNo: c.docNo, date: c.date, prefixes: ['PC'], label: 'ใบลดหนี้จากผู้ขาย' })),
    ...data.payments.map((p) => ({ docNo: p.docNo, date: p.date, prefixes: ['PV'], label: 'ใบสำคัญจ่าย' })),
    ...data.payments
      .filter((p) => p.whtCertNo)
      .map((p) => ({ docNo: p.whtCertNo as string, date: p.date, prefixes: ['WT'], label: 'หนังสือรับรอง 50 ทวิ' })),
    ...data.refunds.map((r) => ({ docNo: r.docNo, date: r.date, prefixes: ['RF'], label: 'ใบคืนเงิน' })),
    ...(data.supplierRefunds ?? []).map((r) => ({ docNo: r.docNo, date: r.date, prefixes: ['SR'], label: 'ใบรับเงินคืนจากผู้ขาย' })),
    ...data.transfers.map((t) => ({ docNo: t.docNo, date: t.date, prefixes: ['TR'], label: 'ใบโอนเงิน' })),
    ...data.quotations.map((q) => ({ docNo: q.docNo, date: q.date, prefixes: ['QT'], label: 'ใบเสนอราคา' })),
    ...data.journal.map((e) => ({ docNo: e.docNo, date: e.date, prefixes: ['JV'], label: 'สมุดรายวัน' })),
  ];
}

/** เลขที่เอกสาร: รูปแบบถูก, งวดตรงวันที่, ไม่ซ้ำ, ต่อเนื่อง 1..n ต่อ prefix ต่อเดือน และตรงกับตัวนับ */
function checkNumbering(data: AccountingData, problems: string[]) {
  const seen = new Set<string>();
  const byKey = new Map<string, number[]>();

  collectNumberedDocs(data).forEach((d) => {
    const parsed = parseDocNo(d.docNo);
    if (!parsed || !d.prefixes.includes(parsed.prefix)) {
      problems.push(`${d.label} เลขที่ "${d.docNo}" รูปแบบไม่ถูกต้อง`);
      return;
    }
    if (!isValidISODate(d.date)) {
      problems.push(`${d.docNo}: วันที่ "${d.date}" ไม่ถูกต้อง (ต้องเป็น ค.ศ. YYYY-MM-DD)`);
      return;
    }
    if (parsed.period !== docPeriodCode(d.date)) {
      problems.push(`${d.docNo}: งวดในเลขที่ไม่ตรงกับวันที่ ${d.date}`);
    }
    if (seen.has(d.docNo)) {
      problems.push(`เลขที่ ${d.docNo} ซ้ำ`);
      return;
    }
    seen.add(d.docNo);
    const key = `${parsed.prefix}${parsed.period}`;
    byKey.set(key, [...(byKey.get(key) ?? []), parsed.seq]);
  });

  byKey.forEach((seqs, key) => {
    const sorted = seqs.slice().sort((a, b) => a - b);
    const gap = sorted.findIndex((n, i) => n !== i + 1);
    if (gap >= 0) problems.push(`เลขที่ ${key} ไม่ต่อเนื่อง: ขาดเลข ${gap + 1}`);
    const counter = data.sequences[key] ?? 0;
    if (counter !== sorted.length) {
      problems.push(`ตัวนับเลขที่ ${key} = ${counter} แต่มีเอกสาร ${sorted.length} ใบ`);
    }
  });
  Object.entries(data.sequences).forEach(([key, value]) => {
    if (value > 0 && !byKey.has(key)) problems.push(`ตัวนับเลขที่ ${key} = ${value} แต่ไม่พบเอกสาร`);
  });
}

function checkJournal(data: AccountingData, problems: string[]) {
  const accounts = new Set(data.accounts.map((a) => a.code));
  data.journal.forEach((e) => {
    if (!e.lines.length) problems.push(`${e.docNo}: ไม่มีบรรทัดรายการ`);
    if (!isBalanced(e.lines)) problems.push(`${e.docNo}: รายการบัญชีไม่สมดุล`);
    e.lines.forEach((l) => {
      if (!accounts.has(l.accountCode)) problems.push(`${e.docNo}: ไม่พบบัญชี ${l.accountCode} ในผังบัญชี`);
      if (toSatang(l.debit) < 0 || toSatang(l.credit) < 0) problems.push(`${e.docNo}: จำนวนเงินติดลบ`);
    });
  });
}

function checkReferences(data: AccountingData, problems: string[]) {
  const contacts = new Set(data.contacts.map((c) => c.id));
  const journal = new Set(data.journal.map((e) => e.id));
  const sales = new Map(data.sales.map((s) => [s.id, s]));
  const purchases = new Map(data.purchases.map((p) => [p.id, p]));
  const needJournal = (docNo: string, id: string | undefined) => {
    if (!id || !journal.has(id)) problems.push(`${docNo}: ไม่พบรายการบัญชีที่ผูกไว้`);
  };
  const needContact = (docNo: string, id: string) => {
    if (!contacts.has(id)) problems.push(`${docNo}: ไม่พบผู้ติดต่อที่อ้างถึง`);
  };

  const receipts = new Map(data.receipts.map((r) => [r.id, r]));
  data.sales.forEach((s) => {
    needContact(s.docNo, s.contactId);
    needJournal(s.docNo, s.journalId);
    if (s.kind === 'credit-note' || s.kind === 'debit-note') {
      const ref = s.refDocId ? sales.get(s.refDocId) : undefined;
      if (!ref || ref.kind !== 'tax-invoice') problems.push(`${s.docNo}: ไม่พบใบกำกับที่อ้างถึง`);
      else if (s.date < ref.date) problems.push(`${s.docNo}: ลงวันที่ก่อนใบกำกับที่อ้างถึง ${ref.docNo}`);
      else if (ref.opening) problems.push(`${s.docNo}: อ้างยอดยกมา ${ref.docNo} (ต้องปรับในระบบเดิม)`);
    }
    if (s.refReceiptId) {
      const r = receipts.get(s.refReceiptId);
      if (!r || r.invoiceId !== s.refDocId || !r.isTaxInvoice) problems.push(`${s.docNo}: ไม่พบใบเสร็จรับเงิน/ใบกำกับภาษีที่อ้างถึง`);
      else if (s.date < r.date) problems.push(`${s.docNo}: ลงวันที่ก่อนใบเสร็จรับเงิน/ใบกำกับภาษี ${r.docNo}`);
    }
  });
  data.receipts.forEach((r) => {
    needJournal(r.docNo, r.journalId);
    const inv = sales.get(r.invoiceId);
    if (!inv) problems.push(`${r.docNo}: ไม่พบใบกำกับที่รับชำระ`);
    else if (r.date < inv.date) problems.push(`${r.docNo}: วันที่รับชำระก่อนวันที่ ${inv.docNo}`);
  });
  data.purchases.forEach((p) => {
    needContact(p.docNo, p.contactId);
    needJournal(p.docNo, p.journalId);
    if (p.paid && !paymentsOf(data, p.id).length && !purchaseCreditsOf(data, p.id).length) {
      problems.push(`${p.docNo}: จ่ายแล้วแต่ไม่พบใบสำคัญจ่าย`);
    }
  });
  data.payments.forEach((p) => {
    needJournal(p.docNo, p.journalId);
    const purchase = purchases.get(p.purchaseId);
    if (!purchase) problems.push(`${p.docNo}: ไม่พบเอกสารซื้อที่จ่าย`);
    else if (p.date < purchase.date) problems.push(`${p.docNo}: วันที่จ่ายก่อนวันที่เอกสาร ${purchase.docNo}`);
  });
  data.refunds.forEach((r) => {
    needContact(r.docNo, r.contactId);
    needJournal(r.docNo, r.journalId);
  });
  data.transfers.forEach((t) => needJournal(t.docNo, t.journalId));
  (data.supplierRefunds ?? []).forEach((r) => {
    needContact(r.docNo, r.contactId);
    needJournal(r.docNo, r.journalId);
    if (!(toSatang(r.amount) > 0)) problems.push(`${r.docNo}: ยอดรับคืนต้องมากกว่า 0`);
  });
  const convertedFrom = new Map<string, string>();
  data.quotations.forEach((q) => {
    needContact(q.docNo, q.contactId);
    if (q.convertedSalesId === undefined) return;
    const doc = sales.get(q.convertedSalesId);
    if (!doc || doc.kind !== 'tax-invoice') problems.push(`${q.docNo}: ไม่พบเอกสารขายที่แปลงจากใบเสนอราคา`);
    else if (doc.contactId !== q.contactId) problems.push(`${q.docNo}: ลูกค้าไม่ตรงกับเอกสารขาย ${doc.docNo}`);
    else if (doc.date < q.date) problems.push(`${q.docNo}: เอกสารขาย ${doc.docNo} ลงวันที่ก่อนใบเสนอราคา`);
    if (q.status !== 'accepted') problems.push(`${q.docNo}: แปลงเป็นเอกสารขายแล้วแต่สถานะไม่ใช่ "ลูกค้าตอบรับ"`);
    const other = convertedFrom.get(q.convertedSalesId);
    if (other) problems.push(`${q.docNo}: เอกสารขายเดียวกันถูกแปลงจาก ${other} ด้วย`);
    convertedFrom.set(q.convertedSalesId, q.docNo);
  });
  data.purchaseCredits.forEach((c) => {
    needContact(c.docNo, c.contactId);
    needJournal(c.docNo, c.journalId);
    const purchase = purchases.get(c.purchaseId);
    if (!purchase) problems.push(`${c.docNo}: ไม่พบเอกสารซื้อที่อ้างถึง`);
    else {
      if (c.date < purchase.date) problems.push(`${c.docNo}: วันที่ก่อนวันที่บันทึก ${purchase.docNo}`);
      if (c.contactId !== purchase.contactId) problems.push(`${c.docNo}: ผู้ขายไม่ตรงกับ ${purchase.docNo}`);
      if (purchase.opening) problems.push(`${c.docNo}: อ้างยอดยกมา ${purchase.docNo}`);
    }
    if (c.supplierCreditNoteDate > c.date) problems.push(`${c.docNo}: วันที่ในใบลดหนี้ผู้ขายหลังวันที่ได้รับ`);
    const refundDue = toSatang(c.refundDue ?? 0);
    if (refundDue < 0 || refundDue > toSatang(calcDocument(c).total)) problems.push(`${c.docNo}: ยอดเงินคืนจากผู้ขายไม่ถูกต้อง`);
  });
}

function checkBalances(data: AccountingData, problems: string[]) {
  data.sales
    .filter((s) => s.kind === 'tax-invoice')
    .forEach((inv) => {
      if (toSatang(outstandingOf(data, inv)) < 0) problems.push(`${inv.docNo}: ยอดค้างชำระติดลบ`);
      if (toSatang(creditedTotalOf(data, inv)) > toSatang(calcDocument(inv).total) + toSatang(debitedTotalOf(data, inv))) {
        problems.push(`${inv.docNo}: ลดหนี้รวมเกินยอดใบกำกับ`);
      }
      const received = data.receipts.filter((r) => r.invoiceId === inv.id).reduce((acc, r) => acc + toSatang(r.amount), 0);
      if (received !== toSatang(inv.paidAmount)) problems.push(`${inv.docNo}: ยอดรับชำระไม่ตรงกับใบเสร็จ`);
    });
  data.contacts.forEach((c) => {
    if (toSatang(customerCreditOf(data, c.id)) < 0) problems.push(`${c.code}: คืนเงินลูกค้าเกินยอดรอคืน`);
    if (toSatang(supplierRefundDueOf(data, c.id)) < 0) problems.push(`${c.code}: รับเงินคืนจากผู้ขายเกินยอดที่ลดหนี้`);
  });
}

/**
 * คู่เลขที่ที่วันที่ถอยหลัง (เลขที่ใบหลังลงวันที่ก่อนใบก่อนหน้า) ใน prefix ที่ต้องเรียงตามวันที่
 * `exemptThrough` = ยกเว้นคู่ที่ใบก่อนหน้าลงวันที่ไม่เกินวันนี้ (ข้อมูลจากเวอร์ชันที่ยังไม่บังคับลำดับ)
 */
export function dateOrderInversions(
  data: AccountingData,
  exemptThrough?: ISODate
): { earlier: NumberedDoc; later: NumberedDoc }[] {
  const groups = new Map<string, { seq: number; doc: NumberedDoc }[]>();
  collectNumberedDocs(data).forEach((d) => {
    const parsed = parseDocNo(d.docNo);
    if (!parsed || !DATE_ORDERED_PREFIXES.some((p) => p === parsed.prefix)) return;
    const key = `${parsed.prefix}${parsed.period}`;
    groups.set(key, [...(groups.get(key) ?? []), { seq: parsed.seq, doc: d }]);
  });
  const out: { earlier: NumberedDoc; later: NumberedDoc }[] = [];
  groups.forEach((docs) => {
    const sorted = docs.slice().sort((a, b) => a.seq - b.seq);
    sorted.forEach((cur, i) => {
      if (i === 0) return;
      const prev = sorted[i - 1].doc;
      if (cur.doc.date >= prev.date) return;
      if (exemptThrough && prev.date <= exemptThrough) return;
      out.push({ earlier: prev, later: cur.doc });
    });
  });
  return out;
}

function checkDateOrder(data: AccountingData, problems: string[]) {
  // U12: ค่ายกเว้นต้องไม่เกินวันที่ของเอกสารเดิมที่เรียงผิดใบล่าสุด (ตั้งโดย migration) — กันแก้ไฟล์ตั้งเป็นอนาคตเพื่อซ่อนเลขที่สลับ
  const legacy = data.legacyOrderThrough;
  if (legacy !== undefined) {
    const latest = dateOrderInversions(data).reduce((max, x) => (x.earlier.date > max ? x.earlier.date : max), '');
    if (!latest || legacy > latest) {
      problems.push(`วันที่ยกเว้นลำดับเลขที่เอกสารเดิม (${legacy}) เกินวันที่ของเอกสารเดิมที่เรียงผิด${latest ? ` (${latest})` : ''} — ไฟล์ถูกแก้ไข`);
    }
  }
  dateOrderInversions(data, data.legacyOrderThrough).forEach(({ earlier, later }) => {
    problems.push(`${later.docNo} ลงวันที่ ${later.date} ก่อน ${earlier.docNo} (${earlier.date}) — เลขที่ต้องเรียงตามวันที่`);
  });
}

/** บัญชีในบรรทัดเอกสาร: ขาย/ลดหนี้ = รายได้, ซื้อ = ค่าใช้จ่าย/สินทรัพย์ และไม่ใช่บัญชีคุม */
function checkLineAccounts(data: AccountingData, problems: string[]) {
  const accounts = new Map(data.accounts.map((a) => [a.code, a]));
  const check = (docNo: string, codes: string[], side: LineSide) => {
    codes.forEach((code) => {
      const problem = lineAccountProblem(accounts.get(code), side);
      if (problem) problems.push(`${docNo}: บรรทัดรายการใช้บัญชี ${code} ไม่ได้ (${problem})`);
    });
  };
  data.sales.forEach((s) => check(s.docNo, s.lines.map((l) => l.accountCode), 'sales'));
  data.quotations.forEach((q) => check(q.docNo, q.lines.map((l) => l.accountCode), 'sales'));
  data.purchaseCredits.forEach((c) => check(c.docNo, c.lines.map((l) => l.accountCode), 'purchase'));
  data.purchases.forEach((p) => {
    check(p.docNo, p.lines.map((l) => l.accountCode), 'purchase');
    p.lines.forEach((l, i) => {
      if (!Number.isFinite(l.whtRate) || l.whtRate < 0 || l.whtRate > 15) {
        problems.push(`${p.docNo}: รายการที่ ${i + 1} อัตราหัก ณ ที่จ่ายไม่ถูกต้อง`);
      } else if (l.whtRate > 0 && !l.whtIncomeType.trim()) {
        problems.push(`${p.docNo}: รายการที่ ${i + 1} หัก ณ ที่จ่ายแต่ไม่ระบุประเภทเงินได้`);
      }
    });
  });
}

const lineKey = (lines: JournalLine[]) =>
  lines
    .map((l) => `${l.accountCode}:${toSatang(l.debit)}:${toSatang(l.credit)}`)
    .sort()
    .join('|');

/**
 * ยอดเอกสารต้องตรงกับรายการบัญชีที่ผูกไว้: สร้างรายการที่ควรเป็นจากเอกสารด้วย posting engine เดียวกันแล้วเทียบบรรทัด
 * รายการที่ไม่ได้มาจากเอกสาร (source ≠ manual แต่ไม่มีเอกสารอ้าง) และรายการคีย์มือที่ลงบัญชีคุม ถือว่าผิด
 */
function checkDocumentPostings(data: AccountingData, problems: string[]) {
  const purchases = new Map(data.purchases.map((p) => [p.id, p]));
  const invoices = new Map(data.sales.map((s) => [s.id, s]));
  const expected = new Map<string, { docNo: string; build: () => JournalEntry }>();
  const meta = (id: string) => ({ id, docNo: '' });

  const salesPosting = { 'tax-invoice': postSalesInvoice, 'credit-note': postCreditNote, 'debit-note': postDebitNote };
  // ยอดยกมา: ใบค้างรับ/ค้างจ่ายไม่มีรายการบัญชีของตัวเอง (ผูกกับรายการยอดยกมาทั้งก้อน)
  data.sales
    .filter((s) => !s.opening)
    .forEach((s) => expected.set(s.journalId, { docNo: s.docNo, build: () => salesPosting[s.kind](s, meta(s.journalId), '') }));
  data.receipts.forEach((r) =>
    expected.set(r.journalId, {
      docNo: r.docNo,
      build: () => postReceipt(r, meta(r.journalId), '', invoices.get(r.invoiceId)?.docNo ?? ''),
    })
  );
  data.purchases
    .filter((p) => !p.opening)
    .forEach((p) => expected.set(p.journalId, { docNo: p.docNo, build: () => postPurchase(p, meta(p.journalId), '') }));
  data.purchaseCredits.forEach((c) =>
    expected.set(c.journalId, {
      docNo: c.docNo,
      build: () => postPurchaseCreditNote(c, meta(c.journalId), '', purchases.get(c.purchaseId)?.docNo ?? ''),
    })
  );
  data.yearCloses.forEach((c) => {
    if (!c.journalId) return;
    const { journalId } = c;
    expected.set(journalId, {
      docNo: `CLOSE-${c.fiscalYearEnd}`,
      build: () => {
        const entry = postYearClose(c, yearCloseBalances(data, c.fiscalYearEnd, journalId).balances, meta(journalId));
        if (!entry) throw new Error('empty');
        return entry;
      },
    });
  });
  const opening = data.openingBalance;
  if (opening) {
    expected.set(opening.journalId, {
      docNo: 'OPENING',
      build: () => postOpeningBalance(opening, openingItemTotals(data), meta(opening.journalId)),
    });
  }
  data.payments.forEach((pv) => {
    const purchase = purchases.get(pv.purchaseId);
    if (!purchase) return;
    expected.set(pv.journalId, {
      docNo: pv.docNo,
      build: () => postPurchasePayment(pv, meta(pv.journalId), '', purchase.docNo),
    });
  });
  data.vatCloses.forEach((c) => {
    if (!c.journalId) return;
    const {journalId} = c;
    expected.set(journalId, {
      docNo: `VAT-${c.period}`,
      build: () => {
        const entry = postVatClose(c, meta(journalId));
        if (!entry) throw new Error('empty');
        return entry;
      },
    });
  });
  data.refunds.forEach((r) => expected.set(r.journalId, { docNo: r.docNo, build: () => postCustomerRefund(r, meta(r.journalId), '') }));
  (data.supplierRefunds ?? []).forEach((r) =>
    expected.set(r.journalId, { docNo: r.docNo, build: () => postSupplierRefund(r, meta(r.journalId), '') })
  );
  data.transfers.forEach((t) => expected.set(t.journalId, { docNo: t.docNo, build: () => postBankTransfer(t, meta(t.journalId)) }));

  data.journal.forEach((entry) => {
    if (entry.source === 'manual') {
      const control = entry.lines.filter((l) => isControlAccount(l.accountCode)).map((l) => l.accountCode);
      if (control.length) {
        problems.push(`${entry.docNo}: รายการปรับปรุงลงบัญชีคุม ${Array.from(new Set(control)).join(', ')} (ต้องลงผ่านเอกสารเท่านั้น)`);
      }
      return;
    }
    const source = expected.get(entry.id);
    if (!source) {
      problems.push(`${entry.docNo}: รายการบัญชีไม่มีเอกสารต้นทาง`);
      return;
    }
    let want: JournalEntry;
    try {
      want = source.build();
    } catch {
      problems.push(`${source.docNo}: ยอดเอกสารลงบัญชีไม่ได้ (ไม่สมดุล)`);
      return;
    }
    if (lineKey(want.lines) !== lineKey(entry.lines)) {
      problems.push(`${source.docNo}: ยอดในเอกสารไม่ตรงกับรายการบัญชี ${entry.docNo}`);
    }
    if (want.date !== entry.date) problems.push(`${source.docNo}: วันที่ไม่ตรงกับรายการบัญชี ${entry.docNo}`);
    if (entry.sourceDocNo !== undefined && entry.sourceDocNo !== source.docNo) {
      problems.push(`${entry.docNo}: อ้างเลขที่ ${entry.sourceDocNo} แต่ผูกกับเอกสาร ${source.docNo}`);
    }
  });
}

/** ใบลดหนี้รวมต่อใบกำกับ: มูลค่าก่อน VAT และ VAT ที่ลดต้องไม่เกินของใบเดิม */
function checkCreditParts(data: AccountingData, problems: string[]) {
  data.sales
    .filter((s) => s.kind === 'tax-invoice')
    .forEach((inv) => {
      const t = invoiceCeilingOf(data, inv);
      const credited = creditedPartsOf(data, inv);
      if (toSatang(credited.vat) > toSatang(t.vat)) problems.push(`${inv.docNo}: VAT ที่ลดหนี้รวมเกิน VAT ของใบกำกับ`);
      if (toSatang(credited.net) > toSatang(t.net)) problems.push(`${inv.docNo}: มูลค่าที่ลดหนี้รวมเกินมูลค่าของใบกำกับ`);
    });
  // ม.86/9, 86/10: มูลค่าที่ถูกต้อง = มูลค่าเดิม ∓ ผลต่าง (มูลค่าของเอกสารนี้)
  data.sales
    .filter((s) => s.kind !== 'tax-invoice')
    .forEach((s) => {
      if (s.originalNet === undefined || s.correctNet === undefined) {
        problems.push(`${s.docNo}: ไม่มีมูลค่าตามใบกำกับเดิม/มูลค่าที่ถูกต้อง (ม.86/9, 86/10)`);
        return;
      }
      const diff = calcDocument(s).net;
      const want = s.kind === 'credit-note' ? subBaht(s.originalNet, diff) : sumBaht([s.originalNet, diff]);
      if (toSatang(want) !== toSatang(s.correctNet)) problems.push(`${s.docNo}: มูลค่าที่ถูกต้องไม่เท่ากับมูลค่าเดิม ∓ ผลต่าง`);
    });
}

/**
 * เอกสารซื้อ: สิทธิภาษีซื้อ (วันที่ใบกำกับ/เดือนใช้สิทธิ ม.82/3)
 * และการแบ่งจ่าย: ยอดจ่ายรวมไม่เกินยอดเอกสาร, สถานะจ่ายครบตรงกับใบสำคัญจ่าย, หัก ณ ที่จ่ายรวมทุกครั้ง
 * ไม่เกิน (และเมื่อจ่ายครบ = เท่ากับ) ของทั้งเอกสารต่อประเภทเงินได้, PV แต่ละใบ: ยอดสุทธิ = ยอด − ภาษี และมี 50 ทวิ เมื่อหัก
 */
function checkPurchases(data: AccountingData, problems: string[]) {
  data.purchases.forEach((p) => {
    // ม.82/5 (เลขผู้เสียภาษีผู้ขาย) บังคับที่ action ตอนบันทึก — ไม่ตรวจซ้ำที่นี่ เพราะเอกสารเดิมที่ยื่นภาษีไปแล้วต้องคงไว้
    if (p.claimVat) {
      const claim = vatClaimProblem(p);
      if (claim) problems.push(`${p.docNo}: ${claim}`);
    } else if (p.vatClaimPeriod !== undefined) {
      problems.push(`${p.docNo}: ไม่ขอคืนภาษีซื้อแต่ระบุเดือนใช้สิทธิ`);
    }

    const pvs = paymentsOf(data, p.id);
    const credits = purchaseCreditsOf(data, p.id);
    // ใบลดหนี้ผู้ขายลดยอดเอกสาร (ส่วนเกินยอดค้างตั้งเป็นเงินคืนจากผู้ขาย) — ยอดค้างไม่ติดลบ และจ่ายครบ = ยอดค้างเป็นศูนย์
    const total = toSatang(purchaseAdjustedTotal(data, p));
    const outstanding = toSatang(purchaseOutstanding(data, p));
    if (total < 0) problems.push(`${p.docNo}: ใบลดหนี้ผู้ขายรวมเกินยอดเอกสาร`);
    if (outstanding < 0) problems.push(`${p.docNo}: ยอดจ่ายชำระรวมเกินยอดเอกสาร`);
    if (p.paid !== (outstanding === 0)) problems.push(`${p.docNo}: สถานะจ่ายแล้วไม่ตรงกับใบสำคัญจ่าย`);
    const original = calcDocument(p);
    const credited = purchaseCreditedParts(data, p);
    if (toSatang(credited.vat) > toSatang(original.vat)) problems.push(`${p.docNo}: VAT ที่ลดหนี้รวมเกิน VAT ของเอกสาร`);
    if (toSatang(credited.net) > toSatang(original.net)) problems.push(`${p.docNo}: มูลค่าที่ลดหนี้รวมเกินมูลค่าของเอกสาร`);
    purchaseCreditAllocation(p, credits).problems.forEach((msg) => problems.push(`${p.docNo}: ${msg}`));
    credits.forEach((c) => {
      if (c.claimVat !== p.claimVat) problems.push(`${c.docNo}: สิทธิภาษีซื้อไม่ตรงกับ ${p.docNo}`);
      if (c.vatMode !== p.vatMode || c.vatRate !== p.vatRate) problems.push(`${c.docNo}: อัตรา/วิธีคิด VAT ไม่ตรงกับ ${p.docNo}`);
      const wantPeriod = c.claimVat ? monthKeyOf(c.date) : undefined;
      if (c.vatClaimPeriod !== wantPeriod) problems.push(`${c.docNo}: เดือนที่ลดภาษีซื้อต้องเป็นเดือนที่ได้รับใบลดหนี้`);
      if (c.claimVat && wantPeriod && wantPeriod < purchaseVatMonth(p)) {
        problems.push(`${c.docNo}: ลดภาษีซื้อก่อนเดือนที่ใช้สิทธิของ ${p.docNo}`);
      }
    });
    const items = pvs.flatMap((pv) => pv.whtItems);
    if (items.some((i) => toSatang(i.base) < 0 || toSatang(i.tax) < 0)) problems.push(`${p.docNo}: หัก ณ ที่จ่ายในใบสำคัญจ่ายติดลบ`);
    // ลดหนี้หลังแบ่งจ่าย: เศษปัด 1 สตางค์ต่อการจ่าย
    const tolerance = credits.length ? pvs.length : 0;
    const groups = purchaseAdjustedWhtGroups(data, p);
    const originalGroups = purchaseWhtGroups(p);
    // ใบลดหนี้หลังการจ่าย (D1): หัก ณ ที่จ่ายที่หักไปแล้วไม่ปรับ — เทียบเฉพาะว่าไม่เกินของเอกสารเดิม
    // ถ้ารายการสุดท้ายที่ปิดยอดเป็นการจ่าย ต้องหักครบฐานหลังลดหนี้ (ครั้งสุดท้ายรับส่วนที่เหลือ)
    const order = new Map(data.journal.map((e, i) => [e.id, i]));
    const lastOf = (ids: string[]) => ids.reduce((max, id) => Math.max(max, order.get(id) ?? -1), -1);
    const settledByPayment = p.paid && pvs.length > 0 && lastOf(pvs.map((pv) => pv.journalId)) > lastOf(credits.map((c) => c.journalId));
    groups.forEach((g) => {
      const mine = items.filter((i) => i.incomeType === g.incomeType && i.rate === g.rate);
      const base = mine.reduce((a, i) => a + toSatang(i.base), 0);
      const tax = mine.reduce((a, i) => a + toSatang(i.tax), 0);
      let bad: boolean;
      if (!credits.length) {
        bad = base > toSatang(g.base) || tax > toSatang(g.tax) || (p.paid && (base !== toSatang(g.base) || tax !== toSatang(g.tax)));
      } else {
        const og = originalGroups.find((o) => o.incomeType === g.incomeType && o.rate === g.rate) ?? g;
        const over = base - toSatang(og.base) > tolerance || tax - toSatang(og.tax) > tolerance;
        const short = settledByPayment && (toSatang(g.base) - base > tolerance || toSatang(g.tax) - tax > tolerance);
        bad = over || short;
      }
      if (bad) problems.push(`${p.docNo}: หัก ณ ที่จ่าย ${g.incomeType} ${g.rate}% ในใบสำคัญจ่ายรวมไม่ตรงกับเอกสาร`);
    });
    if (items.some((i) => !groups.some((g) => g.incomeType === i.incomeType && g.rate === i.rate))) {
      problems.push(`${p.docNo}: ใบสำคัญจ่ายมีหัก ณ ที่จ่ายประเภทที่ไม่มีในเอกสาร`);
    }
  });
  data.payments.forEach((pv) => {
    if (!(toSatang(pv.amount) > 0)) problems.push(`${pv.docNo}: ยอดจ่ายต้องมากกว่า 0`);
    const tax = pv.whtItems.reduce((a, i) => a + toSatang(i.tax), 0);
    if (tax !== toSatang(pv.whtAmount)) problems.push(`${pv.docNo}: ภาษีหัก ณ ที่จ่ายไม่เท่ากับผลรวมรายการ`);
    if (toSatang(pv.netPaid) !== toSatang(pv.amount) - toSatang(pv.whtAmount) || toSatang(pv.netPaid) < 0) {
      problems.push(`${pv.docNo}: ยอดจ่ายสุทธิไม่เท่ากับยอดตัดเจ้าหนี้ − ภาษีหัก ณ ที่จ่าย`);
    }
    if ((tax > 0) !== !!pv.whtCertNo) problems.push(`${pv.docNo}: เลขที่ 50 ทวิ ไม่ตรงกับการหัก ณ ที่จ่าย`);
  });
}

/**
 * ปิดภาษีเดือน: ต่อเนื่องเดือนต่อเดือนตั้งแต่เดือนแรกที่มีรายการภาษี, ปิดได้เฉพาะเดือนที่ปิดงวดครบแล้ว,
 * ตัวเลขตรงกับรายงานภาษีของเดือนนั้นและยอดยกมาจากเดือนก่อน, มีรายการบัญชีเมื่อยอดไม่เป็นศูนย์
 */
function checkVatCloses(data: AccountingData, problems: string[]) {
  const closes = data.vatCloses.slice().sort((a, b) => a.period.localeCompare(b.period));
  if (!closes.length) return;
  const first = vatActivityMonths(data)[0];
  if (first && first < closes[0].period) problems.push(`ภาษีเดือน ${first} ยังไม่ได้ปิด แต่ปิดเดือน ${closes[0].period} แล้ว`);
  const lock = data.company.lockedThrough;
  let carry = data.openingBalance?.vatCredit ?? 0;
  closes.forEach((c, i) => {
    const label = `ปิดภาษีเดือน ${c.period}`;
    if (i > 0 && c.period !== shiftMonthKey(closes[i - 1].period, 1)) problems.push(`${label}: ไม่ต่อเนื่องจากเดือนก่อน`);
    if (c.date !== endOfMonth(c.period)) problems.push(`${label}: วันที่ต้องเป็นวันสิ้นเดือน`);
    if (!lock || c.date > lock) problems.push(`${label}: ยังไม่ได้ปิดงวดเดือนนี้`);
    const draft = vatCloseDraft({ ...data, vatCloses: [] }, c.period);
    const want = { ...draft, broughtForward: carry, ...vatCloseFigures(draft, carry) };
    const fields = ['outputVat', 'inputVat', 'broughtForward', 'payable', 'carriedForward'] as const;
    if (fields.some((f) => toSatang(want[f]) !== toSatang(c[f]))) {
      problems.push(`${label}: ตัวเลขไม่ตรงกับรายงานภาษี/ยอดยกมา (มีเอกสารเปลี่ยนหลังปิด)`);
    }
    if (!c.journalId && postVatClose(c, { id: '', docNo: '' })) problems.push(`${label}: ไม่พบรายการบัญชีที่ผูกไว้`);
    if (c.journalId && !data.journal.some((e) => e.id === c.journalId)) problems.push(`${label}: ไม่พบรายการบัญชีที่ผูกไว้`);
    carry = c.carriedForward;
  });
}


/** ยอดบัญชีแยกประเภท (เดบิต − เครดิต, สตางค์) ของบัญชี `code` จากรายการที่ผ่าน `filter` */
function glNet(data: AccountingData, code: string, filter: (e: JournalEntry) => boolean = () => true): number {
  return data.journal
    .filter(filter)
    .reduce(
      (acc, e) => acc + e.lines.filter((l) => l.accountCode === code).reduce((a, l) => a + toSatang(l.debit) - toSatang(l.credit), 0),
      0
    );
}

/**
 * กระทบยอดบัญชีคุมกับทะเบียนย่อย: 1130 = ยอดค้างลูกหนี้, 2120 = เงินรอคืนลูกค้า, 2110 = เอกสารซื้อที่ยังไม่จ่าย,
 * 1160/2160 = ภาษีหัก ณ ที่จ่ายในใบเสร็จ/ใบสำคัญจ่าย, 2150/1170 รายเดือน = รายงานภาษีขาย/ภาษีซื้อ
 */
function checkReconciliation(data: AccountingData, problems: string[]) {
  const baht = (satang: number) => (satang / 100).toFixed(2);
  const check = (label: string, gl: number, sub: number) => {
    if (gl !== sub) problems.push(`${label}: ยอดบัญชี ${baht(gl)} ไม่ตรงกับทะเบียน ${baht(sub)}`);
  };
  const sum = (values: number[]) => values.reduce((a, v) => a + toSatang(v), 0);
  check(
    `${ACC.receivable} ลูกหนี้การค้า`,
    glNet(data, ACC.receivable),
    sum(data.sales.filter((s) => s.kind === 'tax-invoice').map((s) => outstandingOf(data, s)))
  );
  check(
    `${ACC.customerCredit} เงินรอคืนลูกค้า`,
    -glNet(data, ACC.customerCredit),
    sum(Array.from(new Set([...data.sales, ...data.refunds].map((d) => d.contactId))).map((id) => customerCreditOf(data, id)))
  );
  check(`${ACC.payable} เจ้าหนี้การค้า`, -glNet(data, ACC.payable), sum(data.purchases.map((p) => purchaseOutstanding(data, p))));
  check(
    `${ACC.supplierRefundReceivable} ลูกหนี้-เงินคืนจากผู้ขาย`,
    glNet(data, ACC.supplierRefundReceivable),
    sum(Array.from(new Set([...data.purchaseCredits, ...(data.supplierRefunds ?? [])].map((d) => d.contactId))).map((id) => supplierRefundDueOf(data, id)))
  );
  check(
    `${ACC.whtReceivable} ภาษีถูกหัก ณ ที่จ่าย`,
    glNet(data, ACC.whtReceivable),
    sum([data.openingBalance?.whtReceivable ?? 0, ...data.receipts.map((r) => r.whtAmount)])
  );
  check(
    `${ACC.deferredOutputVat} ภาษีขายยังไม่ถึงกำหนด`,
    -glNet(data, ACC.deferredOutputVat),
    sum(data.sales.filter((s) => isServiceInvoice(s)).map((s) => deferredVatOf(data, s)))
  );
  check(`${ACC.whtPayable} ภาษีหัก ณ ที่จ่ายค้างจ่าย`, -glNet(data, ACC.whtPayable), sum(data.payments.map((p) => p.whtAmount)));

  check(`${ACC.vatCredit} ภาษีชำระเกินยกไป`, glNet(data, ACC.vatCredit), toSatang(latestVatCredit(data)));

  // ภาษีขาย/ภาษีซื้อรายเดือนภาษี (ไม่รวมรายการปิดภาษีเดือน ซึ่งตรวจแยกใน checkVatCloses / checkDocumentPostings)
  // ภาษีซื้อนับเข้าเดือนที่ใช้สิทธิ (`vatClaimPeriod`) ไม่ใช่เดือนของวันที่บันทึก
  const purchaseByJournal = new Map(data.purchases.map((p) => [p.journalId, p]));
  const taxMonthOf = (e: JournalEntry) => {
    const purchase = e.source === 'purchase' ? purchaseByJournal.get(e.id) : undefined;
    return purchase ? purchaseVatMonth(purchase) : monthKeyOf(e.date);
  };
  const months = new Set<string>();
  [...data.sales, ...data.receipts, ...data.journal].forEach((d) => {
    if (isValidISODate(d.date)) months.add(monthKeyOf(d.date));
  });
  data.purchases.forEach((p) => months.add(purchaseVatMonth(p)));
  Array.from(months)
    .sort()
    .forEach((m) => {
      const period = { year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) };
      const inMonth = (e: JournalEntry) => e.source !== 'vat-close' && taxMonthOf(e) === m;
      check(
        `${ACC.outputVat} ภาษีขาย ${m}`,
        -glNet(data, ACC.outputVat, inMonth),
        sum(salesVatReport(data.sales, data.contacts, period, data.receipts).map((r) => r.vat))
      );
      check(
        `${ACC.inputVat} ภาษีซื้อ ${m}`,
        glNet(data, ACC.inputVat, inMonth),
        sum(purchaseVatReport(data.purchases, data.contacts, period, data.purchaseCredits).map((r) => r.vat))
      );
    });
}

/**
 * งานบริการ (ม.78/1): ใบเสร็จของใบแจ้งหนี้งานบริการต้องเป็นใบเสร็จรับเงิน/ใบกำกับภาษี (และกลับกัน),
 * ภาษีขายรอตัดไม่ติดลบและเป็นศูนย์เมื่อไม่มียอดค้าง, ใบลดหนี้ก่อนรับครบไม่ใช่เอกสารภาษี / หลังรับครบอ้างใบเสร็จ,
 * ใบลดหนี้/ใบกำกับภาษีรวมไม่เกินที่ออกใบกำกับไปแล้ว, ไม่มีใบเพิ่มหนี้
 */
function checkServiceVat(data: AccountingData, problems: string[]) {
  const sales = new Map(data.sales.map((s) => [s.id, s]));
  data.receipts.forEach((r) => {
    const inv = sales.get(r.invoiceId);
    if (!inv) return;
    const service = isServiceInvoice(inv);
    if (service !== !!r.isTaxInvoice) {
      problems.push(`${r.docNo}: ${service ? 'รับชำระงานบริการต้องออกใบเสร็จรับเงิน/ใบกำกับภาษี' : 'ไม่ใช่งานบริการแต่ออกเป็นใบกำกับภาษี'}`);
    }
    if (!service && toSatang(r.vat ?? 0) !== 0) problems.push(`${r.docNo}: มีภาษีขายแต่ไม่ใช่ใบเสร็จของงานบริการ`);
    if (service && toSatang(r.vat ?? 0) < 0) problems.push(`${r.docNo}: ภาษีขายติดลบ`);
    if (service && toSatang(r.vat ?? 0) >= toSatang(r.amount)) problems.push(`${r.docNo}: ภาษีขายไม่น้อยกว่ายอดรับ`);
    if (!!r.isTaxInvoice !== (r.etax !== undefined && r.etax !== 'not-required')) {
      problems.push(`${r.docNo}: สถานะ e-Tax ไม่ตรงกับชนิดเอกสาร`);
    }
  });
  // U12: ภาษีขายของใบเสร็จรับเงิน/ใบกำกับภาษีแต่ละใบต้องเท่ากับที่คำนวณใหม่ตามลำดับการบันทึก (`receiptVatOf`)
  // — กันแก้ไฟล์ย้ายภาษีขายข้ามเดือน (ผลรวมเท่าเดิม 2151 เป็นศูนย์ แต่ ภ.พ.30 แต่ละเดือนผิด)
  const order = new Map(data.journal.map((e, i) => [e.id, i]));
  data.sales.filter(isServiceInvoice).forEach((inv) => {
    const events = [
      ...data.receipts.filter((r) => r.invoiceId === inv.id).map((r) => ({ at: order.get(r.journalId) ?? Infinity, receipt: r, credit: undefined })),
      ...data.sales
        .filter((c) => c.kind === 'credit-note' && c.refDocId === inv.id)
        .map((c) => ({ at: order.get(c.journalId) ?? Infinity, receipt: undefined, credit: c })),
    ].sort((a, b) => a.at - b.at);
    const replay = { sales: [] as SalesDoc[], receipts: [] as AccountingData['receipts'] };
    let paid = 0;
    events.forEach(({ receipt, credit }) => {
      if (credit) {
        replay.sales.push(credit);
        return;
      }
      if (!receipt) return;
      const asOf: SalesDoc = { ...inv, status: 'issued', paidAmount: fromSatang(paid) };
      const want = receiptVatOf({ sales: [asOf, ...replay.sales], receipts: replay.receipts }, asOf, receipt.amount);
      if (toSatang(want) !== toSatang(receipt.vat ?? 0)) {
        problems.push(`${receipt.docNo}: ภาษีขายในใบเสร็จรับเงิน/ใบกำกับภาษี (${(receipt.vat ?? 0).toFixed(2)}) ไม่ตรงกับสัดส่วนภาษีรอตัด (${want.toFixed(2)})`);
      }
      replay.receipts.push(receipt);
      paid += toSatang(receipt.amount);
    });
  });
  data.sales.forEach((s) => {
    if (s.kind === 'tax-invoice') {
      if (!isServiceInvoice(s)) return;
      const deferred = toSatang(deferredVatOf(data, s));
      if (deferred < 0) problems.push(`${s.docNo}: ภาษีขายรอตัดติดลบ`);
      if (toSatang(outstandingOf(data, s)) === 0 && deferred !== 0) problems.push(`${s.docNo}: ไม่มียอดค้างแต่ยังมีภาษีขายรอตัด`);
      const taxed = taxedPartsOf(data, s);
      if (toSatang(taxed.vat) < 0 || toSatang(taxed.net) < 0) problems.push(`${s.docNo}: ลดหนี้เกินที่ออกใบเสร็จรับเงิน/ใบกำกับภาษีไปแล้ว`);
      return;
    }
    const inv = s.refDocId ? sales.get(s.refDocId) : undefined;
    if (!inv || !isServiceInvoice(inv)) {
      if (s.saleType === 'service' && isDeferredVatDoc(s)) problems.push(`${s.docNo}: ลงภาษีขายรอตัดแต่ไม่ได้อ้างใบแจ้งหนี้งานบริการ`);
      if (toSatang(s.deferredVatRounding ?? 0) !== 0) problems.push(`${s.docNo}: มีเศษปัดภาษีรอตัดแต่ไม่ใช่งานบริการ`);
      return;
    }
    if (s.kind === 'debit-note') {
      problems.push(`${s.docNo}: ใบเพิ่มหนี้ของใบแจ้งหนี้งานบริการ (ต้องออกใบแจ้งหนี้ใหม่)`);
      return;
    }
    if (isTaxDocument(s) && !s.refReceiptId) problems.push(`${s.docNo}: ใบลดหนี้/ใบกำกับภาษีของงานบริการต้องอ้างใบเสร็จรับเงิน/ใบกำกับภาษี`);
    if (!isTaxDocument(s) && !isDeferredVatDoc(s)) problems.push(`${s.docNo}: ใบลดหนี้ของงานบริการต้องเป็นเอกสารภาษีหรือกลับภาษีรอตัด`);
    if (isTaxDocument(s) && toSatang(s.deferredVatRounding ?? 0) !== 0) problems.push(`${s.docNo}: ใบลดหนี้/ใบกำกับภาษีมีเศษปัดภาษีรอตัด`);
  });
}

/**
 * ปิดบัญชีสิ้นปี: วันสิ้นเดือน, ปิดงวดถึงแล้ว, ห่างกัน 12 เดือน, ไม่ซ้ำ, ยอดรายได้/ค่าใช้จ่ายถึงวันสิ้นปีเป็นศูนย์
 * (มีรายการลงปีที่ปิดแล้วเพิ่ม = ไม่เป็นศูนย์), กำไรที่บันทึกตรงกับรายการบัญชี
 */
function checkYearCloses(data: AccountingData, problems: string[]) {
  const closes = sortedYearCloses(data);
  const lock = data.company.lockedThrough;
  closes.forEach((c, i) => {
    const label = `ปิดบัญชีสิ้นปี ${c.fiscalYearEnd}`;
    if (!isValidISODate(c.fiscalYearEnd) || endOfMonth(monthKeyOf(c.fiscalYearEnd)) !== c.fiscalYearEnd) {
      problems.push(`${label}: วันสิ้นปีต้องเป็นวันสิ้นเดือน`);
      return;
    }
    if (i > 0) {
      const prev = closes[i - 1].fiscalYearEnd;
      if (prev === c.fiscalYearEnd) problems.push(`${label}: ปิดซ้ำ`);
      else if (c.fiscalYearEnd !== endOfMonth(shiftMonthKey(monthKeyOf(prev), 12))) problems.push(`${label}: ไม่ต่อเนื่อง 12 เดือนจากปีก่อน`);
    }
    if (!lock || lock < c.fiscalYearEnd) problems.push(`${label}: ยังไม่ได้ปิดงวดถึงวันสิ้นปี`);
    if (data.openingBalance && c.fiscalYearEnd <= data.openingBalance.date) problems.push(`${label}: ก่อนวันยอดยกมา`);
    const after = yearCloseBalances(data, c.fiscalYearEnd).balances;
    if (after.length) problems.push(`${label}: ยังมียอดรายได้/ค่าใช้จ่ายถึงวันสิ้นปี (มีรายการลงปีที่ปิดแล้ว)`);
    const entry = c.journalId ? data.journal.find((e) => e.id === c.journalId) : undefined;
    if (c.journalId && !entry) problems.push(`${label}: ไม่พบรายการบัญชีที่ผูกไว้`);
    const want = yearCloseBalances(data, c.fiscalYearEnd, c.journalId).netProfit;
    if (toSatang(want) !== toSatang(c.netProfit)) problems.push(`${label}: กำไรสุทธิที่บันทึกไม่ตรงกับยอดบัญชี`);
    if (!c.journalId && yearCloseBalances(data, c.fiscalYearEnd).balances.length) problems.push(`${label}: ไม่พบรายการบัญชีที่ผูกไว้`);
  });
  data.journal
    .filter((e) => e.source === 'year-close')
    .forEach((e) => {
      if (!closes.some((c) => c.journalId === e.id)) problems.push(`${e.docNo}: รายการปิดบัญชีไม่มีข้อมูลการปิดปี`);
    });
}

/**
 * ยอดยกมา: มีรายการบัญชีที่ผูกไว้ (source opening) ใบเดียว, ใบค้างรับ/ค้างจ่ายผูกกับรายการนั้นและลงวันที่ไม่หลังวันยอดยกมา,
 * ไม่คิด VAT, เลขที่ไม่ซ้ำต่อผู้ติดต่อ, บรรทัดไม่ใช้บัญชีคุม, ทุกรายการอื่นลงวันที่หลังวันยอดยกมา
 */
const OPENING_FIELD_CODES: readonly string[] = [ACC.receivable, ACC.payable, ACC.vatCredit, ACC.whtReceivable];

function checkOpening(data: AccountingData, problems: string[]) {
  const opening = data.openingBalance;
  const openingEntries = data.journal.filter((e) => e.source === 'opening');
  const openingDocs = [...data.sales.filter((s) => s.opening), ...data.purchases.filter((p) => p.opening)];
  if (!opening) {
    if (openingEntries.length) problems.push('มีรายการบัญชียอดยกมาแต่ไม่มีข้อมูลยอดยกมา');
    if (openingDocs.length) problems.push('มีเอกสารยอดยกมาแต่ไม่มีข้อมูลยอดยกมา');
    return;
  }
  if (openingEntries.length !== 1 || openingEntries[0].id !== opening.journalId) problems.push('ยอดยกมา: รายการบัญชีต้องมี 1 รายการที่ผูกไว้');
  const entry = openingEntries[0];
  if (entry && entry.date !== opening.date) problems.push('ยอดยกมา: วันที่รายการบัญชีไม่ตรงกับวันยอดยกมา');
  const seen = new Set<string>();
  // U12: เลขที่ยอดยกมาชนกับเลขที่ของระบบ (เช่น IV6910-0001) — ค้นหา/อ้างอิงผิดใบ
  const systemNumbers = new Set(collectNumberedDocs(data).map((d) => d.docNo));
  openingDocs.forEach((d) => {
    if (d.journalId !== opening.journalId) problems.push(`${d.docNo}: เอกสารยอดยกมาไม่ได้ผูกกับรายการยอดยกมา`);
    if (d.date > opening.date) problems.push(`${d.docNo}: เอกสารยอดยกมาลงวันที่หลังวันยอดยกมา`);
    if (systemNumbers.has(d.docNo.trim())) problems.push(`${d.docNo}: เลขที่ยอดยกมาซ้ำกับเลขที่เอกสารของระบบ`);
    else if (openingNumberConflict(d.docNo, opening.date)) {
      problems.push(`${d.docNo}: เลขที่ยอดยกมาเป็นรูปแบบเลขที่ที่ระบบจะออกหลังวันยอดยกมา`);
    }
    // U2: ใบแจ้งหนี้งานบริการค้างรับยกมาคิด VAT ได้ (ภาษีขายยังไม่ถึงกำหนด 2151) — ใบอื่นต้องไม่คิด VAT
    const deferredService = 'kind' in d && isServiceInvoice(d);
    if (d.vatMode !== 'none' && !deferredService) problems.push(`${d.docNo}: เอกสารยอดยกมาต้องไม่คิด VAT`);
    const key = `${'kind' in d ? 'ar' : 'ap'}|${d.contactId}|${d.docNo.toUpperCase()}`;
    if (seen.has(key)) problems.push(`${d.docNo}: เลขที่ยอดยกมาซ้ำ`);
    seen.add(key);
  });
  if (data.sales.some((s) => s.opening && (s.isTaxInvoice || s.etax !== 'not-required'))) problems.push('ยอดยกมา: ใบค้างรับต้องไม่ใช่ใบกำกับภาษีของระบบนี้');
  if (data.purchases.some((p) => p.opening && p.claimVat)) problems.push('ยอดยกมา: ใบค้างจ่ายต้องไม่ขอคืนภาษีซื้อซ้ำ');
  data.purchases
    .filter((p) => !p.opening && p.claimVat && p.vatClaimPeriod && p.vatClaimPeriod <= monthKeyOf(opening.date))
    .forEach((p) => problems.push(`${p.docNo}: ใช้สิทธิภาษีซื้อเดือน ${p.vatClaimPeriod} ซึ่งยื่นในระบบเดิมแล้ว (ยอดยกมา)`));
  opening.lines.forEach((l) => {
    if (OPENING_FIELD_CODES.includes(l.accountCode) || isControlAccount(l.accountCode)) {
      problems.push(`ยอดยกมา: บรรทัดใช้บัญชีคุม ${l.accountCode}`);
    }
  });
  if (toSatang(opening.vatCredit) < 0 || toSatang(opening.whtReceivable) < 0) problems.push('ยอดยกมา: ยอดภาษียกมาติดลบ');
  data.journal
    .filter((e) => e.id !== opening.journalId && e.date <= opening.date)
    .forEach((e) => problems.push(`${e.docNo}: ลงวันที่ไม่หลังวันยอดยกมา ${opening.date}`));
}

/**
 * ธนาคาร/เงินสดย่อย: ทะเบียนบัญชีอ้างบัญชีเงินในผังบัญชีตามช่วงรหัส ไม่ซ้ำ, ใบโอนเงินระหว่างบัญชีเงินคนละบัญชี ยอด > 0,
 * รายการ statement อยู่ในบัญชีธนาคารที่ลงทะเบียน, การจับคู่กระทบยอดอ้างรายการที่มีอยู่จริง ใช้ได้ครั้งเดียว และยอดเท่ากัน
 * ใบเสนอราคา: จำนวนวันยืนราคาเป็นจำนวนเต็มไม่ติดลบ
 */
function checkBanking(data: AccountingData, problems: string[]) {
  const accounts = new Map(data.accounts.map((a) => [a.code, a]));
  const registered = new Set<string>();
  data.bankAccounts.forEach((b) => {
    const label = `บัญชีเงิน ${b.accountCode}`;
    if (registered.has(b.accountCode)) problems.push(`${label}: ลงทะเบียนซ้ำ`);
    registered.add(b.accountCode);
    if (!isCashAccount(accounts.get(b.accountCode))) problems.push(`${label}: ไม่ใช่บัญชีเงินสด/ธนาคารในผังบัญชี`);
    if (!isBankKindCode(b.accountCode, b.kind)) problems.push(`${label}: รหัสไม่ตรงกับประเภท (ธนาคาร 112x, เงินสดย่อย 1111–1119)`);
    if (b.reconcileFrom !== undefined && !isValidISODate(b.reconcileFrom)) problems.push(`${label}: วันที่เริ่มกระทบยอดไม่ถูกต้อง`);
    // U9: เงินสดย่อยติดลบไม่ได้ ณ วันใดเลย (ธนาคารเบิกเกินบัญชีได้)
    if (b.kind === 'petty-cash' && toSatang(minCashBalanceFrom(data, b.accountCode, '0001-01-01')) < 0) {
      problems.push(`${label}: เงินสดย่อยติดลบ`);
    }
  });
  data.transfers.forEach((t) => {
    if (!isCashAccount(accounts.get(t.fromAccountCode)) || !isCashAccount(accounts.get(t.toAccountCode))) {
      problems.push(`${t.docNo}: โอนได้เฉพาะระหว่างบัญชีเงินสด/ธนาคาร`);
    }
    if (t.fromAccountCode === t.toAccountCode) problems.push(`${t.docNo}: บัญชีต้นทางและปลายทางเป็นบัญชีเดียวกัน`);
    if (!(toSatang(t.amount) > 0)) problems.push(`${t.docNo}: ยอดโอนต้องมากกว่า 0`);
  });
  const bankCodes = new Set(data.bankAccounts.filter((b) => b.kind === 'bank').map((b) => b.accountCode));
  const lineIds = new Set<string>();
  data.bankStatements.forEach((l) => {
    if (lineIds.has(l.id)) problems.push(`statement ${l.date}: รหัสรายการซ้ำ`);
    lineIds.add(l.id);
    if (!bankCodes.has(l.accountCode)) problems.push(`statement ${l.date} ${l.description}: ไม่ใช่บัญชีธนาคารที่ลงทะเบียน (${l.accountCode})`);
    if (toSatang(l.amount) === 0) problems.push(`statement ${l.date} ${l.description}: จำนวนเงินเป็นศูนย์`);
  });
  const matchIds = new Set<string>();
  const entries = new Map(data.journal.map((e) => [e.id, e]));
  data.bankMatches.forEach((m) => {
    if (matchIds.has(m.id)) problems.push(`การจับคู่กระทบยอด ${m.id}: รหัสซ้ำ`);
    matchIds.add(m.id);
    // ตรวจแต่ละคู่เทียบกับคู่อื่นทั้งหมด (รายการใช้ได้ครั้งเดียว, ยอดเท่ากัน, อ้างรายการที่มีอยู่จริง)
    const problem = bankMatchProblem(data, m, m.id);
    if (problem) {
      const docs = m.journalIds.map((id) => entries.get(id)?.docNo ?? id).join(', ');
      problems.push(`กระทบยอด ${m.accountCode} (${docs}): ${problem}`);
    }
  });
  data.quotations.forEach((q) => {
    if (!Number.isInteger(q.validDays) || q.validDays < 0) problems.push(`${q.docNo}: จำนวนวันยืนราคาไม่ถูกต้อง`);
  });
}

/**
 * ตรวจ invariant ของข้อมูลทั้งก้อน: ทุกรายการบัญชีสมดุล, เลขที่ไม่ซ้ำ ต่อเนื่อง และเรียงตามวันที่ต่อ prefix/เดือน,
 * การอ้างอิงมีอยู่จริง, ยอดค้าง/เงินรอคืนไม่ติดลบ, ยอดเอกสารตรงกับรายการบัญชี, บัญชีในบรรทัดถูกประเภท,
 * รายการคีย์มือไม่ลงบัญชีคุม และบัญชีคุมกระทบยอดกับทะเบียนย่อย/รายงานภาษีได้ — คืน [] ถ้าผ่าน
 */
export function validateAccountingData(data: AccountingData): string[] {
  const problems: string[] = [];
  if (data.company.lockedThrough !== undefined && !isValidISODate(data.company.lockedThrough)) {
    problems.push(`วันที่ปิดงวด "${data.company.lockedThrough}" ไม่ถูกต้อง`);
  }
  checkJournal(data, problems);
  checkNumbering(data, problems);
  checkDateOrder(data, problems);
  checkReferences(data, problems);
  checkBalances(data, problems);
  checkCreditParts(data, problems);
  checkPurchases(data, problems);
  checkVatCloses(data, problems);
  checkServiceVat(data, problems);
  checkYearCloses(data, problems);
  checkOpening(data, problems);
  checkLineAccounts(data, problems);
  checkBanking(data, problems);
  checkDocumentPostings(data, problems);
  checkReconciliation(data, problems);
  return problems;
}

/** ตัวระบุบริษัท (เลขผู้เสียภาษี + สาขา) จากข้อมูลบริษัท และ snapshot ผู้ขาย/ผู้จ่ายในเอกสารที่ออกแล้ว */
function companyIdentities(data: AccountingData): Set<string> {
  const key = (c: { taxId?: string; branchNo?: string } | undefined) =>
    c && normalizeTaxId(c.taxId ?? '') ? `${normalizeTaxId(c.taxId ?? '')}|${normalizeBranch5(c.branchNo)}` : '';
  return new Set(
    [
      key(data.company),
      ...data.sales.map((d) => key(d.seller)),
      ...data.receipts.map((d) => key(d.seller)),
      ...data.payments.map((d) => key(d.payer)),
    ].filter(Boolean)
  );
}

/** มีเอกสาร/รายการบัญชีแล้วหรือยัง (ข้อมูลว่างหลังล้าง = ยังไม่มี) */
export function hasBookEntries(data: AccountingData): boolean {
  return (
    data.journal.length > 0 ||
    data.sales.length > 0 ||
    data.receipts.length > 0 ||
    data.purchases.length > 0 ||
    data.payments.length > 0 ||
    data.quotations.length > 0
  );
}

/**
 * ไฟล์กับข้อมูลปัจจุบันมีเอกสารชุดเดียวกัน — รหัสเอกสาร/รายการบัญชี หรือเลขที่ + วันที่ ตรงกันอย่างน้อย 1 รายการ
 * (เลขที่อย่างเดียวไม่พอ เพราะบริษัทต่างกันออก IV6910-0001 ได้เหมือนกัน)
 */
function sharesDocuments(current: AccountingData, next: AccountingData): boolean {
  const refs = (d: AccountingData) => [
    ...d.journal.map((e) => `id:${e.id}`),
    ...d.sales.map((x) => `id:${x.id}`),
    ...d.receipts.map((x) => `id:${x.id}`),
    ...d.purchases.map((x) => `id:${x.id}`),
    ...d.payments.map((x) => `id:${x.id}`),
    ...collectNumberedDocs(d).map((x) => `no:${x.docNo}|${x.date}`),
  ];
  const mine = new Set(refs(current));
  return refs(next).some((r) => mine.has(r));
}

/**
 * ตรวจก่อนกู้คืน backup ทับข้อมูลปัจจุบัน — ห้ามวันปิดงวดถอยหลัง, ห้ามตัวนับเลขที่ถอยหลัง (เลขที่ที่ออกไปแล้วจะถูกออกซ้ำ),
 * ห้ามเพิ่มวันยกเว้นลำดับเลขที่เอกสารเดิม (`legacyOrderThrough` ตั้งโดย migration เท่านั้น)
 *
 * บริษัทเดียวกันหรือไม่ (U3 — แก้ `company.taxId` ในไฟล์แล้วข้ามการตรวจไม่ได้): เทียบเลขผู้เสียภาษี+สาขาของบริษัท
 * และ snapshot ผู้ขายในเอกสารที่ออกแล้วของทั้งสองฝั่ง — ตรงกันอย่างน้อย 1 ค่า = บริษัทเดียวกัน
 * ไม่ตรงกัน: ข้อมูลปัจจุบันยังว่าง = กู้คืนได้ (สมุดบัญชีคนละชุด), มีเอกสารร่วมกัน = ถือว่าบริษัทเดียวกัน (ไฟล์ถูกแก้),
 * ไม่มีเอกสารร่วม = ไฟล์ของบริษัทอื่น ต้องล้างข้อมูลก่อน — คืน [] ถ้ากู้คืนได้
 */
export function restoreRegressions(current: AccountingData, next: AccountingData): string[] {
  const mine = companyIdentities(current);
  const theirs = companyIdentities(next);
  const sameIdentity = Array.from(theirs).some((k) => mine.has(k));
  if (!sameIdentity) {
    if (!hasBookEntries(current)) return [];
    if (!sharesDocuments(current, next)) return ['ไฟล์เป็นของบริษัทอื่น — ต้องล้างข้อมูลก่อน (หน้าตั้งค่า) แล้วจึงกู้คืน'];
  }
  const problems: string[] = [];
  const lock = current.company.lockedThrough;
  if (lock && (!next.company.lockedThrough || next.company.lockedThrough < lock)) {
    problems.push(
      `ไฟล์ปิดงวดถึง ${next.company.lockedThrough ? formatThaiDate(next.company.lockedThrough) : '(ยังไม่ปิด)'} แต่ข้อมูลปัจจุบันปิดถึง ${formatThaiDate(lock)} แล้ว — กู้คืนแล้วจะลงรายการในงวดที่ปิดแล้วได้`
    );
  }
  Object.entries(current.sequences)
    .filter(([key, value]) => (next.sequences[key] ?? 0) < value)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => {
      problems.push(`ตัวนับเลขที่ ${key} ในไฟล์ = ${next.sequences[key] ?? 0} น้อยกว่าปัจจุบัน (${value}) — เลขที่ที่ออกไปแล้วจะถูกออกซ้ำ`);
    });
  const legacy = next.legacyOrderThrough;
  if (legacy && (!current.legacyOrderThrough || legacy > current.legacyOrderThrough) && hasBookEntries(current)) {
    problems.push(
      `ไฟล์ยกเว้นลำดับเลขที่เอกสารเดิมถึง ${formatThaiDate(legacy)} มากกว่าข้อมูลปัจจุบัน (${current.legacyOrderThrough ? formatThaiDate(current.legacyOrderThrough) : 'ไม่มี'}) — ค่านี้ตั้งโดยการย้ายข้อมูลเท่านั้น`
    );
  }
  return problems;
}
