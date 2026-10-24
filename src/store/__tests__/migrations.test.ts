import type { AccountingData } from 'src/domain';

import { ACC, DATA_VERSION, validateAccountingData } from 'src/domain';

import { demo, toV1, toV3, toV4, toV5 } from './fixtures';
import { readAccountingJson, readAccountingData } from '../migrations';

// ----------------------------------------------------------------------

describe('migration v1 → v2 (A5, A7)', () => {
  const original = demo();
  const v1 = toV1(original);

  it('backfills snapshots, payment vouchers and the WT sequence', () => {
    const result = readAccountingData(v1);
    expect(result.migratedFrom).toBe(1);
    expect(result.problems).toEqual([]);
    const {data} = result;
    if (!data) throw new Error('migrate failed');
    expect(data.version).toBe(DATA_VERSION);
    expect(data.refunds).toEqual([]);
    expect(data.accounts.some((a) => a.code === ACC.customerCredit)).toBe(true);
    expect(data.sales.every((s) => s.seller && s.buyer && s.isTaxInvoice === true)).toBe(true);
    expect(data.sales.filter((s) => s.kind === 'credit-note').every((s) => s.creditToCustomer === 0)).toBe(true);
    expect(data.receipts.every((r) => r.buyer && r.seller)).toBe(true);
    expect(data.purchases.every((p) => p.supplier)).toBe(true);

    // เลข PV ที่ v1 ใช้ไปแล้วได้คืนมาตรงตัว, เลข 50 ทวิ ออกใหม่ต่อเนื่อง
    const pick = (list: typeof data.payments) => list.map((p) => [p.purchaseId, p.docNo, p.date, p.whtCertNo, p.netPaid]);
    expect(pick(data.payments)).toEqual(pick(original.payments));
    // ไฟล์เวอร์ชันเก่ายังไม่มีใบเสนอราคา (QT) — ตัวนับอื่นต้องเท่าเดิมทุกตัว
    expect(data.sequences).toEqual(toV5(original).sequences);
    data.payments.forEach((pv) => {
      const entry = data.journal.find((e) => e.id === pv.journalId);
      expect(entry?.sourceDocNo).toBe(pv.docNo);
    });
    // v4: หัก ณ ที่จ่ายระดับบรรทัด และ whtItems ในใบสำคัญจ่ายตรงกับต้นฉบับ
    expect(data.purchases.map((p) => p.lines)).toEqual(original.purchases.map((p) => p.lines));
    expect(data.payments.map((p) => p.whtItems)).toEqual(original.payments.map((p) => p.whtItems));
  });

  it('accepts the current version as is and rejects unknown input', () => {
    expect(readAccountingData(original)).toEqual({ data: original, problems: [], migratedFrom: undefined });
    expect(readAccountingData(null).data).toBeNull();
    expect(readAccountingData([]).problems[0]).toMatch(/ไม่ใช่ข้อมูล/);
    expect(readAccountingData({ ...original, version: 99 }).problems[0]).toMatch(/ไม่รองรับ/);
    expect(readAccountingData({ version: 1, company: {} }).problems[0]).toMatch(/ไม่ครบ/);
    expect(readAccountingJson('{oops').problems[0]).toMatch(/อ่านไฟล์ไม่ได้/);
  });

  it('reports schema problems with the field path', () => {
    const bad = { ...original, sales: [{ ...original.sales[0], date: '2569-10-03' }] };
    const result = readAccountingData(bad);
    expect(result.data).toBeNull();
    expect(result.problems[0]).toMatch(/^sales\.0\.date:/);
  });

  it('keeps structurally valid data but lists broken rules', () => {
    const broken = { ...original, journal: original.journal.slice(1) };
    const result = readAccountingData(JSON.parse(JSON.stringify(broken)));
    expect(result.data).not.toBeNull();
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.problems).toEqual(validateAccountingData(broken));
  });

  it('fails gracefully when v1 data cannot be migrated', () => {
    const corrupt = { ...v1, purchases: [{ paid: true, paymentJournalId: 'x', lines: null }], journal: [{ id: 'x', source: 'payment', date: '2026-10-01', lines: [] }] };
    expect(readAccountingData(corrupt).problems[0]).toMatch(/ย้ายข้อมูลเวอร์ชัน 1 ไม่สำเร็จ/);
  });
});

// ----------------------------------------------------------------------

