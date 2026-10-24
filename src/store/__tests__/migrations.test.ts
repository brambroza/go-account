import { ACC, DATA_VERSION, validateAccountingData } from 'src/domain';

import { demo, toV1 } from './fixtures';
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
    expect(data.sequences).toEqual(original.sequences);
    data.purchases
      .filter((p) => p.paid)
      .forEach((p) => {
        const entry = data.journal.find((e) => e.id === p.paymentJournalId);
        expect(entry?.sourceDocNo).toBe(p.paymentDocNo);
      });
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
    const v2 = { ...demo(), version: 2 };
    const result = readAccountingData(v2);
    expect(result.migratedFrom).toBe(2);
    expect(result.problems).toEqual([]);
    expect(result.data?.version).toBe(DATA_VERSION);
    expect(result.data?.legacyOrderThrough).toBeUndefined();
  });

  it('grandfathers inversions that came from v1 / v2 history, but not in current-version files', () => {
    const { data, laterDate } = outOfOrder();
    const fromV2 = readAccountingData({ ...data, version: 2 });
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
    const migrated = readAccountingJson(JSON.stringify({ ...data, version: 2 })).data;
    expect(migrated && readAccountingJson(JSON.stringify(migrated)).problems).toEqual([]);
  });
});
