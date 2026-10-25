import type { AccountingData } from 'src/domain';
import type { ApiClient, RequestOptions } from 'src/utils/api-client';

import { ApiError } from 'src/utils/api-client';

import { cmd } from '../commands';
import { demo, TODAY } from './fixtures';
import { BusinessRuleError } from '../actions';
import { createAccountingStore } from '../accounting-store';
import { isUncertainFailure, createApiRepository, createLocalRepository } from '../repository';

// ----------------------------------------------------------------------
// C6: AccountingRepository — local ห่อ store เดิม (async), api โหลดสมุดจาก GET /book และใช้ Idempotency-Key เดิมเมื่อกดบันทึกซ้ำ
// ----------------------------------------------------------------------

type Sent = { path: string; options: RequestOptions };

function fakeClient(handler: (path: string, options: RequestOptions) => unknown) {
  const sent: Sent[] = [];
  const client: ApiClient = {
    baseUrl: '/api/v1',
    request: async <T,>(path: string, options: RequestOptions = {}) => {
      sent.push({ path, options });
      return (await handler(path, options)) as T;
    },
    get: async <T,>(path: string) => {
      sent.push({ path, options: {} });
      return (await handler(path, {})) as T;
    },
    download: async () => ({ blob: new Blob([]), fileName: 'x', warnings: [] }),
    setSession: () => undefined,
    refresh: async () => true,
  };
  return { client, sent };
}

const lock = () => cmd.lockPeriod('2026-09-30');

describe('local repository', () => {
  it('executes the local mutation asynchronously and bumps revision', async () => {
    const store = createAccountingStore({ storage: null, fallback: demo });
    const repo = createLocalRepository(store);
    expect(repo.mode).toBe('local');
    const before = repo.getSnapshot();
    expect(before.status).toBe('ready');
    // storage null = บันทึกไม่ได้ → reject ด้วยข้อความไทย (ไม่ throw แบบ synchronous)
    await expect(repo.execute(lock())).rejects.toThrow(BusinessRuleError);
    await repo.reload();
    expect(repo.getSnapshot()).toBe(before);
  });

  it('writes through a working storage', async () => {
    const map = new Map<string, string>();
    const store = createAccountingStore({ storage: { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }, fallback: demo });
    const repo = createLocalRepository(store);
    const rev = repo.getSnapshot().revision;
    const listener = jest.fn();
    const off = repo.subscribe(listener);
    await repo.execute(cmd.lockPeriod('2026-09-30'));
    off();
    expect(listener).toHaveBeenCalled();
    expect(repo.getSnapshot().data?.company.lockedThrough).toBe('2026-09-30');
    expect(repo.getSnapshot().revision).toBe(rev + 1);
  });
});

describe('api repository', () => {
  const book: AccountingData = demo();

  it('loads the book, exposes errors before the first load, and keeps data after a later failure', async () => {
    let fail = true;
    const { client } = fakeClient((path) => {
      if (path === '/book' && fail) throw new ApiError(503, 'ล่ม');
      return book;
    });
    const repo = createApiRepository({ client, newKey: () => 'k1' });
    expect(repo.getSnapshot().status).toBe('loading');
    await expect(repo.reload()).rejects.toThrow('ล่ม');
    expect(repo.getSnapshot()).toMatchObject({ status: 'error', error: 'ล่ม' });
    fail = false;
    await repo.reload();
    expect(repo.getSnapshot()).toMatchObject({ status: 'ready', revision: 1 });
    fail = true;
    await expect(repo.reload()).rejects.toThrow();
    expect(repo.getSnapshot().status).toBe('ready');
  });

  it('refuses commands before the book is loaded', async () => {
    const { client } = fakeClient(() => book);
    const repo = createApiRepository({ client });
    await expect(repo.execute(lock())).rejects.toThrow('ยังโหลดข้อมูลไม่เสร็จ');
  });

  it('reuses the Idempotency-Key when the same submit is retried after an uncertain failure', async () => {
    let attempt = 0;
    const { client, sent } = fakeClient((path) => {
      if (path === '/book') return book;
      attempt += 1;
      if (attempt === 1) throw new ApiError(0, 'เครือข่าย', { code: 'NETWORK' });
      return {};
    });
    let n = 0;
    const repo = createApiRepository({ client, newKey: () => { n += 1; return `key-${n}`; } });
    await repo.reload();
    await expect(repo.execute(lock())).rejects.toThrow('เครือข่าย');
    await repo.execute(lock());
    const keys = sent.filter((s) => s.path === '/company/lock-period').map((s) => s.options.idempotencyKey);
    expect(keys).toEqual(['key-1', 'key-1']);
    // สำเร็จแล้ว = กดใหม่ได้ key ใหม่
    await repo.execute(lock());
    expect(sent.filter((s) => s.path === '/company/lock-period').map((s) => s.options.idempotencyKey)[2]).toBe('key-2');
  });

  it('drops the key after a business-rule rejection (server stores nothing)', async () => {
    let attempt = 0;
    const { client, sent } = fakeClient((path) => {
      if (path === '/book') return book;
      attempt += 1;
      if (attempt === 1) throw new ApiError(422, 'ปิดงวดย้อนหลังไม่ได้', { code: 'LOCK_BACKWARD' });
      return {};
    });
    let n = 0;
    const repo = createApiRepository({ client, newKey: () => { n += 1; return `key-${n}`; } });
    await repo.reload();
    await expect(repo.execute(lock())).rejects.toMatchObject({ code: 'LOCK_BACKWARD' });
    await repo.execute(lock());
    expect(sent.filter((s) => s.path === '/company/lock-period').map((s) => s.options.idempotencyKey)).toEqual(['key-1', 'key-2']);
  });

  it('keeps the key when the command committed but reloading the book failed', async () => {
    let books = 0;
    const { client, sent } = fakeClient((path) => {
      if (path === '/book') {
        books += 1;
        if (books === 2) throw new ApiError(500, 'โหลดไม่ได้');
        return book;
      }
      return {};
    });
    let n = 0;
    const repo = createApiRepository({ client, newKey: () => { n += 1; return `key-${n}`; } });
    await repo.reload();
    await expect(repo.execute(lock())).rejects.toThrow('โหลดไม่ได้');
    await repo.execute(lock());
    expect(sent.filter((s) => s.path === '/company/lock-period').map((s) => s.options.idempotencyKey)).toEqual(['key-1', 'key-1']);
  });

  it('sub-requests of one command get `<key>:<part>` keys', async () => {
    const { client, sent } = fakeClient((path) => (path === '/book' ? book : { id: 'x' }));
    const repo = createApiRepository({ client, newKey: () => 'K' });
    await repo.reload();
    const c = book.contacts[0];
    await repo.execute(cmd.importContacts([{ ...c, code: 'ZZ1' }]));
    expect(sent.find((s) => s.path === '/contacts')?.options.idempotencyKey).toBe('K:ZZ1');
  });

  it('classifies uncertain failures', () => {
    expect(isUncertainFailure(new ApiError(0, 'x'))).toBe(true);
    expect(isUncertainFailure(new ApiError(502, 'x'))).toBe(true);
    expect(isUncertainFailure(new ApiError(409, 'x'))).toBe(true);
    expect(isUncertainFailure(new ApiError(422, 'x'))).toBe(false);
    expect(isUncertainFailure(new Error('x'))).toBe(true);
    expect(TODAY).toBeTruthy();
  });
});
