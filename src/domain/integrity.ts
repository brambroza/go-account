import { toSatang } from './money';
import { calcDocument } from './document-calc';
import { parseDocNo, DATE_ORDERED_PREFIXES } from './numbering';
import { normalizeTaxId, normalizeBranch5 } from './thai-tax-id';
import { salesVatReport, purchaseVatReport } from './vat-report';
import { docPeriodCode, formatThaiDate, isValidISODate } from './thai-date';
import { ACC, isControlAccount, lineAccountProblem } from './chart-of-accounts';
import { outstandingOf, creditedPartsOf, creditedTotalOf, customerCreditOf } from './receivables';
import {
  isBalanced,
  postReceipt,
  postPurchase,
  postCreditNote,
  postSalesInvoice,
  postCustomerRefund,
  postPurchasePayment,
} from './posting';

import type { LineSide } from './chart-of-accounts';
import type { ISODate, JournalLine, JournalEntry, AccountingData } from './types';

// ----------------------------------------------------------------------
// ตรวจความถูกต้องของข้อมูลทั้งก้อน (invariant) — ใช้ก่อนกู้คืน backup และตอนโหลดจากเครื่อง
// คืนรายการปัญหาเป็นข้อความภาษาไทย ว่าง = ผ่าน (ไม่ throw ให้หน้าจอแสดงรายการให้ผู้ใช้ตัดสินใจ)
// ----------------------------------------------------------------------

export type NumberedDoc = { docNo: string; date: ISODate; prefixes: readonly string[]; label: string };

