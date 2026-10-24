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
