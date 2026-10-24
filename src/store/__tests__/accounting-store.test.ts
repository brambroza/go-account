import { ACC } from 'src/domain';

import { ln, demo, toV1, TODAY } from './fixtures';
import { issueTaxInvoice, BusinessRuleError } from '../actions';
import { STORAGE_KEY, createAccountingStore } from '../accounting-store';

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
    expect(JSON.parse(storage.map.get(STORAGE_KEY) ?? '{}').version).toBe(2);
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
    expect(JSON.parse(storage.map.get(STORAGE_KEY) ?? '{}').version).toBe(2);
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

  it('works without storage and reports write failures', () => {
    const memoryOnly = newStore(null);
    expect(memoryOnly.run(issue()).doc.docNo).toBe('IV6910-0005');

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
    store.run((s) => ({ state: { ...s, sequences: { ...s.sequences } } }));
    expect(store.getSnapshot().storageError).toMatch(/quota/);
    expect(store.getSnapshot().data.accounts.some((a) => a.code === ACC.bank)).toBe(true);
  });
});