describe('migration v2 → v3 (legacy number order)', () => {
  /** v1 ไม่บังคับเลขเรียงตามวันที่ — จำลองข้อมูลจริงที่ IV ใบหลังลงวันที่ก่อนใบก่อนหน้า */
  function outOfOrder() {
    const data = JSON.parse(JSON.stringify(demo())) as ReturnType<typeof demo>;
    const ivs = data.sales.filter((s) => s.docNo.startsWith('IV6910')).sort((a, b) => a.docNo.localeCompare(b.docNo));
    const [a, b] = ivs.slice(-2);
    [a.docNo, b.docNo] = [b.docNo, a.docNo];
    data.journal.forEach((e) => {
      if (e.id === a.journalId) e.sourceDocNo = a.docNo;
      if (e.id === b.journalId) e.sourceDocNo = b.docNo;
    });
    return { data, laterDate: a.date > b.date ? a.date : b.date };
  }

  it('v2 data without inversions migrates unchanged except the version', () => {
    const v2 = { ...toV3(demo()), version: 2 };
    const result = readAccountingData(v2);
    expect(result.migratedFrom).toBe(2);
    expect(result.problems).toEqual([]);
    expect(result.data?.version).toBe(DATA_VERSION);
    expect(result.data?.legacyOrderThrough).toBeUndefined();
  });

  it('grandfathers inversions that came from v1 / v2 history, but not in current-version files', () => {
    const { data, laterDate } = outOfOrder();
    const fromV2 = readAccountingData({ ...toV3(data), version: 2 });
    expect(fromV2.problems).toEqual([]);
    expect(fromV2.data?.legacyOrderThrough).toBe(laterDate);

    const fromV1 = readAccountingData(toV1(data));
    expect(fromV1.migratedFrom).toBe(1);
    expect(fromV1.problems).toEqual([]);
    expect(fromV1.data?.legacyOrderThrough).toBe(laterDate);

    // ไฟล์เวอร์ชันปัจจุบันที่เลขไม่เรียง = ถูกแก้ไฟล์ → รายงานปัญหา
    expect(readAccountingData(data).problems.some((p) => p.includes('เรียงตามวันที่'))).toBe(true);
  });

  it('readAccountingJson round-trips the migrated data', () => {
    const { data } = outOfOrder();
    const migrated = readAccountingJson(JSON.stringify({ ...toV3(data), version: 2 })).data;
    expect(migrated && readAccountingJson(JSON.stringify(migrated)).problems).toEqual([]);
  });
});

// ----------------------------------------------------------------------

describe('migration v3 → v4 (Sprint B batch 2)', () => {
  const original = demo();
  const v3 = toV3(original);

  it('moves WHT to lines, backfills supplier invoice date / claim period, voucher WHT items and credit-note values', () => {
    const result = readAccountingData(JSON.parse(JSON.stringify(v3)));
    expect(result.migratedFrom).toBe(3);
    expect(result.problems).toEqual([]);
    const { data } = result;
    if (!data) throw new Error('migrate failed');
    expect(data.version).toBe(DATA_VERSION);
    expect(data.vatCloses).toEqual([]);
    expect(data.accounts.some((a) => a.code === ACC.vatCredit)).toBe(true);
    data.purchases.forEach((p, i) => {
      expect(p.lines).toEqual(original.purchases[i].lines);
      expect(p.supplierInvoiceDate).toBe(p.date);
      expect(p.vatClaimPeriod).toBe(p.claimVat ? p.date.slice(0, 7) : undefined);
      expect(Object.keys(p)).not.toContain('whtRate');
      expect(Object.keys(p)).not.toContain('paymentJournalId');
    });
    expect(data.payments.map((p) => p.whtItems)).toEqual(original.payments.map((p) => p.whtItems));
    const cn = data.sales.find((s) => s.kind === 'credit-note');
    const orig = original.sales.find((s) => s.kind === 'credit-note');
    expect([cn?.originalNet, cn?.correctNet]).toEqual([orig?.originalNet, orig?.correctNet]);
    // ไฟล์เวอร์ชันเก่ายังไม่มีใบเสนอราคา (QT) — ตัวนับอื่นต้องเท่าเดิมทุกตัว
    expect(data.sequences).toEqual(toV5(original).sequences);
    expect(data.payments.map((p) => [p.docNo, p.amount, p.whtAmount, p.whtCertNo])).toEqual(
      original.payments.map((p) => [p.docNo, p.amount, p.whtAmount, p.whtCertNo])
    );
  });

  it('grandfathers purchase numbers that were out of date order before PI was date-ordered', () => {
    type Doc = { date: string; docNo: string; journalId: string; id: string };
    const data = JSON.parse(JSON.stringify(toV3(original))) as { purchases: Doc[]; journal: Doc[] };
    const pis = data.purchases.filter((p) => p.docNo.startsWith('PI6910')).sort((a, b) => a.docNo.localeCompare(b.docNo));
    // PI ใบที่ 3 ลงวันที่ก่อนใบที่ 2 (ตามวันที่ใบกำกับผู้ขาย — v3 อนุญาต)
    pis[2].date = '2026-10-02';
    const entry = data.journal.find((e) => e.id === pis[2].journalId);
    if (entry) entry.date = '2026-10-02';
    const result = readAccountingData(data);
    expect(result.problems).toEqual([]);
    expect(result.data?.legacyOrderThrough).toBe(pis[1].date);
    // ไฟล์ v4 ที่ PI เรียงผิด = ถูกแก้ไฟล์
    expect(validateAccountingData({ ...(result.data as AccountingData), legacyOrderThrough: undefined }).join()).toMatch(
      /เรียงตามวันที่/
    );
  });

  it('rejects incomplete v3 data', () => {
    expect(readAccountingData({ version: 3, company: {} }).problems[0]).toMatch(/เวอร์ชัน 3 ไม่ครบ/);
    const broken = { ...v3, payments: [{ purchaseId: 'x' }], purchases: [{ id: 'x', lines: null, whtRate: 1 }] };
    expect(readAccountingData(broken).problems[0]).toMatch(/ย้ายข้อมูลเวอร์ชัน 3 ไม่สำเร็จ/);
  });
});

