import { toSatang } from './money';
import { isBalanced } from './posting';
import { parseDocNo } from './numbering';
import { calcDocument } from './document-calc';
import { docPeriodCode, isValidISODate } from './thai-date';
import { outstandingOf, creditedTotalOf, customerCreditOf } from './receivables';

import type { ISODate, AccountingData } from './types';

// ----------------------------------------------------------------------
// ตรวจความถูกต้องของข้อมูลทั้งก้อน (invariant) — ใช้ก่อนกู้คืน backup และตอนโหลดจากเครื่อง
// คืนรายการปัญหาเป็นข้อความภาษาไทย ว่าง = ผ่าน (ไม่ throw ให้หน้าจอแสดงรายการให้ผู้ใช้ตัดสินใจ)
// ----------------------------------------------------------------------

type NumberedDoc = { docNo: string; date: ISODate; prefixes: readonly string[]; label: string };

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
 * ตรวจ invariant ของข้อมูลทั้งก้อน: ทุกรายการบัญชีสมดุล, เลขที่ไม่ซ้ำและต่อเนื่องต่อ prefix/เดือน,
 * การอ้างอิงมีอยู่จริง, ยอดค้าง/เงินรอคืนไม่ติดลบ — คืน [] ถ้าผ่าน
 */
export function validateAccountingData(data: AccountingData): string[] {
  const problems: string[] = [];
  if (data.company.lockedThrough !== undefined && !isValidISODate(data.company.lockedThrough)) {
    problems.push(`วันที่ปิดงวด "${data.company.lockedThrough}" ไม่ถูกต้อง`);
  }
  checkJournal(data, problems);
  checkNumbering(data, problems);
  checkReferences(data, problems);
  checkBalances(data, problems);
  return problems;
}
