import { ACC, DATA_VERSION } from 'src/domain';

import { emptyData } from '../seed';
import { ln, demo, toV1, toV3, TODAY } from './fixtures';
import { lockPeriod, issueTaxInvoice, BusinessRuleError } from '../actions';
import { STORAGE_KEY, createAccountingStore, STORAGE_UNAVAILABLE_MESSAGE } from '../accounting-store';

import type { StorageLike } from '../accounting-store';

// ----------------------------------------------------------------------
// A2: run() ใช้ state ล่าสุด + กันหลายแท็บเขียนทับกัน
// ----------------------------------------------------------------------

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: StorageLike & { map: Map<string, string> } = {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
  return storage;
}

const issue = (contactId = 'c-abc') => (s: Parameters<typeof issueTaxInvoice>[0]) =>
  issueTaxInvoice(s, { date: TODAY, dueDate: TODAY, contactId, vatMode: 'exclusive', lines: [ln(1, 100)] });

const newStore = (storage: StorageLike | null) => createAccountingStore({ storage, fallback: demo, now: () => 42 });

describe('accounting store', () => {
  it('seeds and persists when storage is empty', () => {
    const storage = memoryStorage();
    const store = newStore(storage);
    expect(store.getSnapshot().data.sales.length).toBeGreaterThan(0);
    expect(JSON.parse(storage.map.get(STORAGE_KEY) ?? '{}').version).toBe(DATA_VERSION);
  });

  it('resetEmpty keeps company, chart of accounts and contacts but clears every document (before opening balances)', () => {
    const storage = memoryStorage();
    const store = newStore(storage);
    const before = store.getSnapshot().data;
    store.resetEmpty();
    const after = store.getSnapshot().data;
    expect(after.company).toEqual({ ...before.company, lockedThrough: undefined });
    expect(after.contacts).toEqual(before.contacts);
    expect(after.accounts).toEqual(before.accounts);
    expect([after.sales, after.receipts, after.purchases, after.journal, after.purchaseCredits, after.yearCloses]).toEqual([[], [], [], [], [], []]);
    expect(after.sequences).toEqual({});
    expect(JSON.parse(storage.map.get(STORAGE_KEY) ?? '{}').sales).toEqual([]);
  });

  it('runs consecutive mutations on the latest state, not a stale closure', () => {
    const storage = memoryStorage();
    const store = newStore(storage);
    const { run } = store;
    const a = run(issue());
    const b = run(issue());
    expect([a.doc.docNo, b.doc.docNo]).toEqual(['IV6910-0005', 'IV6910-0006']);
    expect(JSON.parse(storage.map.get(STORAGE_KEY) ?? '{}').sales).toHaveLength(store.getSnapshot().data.sales.length);
  });

  it('reloads changes from another tab before running and on storage events', () => {
    const storage = memoryStorage();
    const tabA = newStore(storage);
    const tabB = newStore(storage);
    const listener = jest.fn();
    const unsubscribe = tabB.subscribe(listener);

    expect(tabA.run(issue()).doc.docNo).toBe('IV6910-0005');
    // แท็บ B ยังไม่ได้รับ event แต่ run แล้วต้องต่อเลขจากแท็บ A ไม่ใช่เขียนทับ
    expect(tabB.run(issue('c-nakhon')).doc.docNo).toBe('IV6910-0006');
    expect(tabB.getSnapshot().externalChangeAt).toBe(42);
    expect(listener).toHaveBeenCalled();

    const raw = storage.map.get(STORAGE_KEY) ?? '';
    expect(JSON.parse(raw).sales.filter((s: { docNo: string }) => s.docNo.startsWith('IV6910'))).toHaveLength(6);

    tabA.handleStorageEvent(STORAGE_KEY, raw);
    expect(tabA.getSnapshot().data.sales).toHaveLength(tabB.getSnapshot().data.sales.length);
    const before = tabA.getSnapshot();
    tabA.handleStorageEvent('other-key', '{}');
    tabA.handleStorageEvent(STORAGE_KEY, null);
    tabA.handleStorageEvent(STORAGE_KEY, raw);
    expect(tabA.getSnapshot()).toBe(before);

    tabA.handleStorageEvent(STORAGE_KEY, '{broken');
    expect(tabA.getSnapshot().problems[0]).toMatch(/แท็บอื่น/);
    expect(tabA.getSnapshot().data).toBe(before.data);

    unsubscribe();
    listener.mockClear();
    tabB.resetDemo();
    expect(listener).not.toHaveBeenCalled();
  });

  it('migrates v1 storage and keeps the original copy', () => {
    const v1 = JSON.stringify(toV1(demo()));
    const storage = memoryStorage({ [STORAGE_KEY]: v1 });
    const store = newStore(storage);
    expect(store.getSnapshot().problems).toEqual([]);
    expect(store.getSnapshot().data.payments.length).toBeGreaterThan(0);
    expect(storage.map.get(`${STORAGE_KEY}:backup-v1`)).toBe(v1);
    expect(JSON.parse(storage.map.get(STORAGE_KEY) ?? '{}').version).toBe(DATA_VERSION);
  });

  it('migrates v2 storage to the current version and keeps the v2 copy', () => {
    const v2 = JSON.stringify({ ...toV3(demo()), version: 2 });
    const storage = memoryStorage({ [STORAGE_KEY]: v2 });
    const store = newStore(storage);
    expect(store.getSnapshot().readOnly).toBe(false);
    expect(storage.map.get(`${STORAGE_KEY}:backup-v2`)).toBe(v2);
    expect(JSON.parse(storage.map.get(STORAGE_KEY) ?? '{}').version).toBe(DATA_VERSION);
  });

  it('never silently wipes unreadable data', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{"version":7}' });
    const store = newStore(storage);
    expect(store.getSnapshot().problems[0]).toMatch(/อ่านข้อมูลเดิมไม่ได้/);
    expect(storage.map.get(`${STORAGE_KEY}:unreadable-42`)).toBe('{"version":7}');
    expect(storage.map.get(STORAGE_KEY)).toBe('{"version":7}');
  });

  it('loads data that breaks rules but surfaces the problems', () => {
    const data = demo();
    const broken = { ...data, sequences: { ...data.sequences, IV6910: 9 } };
    const store = newStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(broken) }));
    expect(store.getSnapshot().data.sequences.IV6910).toBe(9);
    expect(store.getSnapshot().problems.join()).toMatch(/IV6910/);
  });

  it('validates data before replace unless forced', () => {
    const store = newStore(memoryStorage());
    const data = demo();
    const broken = { ...data, journal: [] };
    expect(() => store.replace(broken)).toThrow(BusinessRuleError);
    store.replace(broken, { force: true });
    expect(store.getSnapshot().data.journal).toEqual([]);
    expect(store.getSnapshot().problems.length).toBeGreaterThan(0);
    store.replace(data);
    expect(store.getSnapshot().problems).toEqual([]);
  });

  it('T6: without storage shows a persistent error and refuses to post (nothing kept only in memory)', () => {
    const memoryOnly = newStore(null);
    expect(memoryOnly.getSnapshot().storageError).toBe(STORAGE_UNAVAILABLE_MESSAGE);
    expect(memoryOnly.getSnapshot().storageError).toMatch(/ไม่สามารถบันทึกข้อมูลในเบราว์เซอร์นี้/);
    const before = memoryOnly.getSnapshot().data;
    expect(() => memoryOnly.run(issue())).toThrow(/ไม่สามารถบันทึกข้อมูลในเบราว์เซอร์นี้/);
    expect(() => memoryOnly.resetDemo()).toThrow(BusinessRuleError);
    expect(() => memoryOnly.replace(demo())).toThrow(BusinessRuleError);
    expect(memoryOnly.getSnapshot().data).toBe(before);
    expect(memoryOnly.getSnapshot().data.accounts.some((a) => a.code === ACC.bank)).toBe(true);
  });

  it('T6: setItem failing → run throws, data and counters unchanged, number not consumed', () => {
    const storage = memoryStorage();
    let fail = false;
    const flaky: StorageLike = {
      getItem: storage.getItem,
      setItem: (k, v) => {
        if (fail) throw new Error('QuotaExceededError');
        storage.setItem(k, v);
      },
    };
    const store = newStore(flaky);
    const before = store.getSnapshot().data;
    const listener = jest.fn();
    store.subscribe(listener);
    fail = true;
    expect(() => store.run(issue())).toThrow(/QuotaExceededError.*ยังไม่ใช้เลขที่/);
    expect(store.getSnapshot().data).toBe(before);
    expect(store.getSnapshot().storageError).toMatch(/QuotaExceededError/);
    expect(listener).toHaveBeenCalled();
    expect(JSON.parse(storage.map.get(STORAGE_KEY) ?? '{}').sequences.IV6910).toBe(4);
    fail = false;
    // บันทึกได้อีกครั้ง → ได้เลขเดิมที่ไม่ได้ถูกใช้ และล้างข้อความ error
    expect(store.run(issue()).doc.docNo).toBe('IV6910-0005');
    expect(store.getSnapshot().storageError).toBeNull();
  });

  it('T6: storage failing from start (getItem/setItem throw) reports the error and refuses to post', () => {
    const failing: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const store = newStore(failing);
    expect(store.getSnapshot().storageError).toMatch(/quota/);
    expect(() => store.run((s) => ({ state: { ...s, sequences: { ...s.sequences } } }))).toThrow(/quota/);
    expect(store.getSnapshot().storageError).toMatch(/quota/);
  });

  it('T6 (auditor S3): tab A save fails → A did not issue; tab B gets the next number, no duplicate', () => {
    const shared = memoryStorage();
    let failA = false;
    const storageA: StorageLike = {
      getItem: shared.getItem,
      setItem: (k, v) => {
        if (failA) throw new Error('QuotaExceeded');
        shared.setItem(k, v);
      },
    };
    const a = newStore(storageA);
    const b = newStore(shared);
    failA = true;
    expect(() => a.run(issue())).toThrow(BusinessRuleError);
    expect(b.run(issue()).doc.docNo).toBe('IV6910-0005');
    failA = false;
    expect(a.run(issue()).doc.docNo).toBe('IV6910-0006');
  });

  it('T11: data with integrity problems opens read-only — run refused until restore/reset', () => {
    const data = demo();
    const tampered = JSON.parse(JSON.stringify(data)) as typeof data;
    tampered.journal[1].lines[0].debit += 1;
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(tampered) });
    const store = newStore(storage);
    expect(store.getSnapshot().readOnly).toBe(true);
    expect(store.getSnapshot().problems.length).toBeGreaterThan(0);
    expect(() => store.run(issue())).toThrow(/อ่านอย่างเดียว/);
    expect(storage.map.get(STORAGE_KEY)).toBe(JSON.stringify(tampered));
    store.resetDemo();
    expect(store.getSnapshot().readOnly).toBe(false);
    expect(store.run(issue()).doc.docNo).toBe('IV6910-0005');
  });

  it('T11: tampered data from another tab switches to read-only; a valid restore clears it', () => {
    const storage = memoryStorage();
    const store = newStore(storage);
    const good = store.getSnapshot().data;
    const tampered = JSON.parse(JSON.stringify(good)) as typeof good;
    tampered.journal[0].lines[0].debit += 100;
    // แท็บอื่นเขียนข้อมูลที่ผิดกฎลง storage แล้วส่ง event มา
    storage.map.set(STORAGE_KEY, JSON.stringify(tampered));
    store.handleStorageEvent(STORAGE_KEY, JSON.stringify(tampered));
    expect(store.getSnapshot().readOnly).toBe(true);
    expect(() => store.run(issue())).toThrow(/อ่านอย่างเดียว/);
    store.replace(good);
    expect(store.getSnapshot().readOnly).toBe(false);
    expect(store.getSnapshot().problems).toEqual([]);
  });

  it('T4: restoring an older backup of the same company cannot move lock or counters backwards', () => {
    const storage = memoryStorage();
    const store = newStore(storage);
    const old = demo();
    const issued = store.run(issue()).doc.docNo;
    expect(() => store.replace(old)).toThrow(/IV6910.*ออกซ้ำ/);
    expect(() => store.replace(old, { force: true })).toThrow(/กู้คืนไม่ได้/);
    expect(store.run(issue()).doc.docNo).not.toBe(issued);

    // ปิดงวดแล้วกู้คืนไฟล์ที่ยังไม่ปิด → ปฏิเสธ
    const locked = createAccountingStore({
      storage: memoryStorage({ [STORAGE_KEY]: JSON.stringify(lockPeriod(demo(), '2026-09-30', TODAY)) }),
      fallback: demo,
    });
    expect(() => locked.replace(demo())).toThrow(/ปิดงวด/);

    // U3: แก้ company.taxId ในไฟล์เดิมเพื่อข้ามการตรวจ → ยังถูกปฏิเสธ
    const edited = { ...old, company: { ...old.company, taxId: '0105561098763' } };
    expect(() => store.replace(edited)).toThrow(/ออกซ้ำ/);
    // ไฟล์ของบริษัทอื่นจริง: ต้องล้างข้อมูลก่อน แล้วจึงกู้คืนได้
    const foreignBase = emptyData();
    const foreign = issueTaxInvoice(
      { ...foreignBase, company: { ...foreignBase.company, taxId: '0105561098763' }, contacts: old.contacts },
      { date: '2026-11-15', dueDate: '2026-11-30', contactId: 'c-abc', vatMode: 'exclusive', lines: [ln(1, 100)] }
    ).state;
    expect(() => store.replace(foreign)).toThrow(/บริษัทอื่น/);
    store.resetEmpty();
    store.replace(foreign);
    expect(store.getSnapshot().data.company.taxId).toBe('0105561098763');
  });
});
