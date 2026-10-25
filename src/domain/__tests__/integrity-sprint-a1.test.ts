import { issueTaxInvoice } from 'src/store/actions';
import { emptyData, buildDemoData, blankCompanyData } from 'src/store/seed';

import { csvCell } from '../vat-report';
import { endOfPreviousMonth } from '../thai-date';
import { normalizeInvoiceNo, contactsWithSameTaxId } from '../duplicates';
import { ACC , isCashAccount, lineAccountProblem } from '../chart-of-accounts';
import { restoreRegressions, dateOrderInversions, validateAccountingData } from '../integrity';

import type { AccountingData } from '../types';

// ----------------------------------------------------------------------
// Sprint A.1 — การตรวจข้อมูลทั้งก้อน (T5) และ helper ใหม่
// เคส R3/R8/R9 มาจากการโจมตีของ financial-auditor: แก้ไฟล์ backup แล้ว validate เดิมไม่จับ
// ----------------------------------------------------------------------

const TODAY = '2026-10-24';

function clone(data: AccountingData): AccountingData {
  return JSON.parse(JSON.stringify(data));
}

const demo = () => buildDemoData(TODAY);

/** ใบกำกับ 2 ใบล่าสุดของเดือน ต.ค. (เลขเรียงตามวันที่) */
function lastTwoInvoices(data: AccountingData) {
  const ivs = data.sales.filter((s) => s.docNo.startsWith('IV6910')).sort((a, b) => a.docNo.localeCompare(b.docNo));
  const [a, b] = ivs.slice(-2);
  return { a, b };
}

/** สลับเลขที่ของใบกำกับสองใบ (และ sourceDocNo ในสมุดรายวันให้ตรง) → เลขไม่เรียงตามวันที่ */
function swapNumbers(data: AccountingData): AccountingData {
  const t = clone(data);
  const { a, b } = lastTwoInvoices(t);
  expect(a.date < b.date).toBe(true);
  [a.docNo, b.docNo] = [b.docNo, a.docNo];
  t.journal.forEach((e) => {
    if (e.id === a.journalId) e.sourceDocNo = a.docNo;
    if (e.id === b.journalId) e.sourceDocNo = b.docNo;
  });
  return t;
}