function collectNumberedDocs(data: AccountingData): NumberedDoc[] {
  return [
    ...data.sales.map((s) => ({
      docNo: s.docNo,
      date: s.date,
      prefixes: s.kind === 'credit-note' ? ['CN', 'CM'] : ['IV', 'BL'],
      label: 'เอกสารขาย',
    })),
    ...data.receipts.map((r) => ({ docNo: r.docNo, date: r.date, prefixes: ['RE'], label: 'ใบเสร็จ' })),
    ...data.purchases.map((p) => ({ docNo: p.docNo, date: p.date, prefixes: ['PI'], label: 'เอกสารซื้อ' })),
    ...data.payments.map((p) => ({ docNo: p.docNo, date: p.date, prefixes: ['PV'], label: 'ใบสำคัญจ่าย' })),
    ...data.payments
      .filter((p) => p.whtCertNo)
      .map((p) => ({ docNo: p.whtCertNo as string, date: p.date, prefixes: ['WT'], label: 'หนังสือรับรอง 50 ทวิ' })),
    ...data.refunds.map((r) => ({ docNo: r.docNo, date: r.date, prefixes: ['RF'], label: 'ใบคืนเงิน' })),
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
  const payments = new Set(data.payments.map((p) => p.id));
  const needJournal = (docNo: string, id: string | undefined) => {
    if (!id || !journal.has(id)) problems.push(`${docNo}: ไม่พบรายการบัญชีที่ผูกไว้`);
  };
  const needContact = (docNo: string, id: string) => {
    if (!contacts.has(id)) problems.push(`${docNo}: ไม่พบผู้ติดต่อที่อ้างถึง`);
  };

  data.sales.forEach((s) => {
    needContact(s.docNo, s.contactId);
    needJournal(s.docNo, s.journalId);
    if (s.kind === 'credit-note') {
      const ref = s.refDocId ? sales.get(s.refDocId) : undefined;
      if (!ref || ref.kind !== 'tax-invoice') problems.push(`${s.docNo}: ไม่พบใบกำกับที่อ้างถึง`);
    }
  });
  data.receipts.forEach((r) => {
    needJournal(r.docNo, r.journalId);
    if (!sales.has(r.invoiceId)) problems.push(`${r.docNo}: ไม่พบใบกำกับที่รับชำระ`);
  });
  data.purchases.forEach((p) => {
    needContact(p.docNo, p.contactId);
    needJournal(p.docNo, p.journalId);
    if (p.paid) {
      needJournal(p.docNo, p.paymentJournalId);
      if (!p.paymentId || !payments.has(p.paymentId)) problems.push(`${p.docNo}: จ่ายแล้วแต่ไม่พบใบสำคัญจ่าย`);
    }
  });
  data.payments.forEach((p) => {
    needJournal(p.docNo, p.journalId);
    if (!purchases.has(p.purchaseId)) problems.push(`${p.docNo}: ไม่พบเอกสารซื้อที่จ่าย`);
  });
  data.refunds.forEach((r) => {
    needContact(r.docNo, r.contactId);
    needJournal(r.docNo, r.journalId);
  });
}

function checkBalances(data: AccountingData, problems: string[]) {
  data.sales
    .filter((s) => s.kind === 'tax-invoice')
    .forEach((inv) => {
      if (toSatang(outstandingOf(data, inv)) < 0) problems.push(`${inv.docNo}: ยอดค้างชำระติดลบ`);
      if (toSatang(creditedTotalOf(data, inv)) > toSatang(calcDocument(inv).total)) {
        problems.push(`${inv.docNo}: ลดหนี้รวมเกินยอดใบกำกับ`);
      }
      const received = data.receipts.filter((r) => r.invoiceId === inv.id).reduce((acc, r) => acc + toSatang(r.amount), 0);
      if (received !== toSatang(inv.paidAmount)) problems.push(`${inv.docNo}: ยอดรับชำระไม่ตรงกับใบเสร็จ`);
    });
  data.contacts.forEach((c) => {
    if (toSatang(customerCreditOf(data, c.id)) < 0) problems.push(`${c.code}: คืนเงินลูกค้าเกินยอดรอคืน`);
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
  data.purchases.forEach((p) => check(p.docNo, p.lines.map((l) => l.accountCode), 'purchase'));
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

  data.sales.forEach((s) =>
    expected.set(s.journalId, {
      docNo: s.docNo,
      build: () => (s.kind === 'credit-note' ? postCreditNote(s, meta(s.journalId), '') : postSalesInvoice(s, meta(s.journalId), '')),
    })
  );
  data.receipts.forEach((r) =>
    expected.set(r.journalId, {
      docNo: r.docNo,
      build: () => postReceipt(r, meta(r.journalId), '', invoices.get(r.invoiceId)?.docNo ?? ''),
    })
  );
  data.purchases.forEach((p) => expected.set(p.journalId, { docNo: p.docNo, build: () => postPurchase(p, meta(p.journalId), '') }));
  data.payments.forEach((pv) => {
    const purchase = purchases.get(pv.purchaseId);
    if (!purchase) return;
    expected.set(pv.journalId, {
      docNo: pv.docNo,
      build: () => postPurchasePayment(purchase, meta(pv.journalId), '', pv.accountCode, pv.date, pv),
    });
  });
  data.refunds.forEach((r) => expected.set(r.journalId, { docNo: r.docNo, build: () => postCustomerRefund(r, meta(r.journalId), '') }));

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
      const t = calcDocument(inv);
      const credited = creditedPartsOf(data, inv);
      if (toSatang(credited.vat) > toSatang(t.vat)) problems.push(`${inv.docNo}: VAT ที่ลดหนี้รวมเกิน VAT ของใบกำกับ`);
      if (toSatang(credited.net) > toSatang(t.net)) problems.push(`${inv.docNo}: มูลค่าที่ลดหนี้รวมเกินมูลค่าของใบกำกับ`);
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
  check(
    `${ACC.payable} เจ้าหนี้การค้า`,
    -glNet(data, ACC.payable),
    sum(data.purchases.filter((p) => !p.paid).map((p) => calcDocument(p).total))
  );
  check(`${ACC.whtReceivable} ภาษีถูกหัก ณ ที่จ่าย`, glNet(data, ACC.whtReceivable), sum(data.receipts.map((r) => r.whtAmount)));
  check(`${ACC.whtPayable} ภาษีหัก ณ ที่จ่ายค้างจ่าย`, -glNet(data, ACC.whtPayable), sum(data.payments.map((p) => p.whtAmount)));

  const months = new Set<string>();
  [...data.sales, ...data.purchases, ...data.journal].forEach((d) => {
    if (isValidISODate(d.date)) months.add(d.date.slice(0, 7));
  });
  Array.from(months)
    .sort()
    .forEach((m) => {
      const period = { year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) };
      const inMonth = (e: JournalEntry) => e.date.startsWith(m);
      check(
        `${ACC.outputVat} ภาษีขาย ${m}`,
        -glNet(data, ACC.outputVat, inMonth),
        sum(salesVatReport(data.sales, data.contacts, period).map((r) => r.vat))
      );
      check(
        `${ACC.inputVat} ภาษีซื้อ ${m}`,
        glNet(data, ACC.inputVat, inMonth),
        sum(purchaseVatReport(data.purchases, data.contacts, period).map((r) => r.vat))
      );
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
  checkLineAccounts(data, problems);
  checkDocumentPostings(data, problems);
  checkReconciliation(data, problems);
  return problems;
}

/**
 * ตรวจก่อนกู้คืน backup ทับข้อมูลปัจจุบันของบริษัทเดียวกัน (เลขผู้เสียภาษี + สาขาเดียวกัน):
 * ห้ามวันปิดงวดถอยหลัง และห้ามตัวนับเลขที่ถอยหลัง (ไม่อย่างนั้นเลขที่ออกไปแล้วจะถูกออกซ้ำ / ลงงวดที่ปิดแล้วได้)
 * ไฟล์ของบริษัทอื่น (เช่น หลังล้างเป็นข้อมูลตัวอย่าง) ไม่เทียบ เพราะเป็นสมุดบัญชีคนละชุด — คืน [] ถ้ากู้คืนได้
 */
export function restoreRegressions(current: AccountingData, next: AccountingData): string[] {
  const sameCompany =
    normalizeTaxId(current.company.taxId) === normalizeTaxId(next.company.taxId) &&
    normalizeBranch5(current.company.branchNo) === normalizeBranch5(next.company.branchNo);
  if (!sameCompany) return [];
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
  return problems;
}