// ----------------------------------------------------------------------

describe('migration v4 → v5 (Sprint B batch 3)', () => {
  const original = demo();
  const v4 = toV4(original);

  it('adds the deferred output VAT account and empty supplier-credit / year-close lists, numbers unchanged', () => {
    const result = readAccountingData(JSON.parse(JSON.stringify(v4)));
    expect(result.migratedFrom).toBe(4);
    expect(result.problems).toEqual([]);
    const { data } = result;
    if (!data) throw new Error('migrate failed');
    expect(data.version).toBe(DATA_VERSION);
    expect(data.accounts.find((a) => a.code === ACC.deferredOutputVat)).toMatchObject({ type: 'liability', system: true });
    expect(data.purchaseCredits).toEqual([]);
    expect(data.yearCloses).toEqual([]);
    expect(data.openingBalance).toBeUndefined();
    expect(data.sales).toEqual(original.sales);
    expect(data.receipts).toEqual(original.receipts);
    expect(data.journal).toEqual(original.journal);
    // ไฟล์เวอร์ชันเก่ายังไม่มีใบเสนอราคา (QT) — ตัวนับอื่นต้องเท่าเดิมทุกตัว
    expect(data.sequences).toEqual(toV5(original).sequences);
  });

  it('migrates v1 and v3 files all the way to v5', () => {
    [toV1(original), toV3(original)].forEach((old) => {
      const result = readAccountingData(JSON.parse(JSON.stringify(old)));
      expect(result.problems).toEqual([]);
      expect(result.data?.version).toBe(DATA_VERSION);
      expect(result.data?.purchaseCredits).toEqual([]);
    });
  });

  it('rejects incomplete v4 data', () => {
    expect(readAccountingData({ ...v4, vatCloses: undefined }).problems[0]).toMatch(/เวอร์ชัน 4 ไม่ครบ/);
  });
});

// ----------------------------------------------------------------------

describe('migration v5 → v6 (Sprint B batch 4)', () => {
  const original = demo();
  const v5 = toV5(original);

  it('adds petty cash 1111, registers existing cash accounts and empty bank / quotation lists, numbers unchanged', () => {
    const result = readAccountingData(JSON.parse(JSON.stringify(v5)));
    expect(result.migratedFrom).toBe(5);
    expect(result.problems).toEqual([]);
    const { data } = result;
    if (!data) throw new Error('migrate failed');
    expect(DATA_VERSION).toBe(7);
    expect(data.version).toBe(7);
    expect(data.accounts.find((a) => a.code === ACC.pettyCash)).toMatchObject({ type: 'asset', name: 'เงินสดย่อย' });
    expect(data.bankAccounts).toEqual([
      { accountCode: ACC.pettyCash, kind: 'petty-cash', bankName: 'เงินสดย่อย', accountNo: '' },
      { accountCode: ACC.bank, kind: 'bank', bankName: '', accountNo: '' },
    ]);
    expect([data.transfers, data.bankStatements, data.bankMatches, data.quotations]).toEqual([[], [], [], []]);
    expect(data.journal).toEqual(original.journal);
    expect(data.sales).toEqual(original.sales);
    expect(data.purchases).toEqual(original.purchases);
    expect(data.sequences).toEqual(v5.sequences);
  });

  it('registers extra 112x bank accounts from older charts and keeps 1110 cash unregistered', () => {
    const custom = { ...v5, accounts: [...v5.accounts, { code: '1121', name: 'เงินฝาก SCB', nameEn: 'SCB', type: 'asset' }] };
    const {data} = readAccountingData(JSON.parse(JSON.stringify(custom)));
    expect(data?.bankAccounts.map((b) => [b.accountCode, b.kind])).toEqual([
      ['1111', 'petty-cash'],
      ['1120', 'bank'],
      ['1121', 'bank'],
    ]);
    expect(data?.bankAccounts.some((b) => b.accountCode === ACC.cash)).toBe(false);
  });

  it('migrates v1 / v3 / v4 files all the way to v6 and rejects incomplete v5 data', () => {
    [toV1(original), toV3(original), toV4(original)].forEach((old) => {
      const result = readAccountingData(JSON.parse(JSON.stringify(old)));
      expect(result.problems).toEqual([]);
      expect(result.data?.version).toBe(DATA_VERSION);
      expect(result.data?.bankAccounts.length).toBe(2);
    });
    expect(readAccountingData({ ...v5, yearCloses: undefined }).problems[0]).toMatch(/เวอร์ชัน 5 ไม่ครบ/);
  });

  it('current-version files without the new lists fail the schema check', () => {
    const rest: Record<string, unknown> = { ...original };
    delete rest.quotations;
    expect(readAccountingData(rest).data).toBeNull();
  });
});