describe('validateAccountingData — T5 tamper detection', () => {
  it('demo data is clean', () => {
    expect(validateAccountingData(demo())).toEqual([]);
  });

  it('R3: numbers out of date order within a prefix are detected', () => {
    const problems = validateAccountingData(swapNumbers(demo()));
    expect(problems.some((p) => p.includes('เรียงตามวันที่'))).toBe(true);
  });

  it('R3: swapping only the docNo (journal left alone) is also caught by the posting link', () => {
    const t = clone(demo());
    const { a, b } = lastTwoInvoices(t);
    [a.docNo, b.docNo] = [b.docNo, a.docNo];
    expect(validateAccountingData(t).some((p) => p.includes('ผูกกับเอกสาร'))).toBe(true);
  });

  it('legacyOrderThrough exempts only documents dated on/before it', () => {
    const t = swapNumbers(demo());
    const { a, b } = lastTwoInvoices(t);
    const earlier = a.date > b.date ? a.date : b.date;
    expect(dateOrderInversions(t)).toHaveLength(1);
    expect(dateOrderInversions(t, earlier)).toHaveLength(0);
    expect(validateAccountingData({ ...t, legacyOrderThrough: earlier })).toEqual([]);
  });

  it('R8: document amounts edited without the journal are detected', () => {
    const t = clone(demo());
    const inv = t.sales.find((s) => s.kind === 'tax-invoice' && s.status === 'issued');
    if (!inv) throw new Error('no invoice');
    inv.lines[0].unitPrice *= 2;
    expect(validateAccountingData(t).some((p) => p.includes(`${inv.docNo}: ยอดในเอกสารไม่ตรงกับรายการบัญชี`))).toBe(true);
  });

  it('R8: purchase / receipt / payment edited without the journal are detected', () => {
    const base = demo();
    const t1 = clone(base);
    t1.purchases[0].lines[0].unitPrice += 1;
    const t2 = clone(base);
    t2.receipts[0].whtAmount += 1;
    const t3 = clone(base);
    t3.payments[0].accountCode = ACC.cash === t3.payments[0].accountCode ? ACC.bank : ACC.cash;
    const t4 = clone(base);
    t4.receipts[0].date = '2026-10-23';
    [t1, t2, t3].forEach((t) => expect(validateAccountingData(t).some((p) => p.includes('ไม่ตรงกับรายการบัญชี'))).toBe(true));
    expect(validateAccountingData(t4).some((p) => p.includes('วันที่ไม่ตรงกับรายการบัญชี'))).toBe(true);
  });

  it('R9: forged manual JV on a control account (correct numbering) is detected and does not reconcile', () => {
    const t = clone(demo());
    const n = (t.sequences.JV6910 ?? 0) + 1;
    t.sequences.JV6910 = n;
    t.journal.push({
      id: 'forged',
      docNo: `JV6910-${String(n).padStart(4, '0')}`,
      date: '2026-10-24',
      description: 'ลดภาษีขาย',
      source: 'manual',
      lines: [
        { accountCode: ACC.outputVat, debit: 5000, credit: 0 },
        { accountCode: ACC.misc, debit: 0, credit: 5000 },
      ],
    });
    const problems = validateAccountingData(t);
    expect(problems.some((p) => p.includes('รายการปรับปรุงลงบัญชีคุม 2150'))).toBe(true);
    expect(problems.some((p) => p.startsWith('2150 ภาษีขาย 2026-10'))).toBe(true);
  });

  it('journal entry claiming a document source without a document is detected', () => {
    const t = clone(demo());
    const n = (t.sequences.JV6910 ?? 0) + 1;
    t.sequences.JV6910 = n;
    t.journal.push({
      id: 'orphan',
      docNo: `JV6910-${String(n).padStart(4, '0')}`,
      date: '2026-10-24',
      description: 'ขายเชื่อ',
      source: 'sales',
      lines: [
        { accountCode: ACC.receivable, debit: 100, credit: 0 },
        { accountCode: ACC.sales, debit: 0, credit: 100 },
      ],
    });
    const problems = validateAccountingData(t);
    expect(problems.some((p) => p.includes('ไม่มีเอกสารต้นทาง'))).toBe(true);
    expect(problems.some((p) => p.startsWith('1130 ลูกหนี้การค้า'))).toBe(true);
  });

  it('T2: a document line coded to a control account in the file is detected (C3)', () => {
    const t = clone(demo());
    const inv = t.sales.find((s) => s.kind === 'tax-invoice');
    if (!inv) throw new Error('no invoice');
    inv.lines[0].accountCode = ACC.outputVat;
    expect(validateAccountingData(t).some((p) => p.includes(`${inv.docNo}: บรรทัดรายการใช้บัญชี 2150`))).toBe(true);
  });
});

describe('restoreRegressions — T4', () => {
  it('same company: lock and counters must not go backwards; other company is not compared', () => {
    const current = demo();
    const older = clone(current);
    older.sequences.IV6910 -= 1;
    expect(restoreRegressions(current, current)).toEqual([]);
    expect(restoreRegressions(current, older)[0]).toMatch(/IV6910.*ออกซ้ำ/);
    const locked = { ...current, company: { ...current.company, lockedThrough: '2026-09-30' } };
    expect(restoreRegressions(locked, current)[0]).toMatch(/ปิดงวด/);
    expect(restoreRegressions(locked, { ...current, company: { ...current.company, lockedThrough: '2026-10-31' } })).toEqual([]);
    // U3: ไฟล์เดิมที่แก้แค่ company.taxId — snapshot ในเอกสารยังเป็นบริษัทเดิม → ยังเทียบ (ข้ามการตรวจไม่ได้)
    const edited = { ...older, company: { ...older.company, taxId: '0105561098763' } };
    expect(restoreRegressions(current, edited)[0]).toMatch(/IV6910.*ออกซ้ำ/);
    // แก้ snapshot ทุกใบด้วย แต่เอกสารชุดเดียวกัน (รหัส/เลขที่+วันที่ตรงกัน) → ถือว่าบริษัทเดียวกัน
    const rebranded = clone(edited);
    [...rebranded.sales, ...rebranded.receipts].forEach((d) => {
      if (d.seller) d.seller.taxId = '0105561098763';
    });
    rebranded.payments.forEach((d) => {
      if (d.payer) d.payer.taxId = '0105561098763';
    });
    expect(restoreRegressions(current, rebranded)[0]).toMatch(/IV6910.*ออกซ้ำ/);
    // บริษัทอื่นจริง (ไม่มีเอกสารร่วม): ทับสมุดบัญชีที่มีรายการแล้วไม่ได้ — ต้องล้างข้อมูลก่อน
    const foreignBase = emptyData();
    const foreign = issueTaxInvoice(
      { ...foreignBase, company: { ...foreignBase.company, taxId: '0105561098763' }, contacts: current.contacts },
      {
        date: '2026-11-15',
        dueDate: '2026-11-30',
        contactId: 'c-abc',
        vatMode: 'exclusive',
        lines: [{ id: 'f1', description: 'บริการ', qty: 1, unitPrice: 100, discount: 0, accountCode: ACC.sales }],
      }
    ).state;
    expect(restoreRegressions(current, foreign)).toEqual([expect.stringMatching(/บริษัทอื่น.*ล้างข้อมูล/)]);
    expect(restoreRegressions(blankCompanyData(current), foreign)).toEqual([]);
  });

  it('U12: legacyOrderThrough in the file cannot be raised on restore', () => {
    const current = demo();
    expect(restoreRegressions(current, { ...current, legacyOrderThrough: '2099-12-31' })[0]).toMatch(/ยกเว้นลำดับเลขที่/);
    const migrated = { ...current, legacyOrderThrough: '2026-09-30' };
    expect(restoreRegressions(migrated, migrated)).toEqual([]);
    expect(restoreRegressions(migrated, { ...migrated, legacyOrderThrough: '2026-10-01' })[0]).toMatch(/ยกเว้นลำดับเลขที่/);
  });
});

describe('helpers', () => {
  it('normalizeInvoiceNo folds formatting variants but keeps different numbers apart', () => {
    const same = ['INV-001', 'inv 001', 'INV–001', 'ＩＮＶ－００１', 'INV-0001', 'INV/001', 'INV_001', 'INV-001​', 'INV.๐๐๑'];
    expect(new Set(same.map(normalizeInvoiceNo))).toEqual(new Set(['INV1']));
    expect(new Set(['INV-001', 'INV-010', 'INV-100', 'IV-001', 'INV-002'].map(normalizeInvoiceNo)).size).toBe(5);
    expect(normalizeInvoiceNo('  ')).toBe('');
    expect(normalizeInvoiceNo('000')).toBe('0');
    expect(normalizeInvoiceNo('ภพ-12')).toBe('ภพ12');
  });

  it('contactsWithSameTaxId matches taxId + branch, ignores the contact itself and empty taxIds', () => {
    const { contacts } = demo();
    const c = contacts.find((x) => x.taxId) ?? contacts[0];
    expect(contactsWithSameTaxId(contacts, { taxId: c.taxId, branchNo: c.branchNo }).map((x) => x.id)).toEqual([c.id]);
    expect(contactsWithSameTaxId(contacts, { id: c.id, taxId: c.taxId, branchNo: c.branchNo })).toEqual([]);
    expect(contactsWithSameTaxId(contacts, { taxId: c.taxId, branchNo: '00099' })).toEqual([]);
    expect(contactsWithSameTaxId(contacts, { taxId: '', branchNo: '00000' })).toEqual([]);
  });

  it('X1: csvCell neutralises formulas hidden behind leading whitespace / full-width =', () => {
    [' =1+1', '\n=1+1', '  +SUM(A1)', '＝1+1', ' -2+3', '=HYPERLINK("x")'].forEach((v) =>
      expect(csvCell(v).startsWith(`"'`)).toBe(true)
    );
    expect(csvCell('บริษัท ก')).toBe('"บริษัท ก"');
    expect(csvCell(' ABC')).toBe('" ABC"');
  });

  it('isCashAccount / lineAccountProblem', () => {
    const { accounts } = demo();
    const get = (code: string) => accounts.find((a) => a.code === code);
    expect([ACC.cash, ACC.bank].every((c) => isCashAccount(get(c)))).toBe(true);
    expect([ACC.receivable, ACC.inventory, ACC.inputVat, ACC.sales].some((c) => isCashAccount(get(c)))).toBe(false);
    expect(lineAccountProblem(get(ACC.sales), 'sales')).toBeNull();
    expect(lineAccountProblem(get(ACC.inventory), 'purchase')).toBeNull();
    expect(lineAccountProblem(undefined, 'sales')).toMatch(/ไม่พบ/);
    expect(lineAccountProblem(get(ACC.capital), 'purchase')).toMatch(/ไม่ใช่บัญชีค่าใช้จ่าย/);
  });

  it('endOfPreviousMonth', () => {
    expect(endOfPreviousMonth('2026-10-24')).toBe('2026-09-30');
    expect(endOfPreviousMonth('2026-03-01')).toBe('2026-02-28');
    expect(endOfPreviousMonth('2027-01-15')).toBe('2026-12-31');
  });
});
